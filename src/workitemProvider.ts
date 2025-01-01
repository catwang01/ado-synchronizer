import * as fs from 'fs';
import * as vscode from 'vscode';
import { IAdoService } from './services/adoService';
import { ISyncLogManager, SyncLogEntry } from './services/interfaces/ISyncLogManager';
import { CommentSection, MarkdownParser } from './services/markdownParser';
import { Metadata } from './services/Metadata';
import { StateTransformer } from './services/stateTransformer';
import { SyncStateManager } from './services/syncStateManager';
import { log } from './utils';

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

export type GroupStatus = 'success' | 'failed' | 'skipped' | 'syncing';

export class WorkitemItem extends vscode.TreeItem {
    private _state: string | undefined;
    private static adoConfig: { organization?: string; project?: string } = {};
    private syncLogManager: ISyncLogManager;

    private _workitemId?: string;
    private _workitemUrl?: string;
    private _type?: string;
    private _filePath?: string;
    private _logGroupId?: string;
    private _isLogGroup: boolean = false;
    private _groupStatus?: GroupStatus;
    private _syncing: boolean = false;

    get syncing(): boolean { return this._syncing; }

    set syncing(syncing: boolean) {
        this._syncing = syncing;
        this.iconPath = this.computeInitialIcon();
    }

    get workitemId(): string | undefined { return this._workitemId; }
    get workitemUrl(): string | undefined { return this._workitemUrl; }
    get type(): string | undefined { return this._type; }
    get filePath(): string | undefined { return this._filePath; }
    get workItemState(): string | undefined { return this._state; }
    get logGroupId(): string | undefined { return this._logGroupId; }
    get isLogGroup(): boolean { return this._isLogGroup; }
    get groupStatus(): GroupStatus | undefined { return this._groupStatus; }

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

    private computeInitialIcon(): vscode.ThemeIcon {
        if (this.isLogGroup) {
            switch (this.groupStatus) {
                case 'success':
                    return new vscode.ThemeIcon('check');
                case 'failed':
                    return new vscode.ThemeIcon('error');
                case 'skipped':
                    return new vscode.ThemeIcon('history');
                case 'syncing':
                    return new vscode.ThemeIcon('sync~spin');
                default:
                    return new vscode.ThemeIcon('circle-outline');
            }
        } else if (this.syncing) {
            return new vscode.ThemeIcon('sync~spin');
        } else {
            return new vscode.ThemeIcon('circle-outline');
        }
    }

    private computeCommand(): vscode.Command | undefined {
        if (this.isLogGroup) {
            return {
                command: 'markdown-ado-sync.showLogs',
                title: '显示日志',
                arguments: [this.filePath, this.logGroupId]
            };
        } else if (this.filePath) {
            return {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [vscode.Uri.file(this.filePath)]
            };
        }
        return undefined;
    }

    constructor(
        label: string,
        syncLogManager: ISyncLogManager,
        provider: WorkitemProvider,
        filePath?: string,
        initialState?: string,
        workitemId?: string,
        workitemUrl?: string,
        type?: string,
        isLogGroup: boolean = false,
        logGroupId?: string,
        groupStatus?: GroupStatus
    ) {
        const displayLabel = initialState ? `${label} (${initialState})` : label;
        super(displayLabel);

        this.syncLogManager = syncLogManager;
        this._workitemId = workitemId;
        this._workitemUrl = workitemUrl;
        this._type = type;
        this._filePath = filePath;
        this._state = initialState;
        this._logGroupId = logGroupId;
        this._isLogGroup = isLogGroup;
        this._groupStatus = groupStatus;

        // @ts-ignore
        this[providerSymbol] = provider;

        // 设置图标和工具提示
        this.iconPath = this.computeInitialIcon();
        this.tooltip = this.computeTooltip();
        this.description = this.computeDescription();

        // 设置命令和上下文
        this.command = this.computeCommand();
        if (!this.isLogGroup) {
            this.contextValue = this.filePath && (this.workitemId || this.workitemUrl) ? 'workitem' : undefined;
        }
        this.collapsibleState = this.getCollapsibleState();
    }

    private getCollapsibleState(): vscode.TreeItemCollapsibleState {
        if (this.isLogGroup) {
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
        const descriptionParts = [];
        if (this.workitemId) {
            descriptionParts.push(`#${this.workitemId}`);
        }
        if (this.type) {
            descriptionParts.push(`[${this.type}]`);
        }
        return descriptionParts.join(' ');
    }
}

export class WorkitemProvider implements vscode.TreeDataProvider<WorkitemItem> {
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
                item.syncing = true;
            } else {
                item.syncing = false;
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

    refreshToState(filePath: string): void {
        this.updateItemIcon(filePath, 'default');
        // 更新 label 显示修改状态
        const item = this.itemMap.get(filePath);
        if (item) {
            this.markdownParser.parseMetadata(filePath).then(metadata => {
                item.update(metadata);
                this._onDidChangeTreeData.fire(item);
            });
        }
    }


    getTreeItem(element: WorkitemItem): vscode.TreeItem {
        return element;
    }

    private getLogGroupItems(element: WorkitemItem): WorkitemItem[] {
        if (!element.filePath) {
            return [];
        }
        const logs = this.syncLogManager.getLogs(element.filePath);
        const groupedLogs = new Map<string, SyncLogEntry[]>();

        let firstGroupId: string | undefined;
        for (const log of logs) {
            if (log.groupId) {
                const group = groupedLogs.get(log.groupId) || [];
                group.push(log);
                groupedLogs.set(log.groupId, group);
                if (!firstGroupId) {
                    firstGroupId = log.groupId;
                }
            }
        }

        return Array.from(groupedLogs.entries()).map(([groupId, groupLogs]) => {
            const latestLogEntry = groupLogs[0];
            const timestamp = new Date(latestLogEntry.timestamp).toLocaleString();

            let groupStatus: GroupStatus;
            if (firstGroupId === groupId && element.syncing) {
                groupStatus = 'syncing';
            }
            else {
                groupStatus = latestLogEntry.status;
            }

            return new WorkitemItem(
                `同步操作 (${timestamp})`,
                this.syncLogManager,
                this,
                element.filePath,
                undefined,
                undefined,
                undefined,
                undefined,
                true,  // isLogGroup
                groupId,
                groupStatus
            );
        });
    }

    async getChildren(element?: WorkitemItem): Promise<WorkitemItem[]> {
        if (!element) {
            return this.scanWorkItems();
        }
        if (element?.filePath && !element.isLogGroup) {
            return this.getLogGroupItems(element);
        }
        return [];
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
                details: `更新评论: from ${existingComment.text.substring(0, 50)} to ${fileComment.text.substring(0, 50)}...`,
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
            let { metadata, description, comments } = this.markdownParser.parseContent(content);
            if (metadata.workitemId === undefined || metadata.workitemId === null || metadata.workitemId === '') {
                this.syncLogManager.addLog(filePath, {
                    timestamp: Date.now(),
                    status: 'failed',
                    message: '工作项 ID 缺失',
                    details: `工作项 ID 缺失`,
                    groupId
                });
                this.updateItemIcon(filePath, 'failed');
                return 'failed';
            }

            // 获取远程工作项信息
            const workItem = await this.adoService.getWorkItem(metadata.workitemId);
            let needsUpdate = false;
            const updates: Partial<Metadata> = {};

            const checkMetadataFields: string[] = ['type', 'title', 'parentId'];
            for (const field of checkMetadataFields) {
                const fieldValue = metadata[field as keyof Metadata];
                if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
                    // @ts-ignore
                    if (workItem[field] !== undefined) {
                        // @ts-ignore
                        updates[field] = workItem[field];
                        needsUpdate = true;
                        this.syncLogManager.addLog(filePath, {
                            timestamp: Date.now(),
                            status: 'success',
                            message: '从 ADO 获取工作项类型',
                            details: `类型: ${workItem.type}`,
                            groupId
                        });
                    }
                }
            }

            // 如果需要更新元数据
            if (needsUpdate) {
                await this.markdownParser.updateMetadata(filePath, updates);
                metadata = { ...metadata, ...updates };
            }

            const adoState = StateTransformer.toAdoState(metadata.state, metadata.type);
            // 检查状态是否需要同步
            if (workItem.state === adoState) {
                if (!await this.syncStateManager.needsSync(filePath)) {
                    this.syncLogManager.addLog(filePath, {
                        timestamp: Date.now(),
                        status: 'skipped',
                        message: '工作项状态相同，跳过同步',
                        details: `工作项 ${metadata.workitemId} 状态为 ${metadata.state}, remote state: ${workItem.state}`,
                        groupId
                    });
                    this.updateItemIcon(filePath, 'success');
                    return 'skipped';
                }
            }

            await this.adoService.updateWorkItem(metadata.workitemId!, {
                title: metadata.title,
                description: description,
                state: adoState
            });

            this.syncLogManager.addLog(filePath, {
                timestamp: Date.now(),
                status: 'success',
                message: '更新工作项',
                details: `更新工作项 ${metadata.workitemId} 从 ${workItem.state} 到 ${adoState}`,
                groupId
            });

            // 同步评论
            await this.syncComments(metadata.workitemId!, comments, content, filePath, groupId);

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

    private async scanWorkItems(): Promise<WorkitemItem[]> {
        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        const scanPath = config.get<string>('scanPath');

        this.itemMap.clear();

        if (!scanPath) {
            return [new WorkitemItem(
                '点击配置扫描路径',
                this.syncLogManager,
                this
            )];
        }

        try {
            const files = await this.markdownParser.scanDirectory(scanPath);
            const workitems = await Promise.all(
                files.map(async (file: string) => {
                    try {
                        const metadata = await this.markdownParser.parseMetadata(file);
                        const item = new WorkitemItem(
                            metadata.title,
                            this.syncLogManager,
                            this,
                            file,
                            metadata.state,
                            metadata.workitemId,
                            metadata.workitemUrl,
                            metadata.type,
                            false
                        );
                        this.itemMap.set(file, item);
                        return item;
                    }
                    catch (error) {
                        return null;
                    }
                })
            );
            return workitems.filter(x => x !== null);
        } catch (error) {
            vscode.window.showErrorMessage(`获取工作项失败: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
}
