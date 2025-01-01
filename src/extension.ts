// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WorkitemProvider } from './views/workitemProvider';
import { WorkitemTreeItem } from './views/workitemTreeItem';
import { AdoService } from './services/adoService';
import { MarkdownParser } from './services/markdownParser';
import * as chokidar from 'chokidar';
import { log } from './utils';
import { SyncStateManager } from './services/syncStateManager';
import { authentication } from 'vscode';
import { SyncLogManager } from './services/implementations/syncLogManager';
import { WelcomeViewProvider } from './views/welcomeViewProvider';
import { assert } from 'console';
import { SyncLogEntry } from './services/interfaces/ISyncLogManager';

// 添加日志类型定义
interface LogMessage {
	message?: string;
	increment?: number;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// 检查配置
	const config = vscode.workspace.getConfiguration('markdown-ado-sync');
	const scanPaths = config.get<string[]>('scanPaths') || [];
	const adoToken = config.get<string>('adoToken');
	const adoOrganization = config.get<string>('adoOrganization');
	const adoProject = config.get<string>('adoProject');
	log(`adoToken: ${adoToken}\nadoOrganization: ${adoOrganization}\nadoProject: ${adoProject}`);

	// 初始化服务
	const adoService = new AdoService();
	const markdownParser = new MarkdownParser();
	const syncStateManager = new SyncStateManager(context);
	const syncLogManager = new SyncLogManager(context);
	assert(adoOrganization && adoProject, 'adoOrganization and adoProject must be set');

	WorkitemTreeItem.setAdoConfig(adoOrganization!, adoProject!);

	// 注册登录命令
	let signInCommand = vscode.commands.registerCommand('markdown-ado-sync.signin', async () => {
		try {
			const session = await authentication.getSession('microsoft',
				['499b84ac-1321-427f-aa17-267ca6975798/user_impersonation'],
				{ createIfNone: true }
			);

			if (!session) {
				vscode.window.showErrorMessage('需要 Azure DevOps 授权才能继续使用。');
				return;
			}

			adoService.updateToken(session.accessToken);
			await vscode.commands.executeCommand('setContext', 'markdown-ado-sync:authenticated', true);
			vscode.window.showInformationMessage('登录成功！');
		} catch (error) {
			vscode.window.showErrorMessage(`授权失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	// 检查认证状态
	if (await adoService.validateToken()) {
		await vscode.commands.executeCommand('setContext', 'markdown-ado-sync:authenticated', true);
	} else {
		await vscode.commands.executeCommand('setContext', 'markdown-ado-sync:authenticated', false);
	}
	
	let workitemProvider: WorkitemProvider;

	const registerView = () => {
		// 注册欢迎视图
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				WelcomeViewProvider.viewType,
				new WelcomeViewProvider(context.extensionUri)
			)
		);

		// 创建 TreeView Provider
		workitemProvider = new WorkitemProvider(
			adoService,
			markdownParser,
			syncStateManager,
			syncLogManager
		);

		// 创建 TreeView
		const workitemTreeView = vscode.window.createTreeView('adoWorkitems', {
			treeDataProvider: workitemProvider,
			showCollapseAll: true,
			canSelectMany: false
		});

		// 添加状态过滤命令
		const filterCommand = vscode.commands.registerCommand('markdown-ado-sync.filterByState', async () => {
			const states = [
				{ label: 'All', state: undefined },
				{ label: 'Completed', state: 'Completed' },
				{ label: 'Started', state: 'Started' },
				{ label: 'Proposed', state: 'Proposed' },
				{ label: 'Committed', state: 'Committed' },
				{ label: 'Cut', state: 'Cut' }
			];

			const selected = await vscode.window.showQuickPick(states.map(s => s.label), {
				placeHolder: '选择状态过滤'
			});

			if (selected) {
				const state = states.find(s => s.label === selected)?.state;
				workitemProvider.setStateFilter(state);
			}
		});

		context.subscriptions.push(filterCommand);

		// 添加过滤按钮到视图标题栏
		vscode.commands.executeCommand('setContext', 'markdown-ado-sync:showFilterButton', true);

		// 注册 TreeView
		context.subscriptions.push(workitemTreeView);
	}

	registerView();

	let watcher: chokidar.FSWatcher | undefined;

	function startWatcher() {
		if (watcher) {
			watcher.close();
		}

		const config = vscode.workspace.getConfiguration('markdown-ado-sync');
		const scanPaths = config.get<string[]>('scanPaths') || [];

		if (scanPaths.length > 0) {
			try {
				log(`Scanning paths: ${Array.isArray(scanPaths) ? scanPaths.join(', ') : scanPaths}`);
				watcher = chokidar.watch(scanPaths, {
					persistent: true,
					ignoreInitial: true,
					awaitWriteFinish: {
						stabilityThreshold: 300,
						pollInterval: 100
					},
					ignorePermissionErrors: true
				});

				// 使用 FSWatcher 的 on 方法
				(watcher as any)
					.on('change', async (path: string) => {
						log(`File changed: ${path}`);
						workitemProvider.refreshToState(path);
					})
					.on('add', async (path: string) => {
						log(`File created: ${path}`);
						workitemProvider.refresh();
					})
					.on('unlink', async (path: string) => {
						log(`File deleted: ${path}`);
						workitemProvider.refresh();
						syncStateManager.deleteSyncState(path);
					});
			} catch (error) {
				log(`Error starting watcher: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	// 初始启动监听器
	startWatcher();

	// 监听配置变化，重启监听器
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('markdown-ado-sync.scanPaths')) {
				startWatcher();
				registerView();
			}
		})
	);

	// 注册刷新命令
	let refreshCommand = vscode.commands.registerCommand('markdown-ado-sync.refresh', () => {
		workitemProvider.refresh();
	});

	// 注册配置扫描路径命令
	let configureScanPathCommand = vscode.commands.registerCommand('markdown-ado-sync.configureScanPath', async () => {
		const folders = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: true,
			openLabel: '选择扫描目录',
			title: '选择要扫描的 Markdown 文件目录'
		});

		if (folders) {
			const config = vscode.workspace.getConfiguration('markdown-ado-sync');
			const currentPaths = config.get<string[]>('scanPaths') || [];
			const newPaths = folders.map(folder => folder.fsPath);

			// 合并路径并去重
			const uniquePaths = [...new Set([...currentPaths, ...newPaths])];

			await config.update('scanPaths', uniquePaths, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage(`已添加 ${newPaths.length} 个扫描路径`);
		}
	});

	// 注册同步命令
	let syncCommand = vscode.commands.registerCommand('markdown-ado-sync.sync', async () => {
		const answer = await vscode.window.showWarningMessage(
			'确定要同步所有工作项吗？',
			{ modal: true },
			'确定',
			'取消'
		);

		if (answer !== '确定') {
			return;
		}

		try {
			await workitemProvider.syncWorkitems();
			vscode.window.showInformationMessage('同步完成！');
		} catch (error) {
			vscode.window.showErrorMessage(`同步失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	// 注册单个工作项同步命令
	let syncSingleCommand = vscode.commands.registerCommand('markdown-ado-sync.syncSingle', async (item: WorkitemTreeItem) => {
		if (item.filePath) {
			await workitemProvider.syncSingleWorkitem(item.filePath);
		}
	});

	// 注册显示日志的命令
	let showLogsCommand = vscode.commands.registerCommand('markdown-ado-sync.showLogs', async (filePath: string, groupId: string) => {
		if (!filePath || !groupId) {
			return;
		}

		const logs = workitemProvider.getLogGroup(filePath, groupId);

		// 创建日志内容
		const content = logs.map((log: SyncLogEntry) => {
			const date = new Date(log.timestamp);
			const timeStr = date.toLocaleString();
			let result = `[${timeStr}] ${log.status.toUpperCase()}: ${log.message}`;
			if (log.details) {
				result += `\n${log.details}`;
			}
			return result;
		}).join('\n\n');

		// 创建并显示文档
		const doc = await vscode.workspace.openTextDocument({
			content,
			language: 'markdown'
		});
		await vscode.window.showTextDocument(doc, {
			preserveFocus: true
		});
	});

	context.subscriptions.push(syncCommand, configureScanPathCommand, refreshCommand, syncSingleCommand, showLogsCommand);

	// 注册清理函数
	context.subscriptions.push({
		dispose: () => {
			if (watcher) {
				watcher.close();
			}
		}
	});

	context.subscriptions.push(signInCommand);

	// 初始检查配置状态
	updateConfigurationContext();

	// 监听配置变化
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('markdown-ado-sync')) {
				updateConfigurationContext();
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }

function updateConfigurationContext() {
	const config = vscode.workspace.getConfiguration('markdown-ado-sync');
	const organization = config.get<string>('adoOrganization');
	const project = config.get<string>('adoProject');
	const scanPaths = config.get<string[]>('scanPaths') || [];

	const allConfigured = !!(organization && project && scanPaths.length > 0);
	vscode.commands.executeCommand('setContext', 'markdown-ado-sync:allConfigured', allConfigured);
}
