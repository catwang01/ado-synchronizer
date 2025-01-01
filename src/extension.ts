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
	const scanPath = config.get<string>('scanPath');
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

	// 注册欢迎视图
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			WelcomeViewProvider.viewType,
			new WelcomeViewProvider(context.extensionUri)
		)
	);

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

	// 创建 TreeView Provider
	const workitemProvider = new WorkitemProvider(
		adoService, 
		markdownParser, 
		syncStateManager,
		syncLogManager
	);
	vscode.window.registerTreeDataProvider('adoWorkitems', workitemProvider);

	let watcher: chokidar.FSWatcher | undefined;

	function startWatcher() {
		if (watcher) {
			watcher.close();
		}

		const config = vscode.workspace.getConfiguration('markdown-ado-sync');
		const scanPath = config.get<string>('scanPath');

		if (scanPath) {
			log(`Scanning path: ${scanPath}`);
			// TODO: only watch .md, .MD, .markdown files
			watcher = chokidar.watch(scanPath, {
				persistent: true,
				ignoreInitial: true,
				awaitWriteFinish: {
					stabilityThreshold: 300,
					pollInterval: 100
				},
				ignorePermissionErrors: true // Ignore permission errors
			});

			// 使用 FSWatcher 的 on 方法
			(watcher as any)
				.on('change', async (path: string) => {
					log(`File changed: ${path}`);
					workitemProvider.refreshToState(path);
					// not sure why this is needed
					// await workitemProvider.refreshModified();
				})
				.on('add', async (path: string) => {
					log(`File created: ${path}`);
					workitemProvider.refresh();
					// workitemProvider.refreshItem(path);
					// workitemProvider.refreshModified();
				})
				.on('unlink', async (path: string) => {
					log(`File deleted: ${path}`);
					workitemProvider.refresh();
					// workitemProvider.refreshModified();
					syncStateManager.deleteSyncState(path);
				});
		}
	}

	// 初始启动监听器
	startWatcher();

	// 监听配置变化，重启监听器
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('markdown-ado-sync.scanPath')) {
				startWatcher();
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
			canSelectMany: false,
			title: '选择要扫描的 Markdown 文件目录'
		});
		
		if (folders && folders[0]) {
			const config = vscode.workspace.getConfiguration('markdown-ado-sync');
			await config.update('scanPath', folders[0].fsPath, vscode.ConfigurationTarget.Global);
			workitemProvider.refresh();
			vscode.window.showInformationMessage(`扫描路径已设置为: ${folders[0].fsPath}`);
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

	// 修复 log 参数的类型
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "同步工作项",
		cancellable: false
	}, async (progress: vscode.Progress<LogMessage>) => {
		// ... 其他代码保持不变 ...
	});
}

// This method is called when your extension is deactivated
export function deactivate() {}

function updateConfigurationContext() {
	const config = vscode.workspace.getConfiguration('markdown-ado-sync');
	const organization = config.get<string>('adoOrganization');
	const project = config.get<string>('adoProject');
	const scanPath = config.get<string>('scanPath');

	const allConfigured = !!(organization && project && scanPath);
	vscode.commands.executeCommand('setContext', 'markdown-ado-sync:allConfigured', allConfigured);
}
