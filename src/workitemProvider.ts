import * as vscode from 'vscode';
import { IAdoService } from './services/adoService';
import { MarkdownParser, Metadata, CommentSection } from './services/markdownParser';
import { log } from './utils';
import { SyncStateManager } from './services/syncStateManager';
import * as fs from 'fs';
import { ISyncLogManager, SyncLogEntry } from './services/interfaces/ISyncLogManager';

// 私有 symbol 用于存储 provider 引用
const providerSymbol = Symbol('provider');

export type WorkItemUpdate = Partial<{
    title?: string;
    state?: string;
    workitemId?: string;
    workitemUrl?: string;
    type?: string;
    description?: string;
    iconPath?: vscode.ThemeIcon;
}>;

export class WorkitemItem extends vscode.TreeItem {
    private _state: string | undefined;
    private static adoConfig: { organization?: string; project?: string } = {};
    private syncLogManager: ISyncLogManager;

    private _workitemId?: string;
    private _workitemUrl?: string;
    private _type?: string;
    private _filePath?: string;
    private _isLogEntry: boolean;
    private _logEntryId?: string;
    private _logGroupId?: string;
    private _isLogGroup: boolean = false;

    get workitemId(): string | undefined { return this._workitemId; }
    get workitemUrl(): string | undefined { return this._workitemUrl; }
    get type(): string | undefined { return this._type; }
    get filePath(): string | undefined { return this._filePath; }
    get isLogEntry(): boolean { return this._isLogEntry; }
    get workItemState(): string | undefined { return this._state; }
    get logEntryId(): string | undefined { return this._logEntryId; }
    get logGroupId(): string | undefined { return this._logGroupId; }
    get isLogGroup(): boolean { return this._isLogGroup; }

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

    private computeTooltip(): vscode.MarkdownString {
        const tooltipParts = [
            this.label as string,
            this.workitemId ? `ID: ${this.workitemId}` : undefined,
            this.workitemUrl ? `[在 Azure DevOps 中打开](${this.workitemUrl})` : undefined,
            this.type ? `类型: ${this.type}` : undefined,
            this.filePath ? `文件: ${this.filePath}` : undefined
        ].filter(Boolean);

        const tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'), true);
        tooltip.isTrusted = true;
        tooltip.supportHtml = true;
        return tooltip;
    }

    private computeDescription(): string {
        if (this.isLogEntry) {
            return '';
        }

        const descriptionParts = [];
        if (this.workitemId) {
            descriptionParts.push(`#${this.workitemId}`);
        }
        if (this.type) {
            descriptionParts.push(`[${this.type}]`);
        }
        return descriptionParts.join(' ');
    }

    private computeInitialIcon(provider: WorkitemProvider): vscode.ThemeIcon {
        if (this.isLogEntry) {
            return new vscode.ThemeIcon('output');
        } else if (this.filePath && provider?.syncingItems.has(this.filePath)) {
            return new vscode.ThemeIcon('sync~spin');
        } else {
            return new vscode.ThemeIcon('circle-outline');
        }
    }

    constructor(
        label: string,
        syncLogManager: ISyncLogManager,
        provider: WorkitemProvider,
        public readonly command?: vscode.Command,
        filePath?: string,
        initialState?: string,
        workitemId?: string,
        workitemUrl?: string,
        type?: string,
        isLogEntry: boolean = false,
        logEntryId?: string,
        logGroupId?: string,
        isLogGroup: boolean = false
    ) {
        const displayLabel = initialState ? `${label} (${initialState})` : label;
        super(displayLabel);

        this.syncLogManager = syncLogManager;
        this._workitemId = workitemId;
        this._workitemUrl = workitemUrl;
        this._type = type;
        this._filePath = filePath;
        this._isLogEntry = isLogEntry;
        this._state = initialState;
        this._logEntryId = logEntryId;
        this._logGroupId = logGroupId;
        this._isLogGroup = isLogGroup;

        // @ts-ignore
        this[providerSymbol] = provider;

        this.collapsibleState = this.getCollapsibleState();

        // 只有非日志条目才有上下文菜单和命令
        if (this.isLogGroup) {
            // 日志组点击时显示日志内容
            this.command = {
                command: 'markdown-ado-sync.showLogs',
                title: '显示日志',
                arguments: [this]  // 传递当前项
            };
            this.collapsibleState = vscode.TreeItemCollapsibleState.None;  // 日志组不可折叠
        } else if (!this.isLogEntry) {
            this.contextValue = this.filePath && (this.workitemId || this.workitemUrl) ? 'workitem' : undefined;
            if (this.filePath) {
                this.command = {
                    command: 'vscode.open',
                    title: '打开文件',
                    arguments: [vscode.Uri.file(this.filePath)]
                };
            }
        }

        this.iconPath = this.computeInitialIcon(provider);
        this.tooltip = this.computeTooltip();
        this.description = this.computeDescription();
    }

    getCollapsibleState(): vscode.TreeItemCollapsibleState {
        if (this.isLogEntry) {
            return vscode.TreeItemCollapsibleState.None;
        }
        return this.filePath && this.syncLogManager?.getLogs(this.filePath).length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
    }

    update(updates: WorkItemUpdate): void {
        // 更新标题和状态
        if (updates.title || updates.state) {
            const displayLabel = updates.state ?
                `${updates.title || this.label} (${updates.state})` :
                updates.title;
            if (displayLabel) {
                this.label = displayLabel;
            }
            if (updates.state) {
                this._state = updates.state;
            }
        }

        this.description = this.computeDescription();
        this.tooltip = this.computeTooltip();
        if (updates.workitemId || updates.workitemUrl) {
            this.contextValue = this.filePath && (updates.workitemId || updates.workitemUrl) ? 'workitem' : undefined;
        }
        if (updates.iconPath) {
            this.iconPath = updates.iconPath;
        }
        this.collapsibleState = this.getCollapsibleState();
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
        private syncStateManager: SyncStateManager,
        private syncLogManager: ISyncLogManager
    ) { }

    private updateItemIcon(filePath: string, status: 'syncing' | 'success' | 'failed' | 'default' | 'skipped') {
        const item = this.itemMap.get(filePath);
        if (item) {
            if (status === 'syncing') {
                this.syncingItems.add(filePath);
            } else {
                this.syncingItems.delete(filePath);
            }

            var iconPath: vscode.ThemeIcon;
            // 更新图标
            switch (status) {
                case 'syncing':
                    iconPath = new vscode.ThemeIcon('sync~spin');
                    break;
                case 'success':
                    iconPath = new vscode.ThemeIcon('check');
                    break;
                case 'failed':
                    iconPath = new vscode.ThemeIcon('error');
                    break;
                default:
                    iconPath = new vscode.ThemeIcon('circle-outline');
            }
            item.update({
                iconPath: iconPath
            });
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
                    item.update(metadata);
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
                existingItem.update({
                    title: metadata.title,
                    state: metadata.state,
                    workitemId: metadata.workitemId,
                    workitemUrl: metadata.workitemUrl,
                    type: metadata.type
                });
                this._onDidChangeTreeData.fire(existingItem);
            } else {
                // 如果是新项目，创建它
                const newItem = new WorkitemItem(
                    metadata.title,
                    this.syncLogManager,
                    this,
                    {
                        command: 'vscode.open',
                        title: '打开文件',
                        arguments: [vscode.Uri.file(filePath)]
                    },
                    filePath,
                    metadata.state,
                    metadata.workitemId,
                    metadata.workitemUrl,
                    metadata.type,
                    false
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

    async getChildren(element?: WorkitemItem): Promise<WorkitemItem[]> {
        if (element?.filePath && !element.isLogEntry && !element.isLogGroup) {
            // 只处理工作项层级：显示日志组
            const logs = this.syncLogManager.getLogs(element.filePath);
            const groupedLogs = new Map<string, SyncLogEntry[]>();

            // 按 groupId 分组
            logs.forEach(log => {
                if (log.groupId) {
                    const group = groupedLogs.get(log.groupId) || [];
                    group.push(log);
                    groupedLogs.set(log.groupId, group);
                }
            });

            // 创建日志组项
            return Array.from(groupedLogs.entries()).map(([groupId, groupLogs]) => {
                const firstLog = groupLogs[0];
                const timestamp = new Date(firstLog.timestamp).toLocaleString();
                return new WorkitemItem(
                    `同步操作 (${timestamp})`,
                    this.syncLogManager,
                    this,
                    undefined,  // command 会在构造函数中设置
                    element.filePath,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    false,
                    undefined,
                    groupId,
                    true
                );
            });
        }

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
                this.syncLogManager,
                this,
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
                        this.syncLogManager,
                        this,
                        {
                            command: 'vscode.open',
                            title: '打开文件',
                            arguments: [vscode.Uri.file(file)]
                        },
                        file,
                        metadata.state,
                        metadata.workitemId,
                        metadata.workitemUrl,
                        metadata.type,
                        false
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
                const status = await this.syncSingleWorkitem(filePath);
                if (status === 'success') {
                    completedItems++;
                } else if (status === 'failed') {
                    failedItems++;
                } else if (status === 'skipped') {
                    // 跳过的工作项不计入统计
                    skippedItems++;
                }

                progress.report({
                    increment: (100 / totalItems),
                    message: `已同步 ${completedItems}/${totalItems} 个工作项, 失败: ${failedItems} 个, 跳过: ${skippedItems} 个`
                });
            }

            vscode.window.showInformationMessage(`已同步 ${completedItems}/${totalItems} 个工作项, 失败: ${failedItems} 个, 跳过: ${skippedItems} 个`);

            log('同步所有工作项完成');
        });
    }

    async syncComments(workItemId: string, fileComments: CommentSection[], content: string, filePath: string, groupId: string): Promise<void> {
        // 获取现有评论
        const existingComments = await this.adoService.getComments(workItemId);
        existingComments.sort((a, b) => a.id.localeCompare(b.id));

        // 创建评论ID到评论的映射
        fileComments.sort((a, b) => a.lineRange?.start! - b.lineRange?.start!);
        const minLength = Math.min(existingComments.length, fileComments.length);
        for (let i = 0; i < minLength; i++) {
            const existingComment = existingComments[i];
            const fileComment = fileComments[i];
            await this.adoService.updateComment(workItemId, existingComment.id, fileComment.text);
            this.syncLogManager.addLog(filePath, {
                timestamp: Date.now(),
                status: 'success',
                message: '更新评论',
                details: `更新评论: ${fileComment.text.substring(0, 50)}...`,
                groupId
            });
        }
        if (existingComments.length > fileComments.length) {
            // 删除多余的评论
            for (const comment of existingComments.slice(fileComments.length)) {
                await this.adoService.deleteComment(workItemId, comment.id);
                this.syncLogManager.addLog(filePath, {
                    timestamp: Date.now(),
                    status: 'success',
                    message: '删除评论',
                    details: `删除评论: ${comment.text.substring(0, 50)}...`,
                    groupId
                });
            }
        }
        if (fileComments.length > existingComments.length) {
            // 添加新的评论
            for (const comment of fileComments.slice(existingComments.length)) {
                await this.adoService.addComment(workItemId, comment.text);
                this.syncLogManager.addLog(filePath, {
                    timestamp: Date.now(),
                    status: 'success',
                    message: '添加评论',
                    details: `新评论: ${comment.text.substring(0, 50)}...`,
                    groupId
                });
            }
        }

        // 处理新增的评论
        for (const comment of fileComments) {
            if (!comment.id) {
                // 新评论
                const commentId = await this.adoService.addComment(workItemId, comment.text);
                // 更新文件中的评论ID
                const index = fileComments.indexOf(comment);
                const updatedContent = await this.markdownParser.updateCommentId(content, index, commentId);
                await fs.promises.writeFile(filePath, updatedContent, 'utf-8');

                this.syncLogManager.addLog(filePath, {
                    timestamp: Date.now(),
                    status: 'success',
                    message: '添加评论',
                    details: `新评论: ${comment.text.substring(0, 50)}...`,
                    groupId
                });
            }
        }
    }

    async syncSingleWorkitem(filePath: string): Promise<'success' | 'failed' | 'skipped'> {
        const groupId = Date.now().toString();
        try {
            this.updateItemIcon(filePath, 'syncing');
            this.syncLogManager.addLog(filePath, {
                timestamp: Date.now(),
                status: 'success',
                message: '开始同步...',
                groupId
            });
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const { metadata, description, comments } = this.markdownParser.parseContent(content);
            if (!metadata.state) {
                this.syncLogManager.addLog(filePath, {
                    timestamp: Date.now(),
                    status: 'failed',
                    message: '同步失败',
                    details: '工作项状态为空',
                    groupId
                });
                this.updateItemIcon(filePath, 'failed');
                return 'failed';
            }

            if (metadata.workitemId) {
                // 更新现有工作项
                const remoteWorkItem = await this.adoService.getWorkItem(metadata.workitemId);
                if (remoteWorkItem.state === metadata.state) {
                    this.syncLogManager.addLog(filePath, {
                        timestamp: Date.now(),
                        status: 'skipped',
                        message: '工作项状态相同，跳过同步',
                        details: `工作项 ${metadata.workitemId} 状态为 ${metadata.state}`,
                        groupId
                    });
                    this.updateItemIcon(filePath, 'success');
                    return 'skipped';
                }

                await this.adoService.updateWorkItem(metadata.workitemId, {
                    title: metadata.title,
                    description: description,
                    state: metadata.state
                });

                this.syncLogManager.addLog(filePath, {
                    timestamp: Date.now(),
                    status: 'success',
                    message: '更新工作项',
                    details: `更新工作项 ${metadata.workitemId} 为 ${metadata.state}`,
                    groupId
                });

                // 同步评论
                await this.syncComments(metadata.workitemId, comments, content, filePath, groupId);
            } else {
                // 创建新工作项
                const id = await this.adoService.createWorkItem(metadata.type || 'Task', {
                    title: metadata.title,
                    description: description,
                    state: metadata.state || ''
                });

                // 添加评论
                for (const comment of comments) {
                    await this.adoService.addComment(id, comment.text);
                }

                // 更新文件中的工作项 ID
                const updatedContent = await this.markdownParser.updateWorkItemId(content, id);
                await fs.promises.writeFile(filePath, updatedContent, 'utf-8');
            }

            // 更新同步状态
            await this.syncStateManager.updateSyncState(filePath, true, metadata.workitemId);

            this.syncLogManager.addLog(filePath, {
                timestamp: Date.now(),
                status: 'success',
                message: '同步成功',
                details: `已更新工作项 ${metadata.workitemId || 'new'}`,
                groupId
            });

            this.updateItemIcon(filePath, 'success');
            return 'success';
        } catch (error) {
            this.syncLogManager.addLog(filePath, {
                timestamp: Date.now(),
                status: 'failed',
                message: '同步失败',
                details: error instanceof Error ? error.message : String(error),
                groupId
            });

            this.updateItemIcon(filePath, 'failed');
            return 'failed';
        }
    }

    // 当需要刷新日志显示时调用
    refreshLogs(filePath: string): void {
        const item = this.itemMap.get(filePath);
        if (item) {
            this._onDidChangeTreeData.fire(item);
        }
    }

    // 添加公共方法来获取日志组
    public getLogGroup(filePath: string, groupId: string): SyncLogEntry[] {
        return this.syncLogManager.getLogGroup(filePath, groupId);
    }
}
