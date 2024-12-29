// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WorkitemProvider, WorkitemItem } from './workitemProvider';
import { AdoService, MockAdoService } from './services/adoService';
import { MarkdownParser } from './services/markdownParser';
import * as chokidar from 'chokidar';
import { log } from './utils';
import { SyncStateManager } from './services/syncStateManager';
import { authentication } from 'vscode';
import { SyncLogManager } from './services/implementations/syncLogManager';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// 检查配置
	const config = vscode.workspace.getConfiguration('markdown-ado-sync');
	const scanPath = config.get<string>('scanPath');
	const adoToken = config.get<string>('adoToken');
	const adoOrganization = config.get<string>('adoOrganization');
	const adoProject = config.get<string>('adoProject');
	const debug = config.get<boolean>('debug', true); // 默认为 true
	log(`adoToken: ${adoToken}\nadoOrganization: ${adoOrganization}\nadoProject: ${adoProject}\ndebug: ${debug}`);

	// 初始化服务
	const adoService = debug ? new MockAdoService() : new AdoService();
	const markdownParser = new MarkdownParser();
	const syncStateManager = new SyncStateManager(context);
	const syncLogManager = new SyncLogManager();

	if (!await adoService.validateToken()) {
		try {
			const session = await authentication.getSession('microsoft', ['499b84ac-1321-427f-aa17-267ca6975798/user_impersonation'], {
				createIfNone: true
			});
			
			if (!session) {
				vscode.window.showErrorMessage('需要 Azure DevOps 授权才能继续使用。请重新运行命令进行授权。');
				return;
			}
			
			adoService.updateToken(session.accessToken);
		} catch (error) {
			vscode.window.showErrorMessage(`授权失败: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
	}

	// 设置 ADO 配置
	WorkitemItem.setAdoConfig(adoOrganization || '', adoProject || '');
	
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
					await workitemProvider.refreshModified();
				})
				.on('add', async (path: string) => {
					log(`File created: ${path}`);
					workitemProvider.refreshModified();
				})
				.on('unlink', async (path: string) => {
					log(`File deleted: ${path}`);
					workitemProvider.refreshModified();
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
	let syncSingleCommand = vscode.commands.registerCommand('markdown-ado-sync.syncSingle', async (item: WorkitemItem) => {
		if (item.filePath) {
			await workitemProvider.syncSingleWorkitem(item.filePath);
		}
	});

	// 注册显示日志的命令
	let showLogsCommand = vscode.commands.registerCommand('markdown-ado-sync.showLogs', async (item: WorkitemItem) => {
		if (!item.filePath || !item.logGroupId) {
			return;
		}

		// 使用公共方法获取日志组内容
		const logs = workitemProvider.getLogGroup(item.filePath, item.logGroupId);
		
		// 创建日志内容
		const content = logs.map(log => {
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
			preserveFocus: true,
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
