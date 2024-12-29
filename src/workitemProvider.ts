import * as vscode from 'vscode';
import { AdoService } from './services/adoService';
import { MarkdownParser } from './services/markdownParser';
import { log } from './utils';
import { StateIcons, WorkItemState } from './constants/icons';

// 私有 symbol 用于存储 provider 引用
const providerSymbol = Symbol('provider');

export class WorkitemItem extends vscode.TreeItem {
    private _state: string | undefined;

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly filePath?: string,
        initialState?: string,
        provider?: WorkitemProvider
    ) {
        super(label, collapsibleState);
        this.contextValue = filePath ? 'workitem' : undefined;
        this._state = initialState;
        
        if (provider) {
            // @ts-ignore
            this[providerSymbol] = provider;
        }

        // 设置图标
        if (filePath && provider?.syncingItems.has(filePath)) {
            this.iconPath = new vscode.ThemeIcon(StateIcons.Syncing.replace('$(', '').replace(')', ''));
        } else if (this._state) {
            this.iconPath = new vscode.ThemeIcon(
                (StateIcons[this._state as WorkItemState] || StateIcons.default).replace('$(', '').replace(')', '')
            );
        }

        // 设置工具提示，显示状态信息
        this.tooltip = this._state ? `${label} (${this._state})` : label;
    }

    get workItemState(): string | undefined {
        return this._state;
    }
}

export class WorkitemProvider implements vscode.TreeDataProvider<WorkitemItem> {
    // 使内部类的 syncingItems 可以被 WorkitemItem 访问
    readonly syncingItems: Set<string> = new Set();

    private _onDidChangeTreeData: vscode.EventEmitter<WorkitemItem | undefined> = new vscode.EventEmitter<WorkitemItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkitemItem | undefined> = this._onDidChangeTreeData.event;

    private itemMap: Map<string, WorkitemItem> = new Map();

    constructor(
        private adoService: AdoService,
        private markdownParser: MarkdownParser
    ) {}

    private updateItemIcon(filePath: string, isSyncing: boolean) {
        const item = this.itemMap.get(filePath);
        if (item) {
            if (isSyncing) {
                this.syncingItems.add(filePath);
            } else {
                this.syncingItems.delete(filePath);
            }
            
            // 更新图标
            if (isSyncing) {
                item.iconPath = new vscode.ThemeIcon(StateIcons.Syncing.replace('$(', '').replace(')', ''));
            } else if (item.workItemState) {
                item.iconPath = new vscode.ThemeIcon(
                    (StateIcons[item.workItemState as WorkItemState] || StateIcons.default).replace('$(', '').replace(')', '')
                );
            }
            
            // 强制刷新这个项目
            this._onDidChangeTreeData.fire(item);
        }
    }

    refresh(filePath?: string): void {
        if (filePath) {
            const item = this.itemMap.get(filePath);
            if (item) {
                this._onDidChangeTreeData.fire(item);
            }
        } else {
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    async refreshItem(filePath: string): Promise<void> {
        try {
            const metadata = await this.markdownParser.parseMetadata(filePath);
            const item = new WorkitemItem(
                metadata.title,
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'vscode.open',
                    title: '打开文件',
                    arguments: [vscode.Uri.file(filePath)]
                },
                filePath,
                metadata.state,
                this
            );
            this.itemMap.set(filePath, item);
            this._onDidChangeTreeData.fire(item);
        } catch (error) {
            // 如果文件读取失败，从 Map 中移除并刷新整个视图
            this.itemMap.delete(filePath);
            this._onDidChangeTreeData.fire(undefined);
        }
    }

    getTreeItem(element: WorkitemItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkitemItem | undefined): Promise<WorkitemItem[]> {
        if (element) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        const scanPath = config.get<string>('scanPath');

        // 清理 itemMap
        this.itemMap.clear();

        if (!scanPath) {
            return [new WorkitemItem(
                '点击配置扫描路径',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'markdown-ado-sync.configureScanPath',
                    title: '配置扫描路径'
                },
                undefined,
                undefined,
                this
            )];
        }

        try {
            const files = await this.markdownParser.scanDirectory(scanPath);
            const workitems = await Promise.all(
                files.map(async (file: string) => {
                    const metadata = await this.markdownParser.parseMetadata(file);
                    const item = new WorkitemItem(
                        metadata.title,
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'vscode.open',
                            title: '打开文件',
                            arguments: [vscode.Uri.file(file)]
                        },
                        file,
                        metadata.state,
                        this
                    );
                    this.itemMap.set(file, item);
                    return item;
                })
            );
            return workitems;
        } catch (error) {
            vscode.window.showErrorMessage(`获取工作项失败: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    async syncWorkitems(): Promise<void> {
        log('开始同步所有工作项...');
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "同步工作项",
            cancellable: false
        }, async (progress) => {
            try {
                const totalItems = this.itemMap.size;
                let completedItems = 0;
                
                // 将所有项目标记为同步中
                for (const [filePath] of this.itemMap) {
                    this.updateItemIcon(filePath, true);
                }

                // 模拟同步过程
                await new Promise(resolve => setTimeout(resolve, 5000));
                progress.report({ increment: 100, message: "同步完成" });
                log('同步所有工作项完成');
                
                // 同步成功后，恢复所有项目的图标
                for (const [filePath] of this.itemMap) {
                    this.updateItemIcon(filePath, false);
                }
            } catch (error) {
                // 同步失败后，恢复所有项目的图标
                for (const [filePath] of this.itemMap) {
                    this.updateItemIcon(filePath, false);
                }
                log(`同步所有工作项失败: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
            }
        });
    }

    async syncSingleWorkitem(filePath: string): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "同步工作项",
            cancellable: false
        }, async (progress) => {
            try {
                const metadata = await this.markdownParser.parseMetadata(filePath);
                log(`开始同步工作项: ${metadata.title}`);
                this.updateItemIcon(filePath, true);
                
                progress.report({ increment: 50, message: "正在同步..." });
                
                // 模拟同步过程
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                progress.report({ increment: 50, message: "同步完成" });
                log(`同步工作项完成: ${metadata.title}`);
                this.updateItemIcon(filePath, false);
                vscode.window.showInformationMessage(`同步工作项成功: ${metadata.title}`);
            } catch (error) {
                this.updateItemIcon(filePath, false);
                log(`同步工作项失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(`同步工作项失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
} 