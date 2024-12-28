// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WorkitemProvider, WorkitemItem } from './workitemProvider';
import { AdoService } from './services/adoService';
import { MarkdownParser } from './services/markdownParser';
import * as chokidar from 'chokidar';
import { log } from './utils';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// 初始化服务
	const adoService = new AdoService();
	const markdownParser = new MarkdownParser();
	
	// 创建 TreeView Provider
	const workitemProvider = new WorkitemProvider(adoService, markdownParser);
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
					// await workitemProvider.refreshItem(path);
					workitemProvider.refresh();
				})
				.on('add', async (path: string) => {
					log(`File created: ${path}`);
					workitemProvider.refresh();
				})
				.on('unlink', async (path: string) => {
					log(`File deleted: ${path}`);
					workitemProvider.refresh();
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

	context.subscriptions.push(syncCommand, configureScanPathCommand, refreshCommand, syncSingleCommand);

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
