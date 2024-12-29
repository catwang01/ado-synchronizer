import * as vscode from 'vscode';
import { IAdoService } from './services/adoService';
import { MarkdownParser } from './services/markdownParser';
import { log } from './utils';
import { StateIcons, WorkItemState } from './constants/icons';
import { SyncStateManager } from './services/syncStateManager';

// 私有 symbol 用于存储 provider 引用
const providerSymbol = Symbol('provider');

export class WorkitemItem extends vscode.TreeItem {
    private _state: string | undefined;
    private static adoConfig: { organization?: string; project?: string } = {};

    static setAdoConfig(organization: string, project: string) {
        WorkitemItem.adoConfig = { organization, project };
    }

    static getWorkItemUrl(workItemId: string): string | undefined {
        const { organization, project } = WorkitemItem.adoConfig;
        if (!organization || !project) {
            return undefined;
        }
        return `https://dev.azure.com/${organization}/${project}/_workitems/edit/${workItemId}`;
    }

    constructor(
        label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly filePath?: string,
        initialState?: string,
        provider?: WorkitemProvider,
        workItemId?: string,
        workItemUrl?: string,
        type?: string
    ) {
        // 在 label 中显示状态
        const displayLabel = initialState ? `${label} (${initialState})` : label;
        super(displayLabel, collapsibleState);

        this.contextValue = filePath && (workItemId || workItemUrl) ? 'workitem' : undefined;
        this._state = initialState;

        if (provider) {
            // @ts-ignore
            this[providerSymbol] = provider;
        }

        // 设置图标 - 只显示同步状态
        if (filePath && provider?.syncingItems.has(filePath)) {
            this.iconPath = new vscode.ThemeIcon('sync~spin');
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }

        // 设置工具提示，显示详细信息
        const tooltipParts = [
            displayLabel,
            workItemId ? `ID: ${workItemId}` : undefined,
            workItemUrl ? `[在 Azure DevOps 中打开](${workItemUrl})` : undefined,
            type ? `类型: ${type}` : undefined,
            filePath ? `文件: ${filePath}` : undefined
        ].filter(Boolean);

        const tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'), true);
        tooltip.isTrusted = true;
        tooltip.supportHtml = true;
        this.tooltip = tooltip;

        // 设置描述，显示工作项 ID 和类型
        const descriptionParts = [];
        if (workItemId) {
            descriptionParts.push(`#${workItemId}`);
        }
        if (type) {
            descriptionParts.push(`[${type}]`);
        }
        this.description = descriptionParts.join(' ');
    }

    get workItemState(): string | undefined {
        return this._state;
    }

    update(metadata: { 
        title: string;
        state?: string;
        workItemId?: string;
        workItemUrl?: string;
        type?: string;
    }): void {
        // 更新标题和状态
        const displayLabel = metadata.state ? `${metadata.title} (${metadata.state})` : metadata.title;
        this.label = displayLabel;
        this._state = metadata.state;

        // 设置描述，显示工作项 ID 和类型
        const descriptionParts = [];
        if (metadata.workItemId) {
            descriptionParts.push(`#${metadata.workItemId}`);
        }
        if (metadata.type) {
            descriptionParts.push(`[${metadata.type}]`);
        }
        this.description = descriptionParts.join(' ');

        // 设置工具提示，显示详细信息和可点击链接
        const tooltipParts = [
            displayLabel,
            metadata.workItemId ? `ID: ${metadata.workItemId}` : undefined,
            metadata.workItemUrl ? `[在 Azure DevOps 中打开](${metadata.workItemUrl})` : undefined,
            metadata.type ? `类型: ${metadata.type}` : undefined,
            this.filePath ? `文件: ${this.filePath}` : undefined
        ].filter(Boolean);

        const tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'), true);
        tooltip.isTrusted = true;
        tooltip.supportHtml = true;
        this.tooltip = tooltip;

        // 更新 contextValue
        this.contextValue = this.filePath && (metadata.workItemId || metadata.workItemUrl) ? 'workitem' : undefined;
    }
}

export class WorkitemProvider implements vscode.TreeDataProvider<WorkitemItem> {
    // 使内部类的 syncingItems 可以被 WorkitemItem 访问
    readonly syncingItems: Set<string> = new Set();

    private _onDidChangeTreeData: vscode.EventEmitter<WorkitemItem | undefined> = new vscode.EventEmitter<WorkitemItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkitemItem | undefined> = this._onDidChangeTreeData.event;

    private itemMap: Map<string, WorkitemItem> = new Map();

    constructor(
        private adoService: IAdoService,
        private markdownParser: MarkdownParser,
        private syncStateManager: SyncStateManager
    ) { }

    private updateItemIcon(filePath: string, status: 'syncing' | 'success' | 'failed' | 'default') {
        const item = this.itemMap.get(filePath);
        if (item) {
            if (status === 'syncing') {
                this.syncingItems.add(filePath);
            } else {
                this.syncingItems.delete(filePath);
            }

            // 更新图标
            switch (status) {
                case 'syncing':
                    item.iconPath = new vscode.ThemeIcon('sync~spin');
                    break;
                case 'success':
                    item.iconPath = new vscode.ThemeIcon('check');
                    break;
                case 'failed':
                    item.iconPath = new vscode.ThemeIcon('error');
                    break;
                default:
                    item.iconPath = new vscode.ThemeIcon('circle-outline');
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

    async refreshModified(): Promise<void> {
        const modifiedItems: string[] = [];

        // 检查所有文件是否需要同步
        for (const [filePath] of this.itemMap) {
            if (await this.syncStateManager.needsSync(filePath)) {
                modifiedItems.push(filePath);
                this.updateItemIcon(filePath, 'default');
                // 更新 label 显示修改状态
                const item = this.itemMap.get(filePath);
                if (item) {
                    const metadata = await this.markdownParser.parseMetadata(filePath);
                    const displayLabel = metadata.title + ' (已修改)';
                    item.label = displayLabel;
                    this._onDidChangeTreeData.fire(item);
                }
            }
        }

        if (modifiedItems.length > 0) {
            vscode.window.showInformationMessage(`发现 ${modifiedItems.length} 个已修改的工作项`);
        }
    }

    async refreshItem(filePath: string): Promise<void> {
        try {
            const metadata = await this.markdownParser.parseMetadata(filePath);
            const existingItem = this.itemMap.get(filePath);
            
            if (existingItem) {
                // 如果项目已存在，更新它
                existingItem.update(metadata);
                this._onDidChangeTreeData.fire(existingItem);
            } else {
                // 如果是新项目，创建它
                const newItem = new WorkitemItem(
                    metadata.title,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'vscode.open',
                        title: '打开文件',
                        arguments: [vscode.Uri.file(filePath)]
                    },
                    filePath,
                    metadata.state,
                    this,
                    metadata.workitemId,
                    metadata.workitemUrl,
                    metadata.type
                );
                this.itemMap.set(filePath, newItem);
                this._onDidChangeTreeData.fire(newItem);
            }
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
                }
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
                        this,
                        metadata.workitemId,
                        metadata.workitemUrl,
                        metadata.type
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
        }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
                const totalItems = this.itemMap.size;
                let completedItems = 0;
                let failedItems = 0;
                let skippedItems = 0;

                // 设置所有项目为同步中状态
                for (const [filePath] of this.itemMap) {
                    this.updateItemIcon(filePath, 'syncing');
                }

                // 同步每个工作项
                for (const [filePath] of this.itemMap) {
                    try {
                        const result = await this.syncSingleWorkitem(filePath);
                        if (result === 'skipped') {
                            skippedItems++;
                        } else if (result === 'failed') {
                            failedItems++;
                        }
                        completedItems++;
                        progress.report({ 
                            increment: (100 / totalItems), 
                            message: `已同步 ${completedItems}/${totalItems} 个工作项, 失败: ${failedItems} 个, 跳过: ${skippedItems} 个` 
                        });
                    } catch (error) {
                        failedItems++;
                        log(`同步工作项失败: ${filePath}, ${error instanceof Error ? error.message : String(error)}`);
                    }
                }

                if (failedItems > 0) {
                    vscode.window.showErrorMessage('部分工作项同步失败，请查看日志了解详情');
                } else {
                    vscode.window.showInformationMessage('所有工作项同步完成！');
                }

                log('同步所有工作项完成');
        });
    }

    async syncSingleWorkitem(filePath: string): Promise<'success' | 'failed' | 'skipped'> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "同步工作项",
            cancellable: false
        }, async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
            try {
                // 检查是否需要同步
                if (!await this.syncStateManager.needsSync(filePath)) {
                    log(`跳过同步，文件未修改: ${filePath}`);
                    // 1 秒后更新图标, 避免跳过 syncing 状态直接到 success 状态
                    setTimeout(() => this.updateItemIcon(filePath, 'success'), 1000);
                    return 'skipped';
                }

                const metadata = await this.markdownParser.parseMetadata(filePath);
                log(`开始同步工作项: ${metadata.title}`);
                this.updateItemIcon(filePath, 'syncing');
                
                progress.report({ increment: 30, message: "正在读取文件..." });
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
                const markdownContent = content.toString();

                progress.report({ increment: 30, message: "正在同步到 ADO..." });
                
                if (metadata.workitemId) {
                    await this.adoService.updateWorkItem(metadata.workitemId, {
                        title: metadata.title,
                        description: markdownContent,
                        state: metadata.state
                    });
                    await this.syncStateManager.updateSyncState(filePath, true, metadata.workitemId);
                } else {
                    const type = metadata.type || 'Task'; // 默认创建 Task 类型
                    const newId = await this.adoService.createWorkItem(type, {
                        title: metadata.title,
                        description: markdownContent,
                        state: metadata.state
                    });
                    await this.syncStateManager.updateSyncState(filePath, true, newId);
                }
                
                progress.report({ increment: 40, message: "同步完成" });
                log(`同步工作项完成: ${metadata.title}`);
                this.updateItemIcon(filePath, 'success');
                vscode.window.showInformationMessage(`同步工作项成功: ${metadata.title}`);
                return 'success';
            } catch (error) {
                this.updateItemIcon(filePath, 'failed');
                await this.syncStateManager.updateSyncState(filePath, false);
                log(`同步工作项失败: ${error instanceof Error ? error.message : String(error)}`);
                vscode.window.showErrorMessage(`同步工作项失败: ${error instanceof Error ? error.message : String(error)}`);
                return 'failed';
            }
        });
    }
}
