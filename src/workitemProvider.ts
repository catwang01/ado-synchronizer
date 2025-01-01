import * as fs from 'fs';
import * as vscode from 'vscode';
import { IAdoService } from './services/adoService';
import { ISyncLogManager, SyncLogEntry } from './services/interfaces/ISyncLogManager';
import { CommentSection, MarkdownParser } from './services/markdownParser';
import { Metadata } from './services/Metadata';
import { StateTransformer } from './services/stateTransformer';
import { SyncStateManager } from './services/syncStateManager';
import { log } from './utils';
import { WorkitemGroup } from './workitemGroup';
import { LogEntryGroupTreeItem } from './logEntryGroupTreeItem';

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
    private static adoConfig: { organization?: string; project?: string } = {};
    private _syncing: boolean = false;
    private [providerSymbol]: WorkitemProvider;

    private _workitemId?: string;
    private _workitemUrl?: string;
    private _type?: string;
    private _filePath?: string;
    private _state?: string;

    get workitemId(): string | undefined { return this._workitemId; }
    get workitemUrl(): string | undefined { return this._workitemUrl; }
    get type(): string | undefined { return this._type; }
    get filePath(): string | undefined { return this._filePath; }
    get state(): string | undefined { return this._state; }
    get syncing(): boolean { return this._syncing; }
    set syncing(value: boolean) {
        this._syncing = value;
        this.iconPath = this.computeInitialIcon();
    }

    constructor(
        label: string,
        provider: WorkitemProvider,
        filePath?: string,
        workitemId?: string,
        workitemUrl?: string,
        type?: string,
        state?: string
    ) {
        // 使用公共方法检查日志
        const hasLogs = filePath ? provider.hasLogs(filePath) : false;
        super(label, hasLogs ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        this[providerSymbol] = provider;
        this._workitemId = workitemId;
        this._workitemUrl = workitemUrl;
        this._type = type;
        this._filePath = filePath;
        this._state = state;

        // 设置图标和工具提示
        this.iconPath = this.computeInitialIcon();
        this.tooltip = this.computeTooltip();
        this.description = this.computeDescription();

        // 设置命令和上下文
        this.command = this.computeCommand();
        if (this.filePath && (this.workitemId || this.workitemUrl)) {
            this.contextValue = 'workitem';
        }
    }

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

    setSyncingState(syncing: boolean): void {
        this.syncing = syncing;
    }

    private computeInitialIcon(): vscode.ThemeIcon {
        if (this._syncing) {
            return new vscode.ThemeIcon('sync~spin');
        }
        return new vscode.ThemeIcon('circle-outline');
    }

    private computeTooltip(): vscode.MarkdownString {
        const tooltipParts = [
            this.label as string,
            this.workitemId ? `ID: ${this.workitemId}` : undefined,
            this.workitemUrl ? `[在 Azure DevOps 中打开](${this.workitemUrl})` : undefined,
            this.type ? `类型: ${this.type}` : undefined,
            this.state ? `状态: ${this.state}` : undefined,
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
        if (this.state) {
            descriptionParts.push(`(${this.state})`);
        }
        return descriptionParts.join(' ');
    }

    private computeCommand(): vscode.Command | undefined {
        if (this.filePath) {
            return {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [vscode.Uri.file(this.filePath)]
            };
        }
        return undefined;
    }

    update(updates: {
        title?: string;
        state?: string;
        workitemId?: string;
        workitemUrl?: string;
        iconPath?: vscode.ThemeIcon;
    }): void {
        if (updates.title) {
            this.label = updates.title;
        }
        if (updates.state) {
            this._state = updates.state;
        }
        if (updates.workitemId) {
            this._workitemId = updates.workitemId;
        }
        if (updates.workitemUrl) {
            this._workitemUrl = updates.workitemUrl;
        }
        if (updates.iconPath) {
            this.iconPath = updates.iconPath;
        }

        this.description = this.computeDescription();
        this.tooltip = this.computeTooltip();
    }
}

export class WorkitemProvider implements vscode.TreeDataProvider<WorkitemItem | WorkitemGroup | LogEntryGroupTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkitemItem | WorkitemGroup | LogEntryGroupTreeItem | undefined> = new vscode.EventEmitter<WorkitemItem | WorkitemGroup | LogEntryGroupTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkitemItem | WorkitemGroup | LogEntryGroupTreeItem | undefined> = this._onDidChangeTreeData.event;

    private itemMap: Map<string, WorkitemItem> = new Map();
    private _scanPath: string | undefined;

    constructor(
        private adoService: IAdoService,
        private markdownParser: MarkdownParser,
        private syncStateManager: SyncStateManager,
        private syncLogManager: ISyncLogManager
    ) { 
        this._scanPath = vscode.workspace.getConfiguration('markdown-ado-sync').get<string>('scanPath');
    }

    get scanPath(): string {
        if (!this._scanPath) {
            throw new Error('扫描路径未配置');
        }
        return this._scanPath;
    }

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

    private getLogGroupItems(element: WorkitemItem): LogEntryGroupTreeItem[] {
        const logs = this.syncLogManager.getLogs(element.filePath!);
        if (!logs.length) {
            return [];
        }

        const groupedLogs = new Map<string, SyncLogEntry[]>();
        for (const log of logs) {
            if (log.groupId) {
                const group = groupedLogs.get(log.groupId) || [];
                group.push(log);
                groupedLogs.set(log.groupId, group);
            }
        }

        return Array.from(groupedLogs.entries()).map(([groupId, groupLogs]) => {
            const latestLog = groupLogs[0];
            return LogEntryGroupTreeItem.fromLogEntry(latestLog, element.filePath!);
        });
    }

    private async buildWorkItemGroups(): Promise<WorkitemGroup[]> {
        const files = await this.markdownParser.scanDirectory(this.scanPath);
        const workitems = await Promise.all(
            files.map(async (file: string) => {
                try {
                    const metadata = await this.markdownParser.parseMetadata(file);
                    return {
                        metadata,
                        file,
                        workItem: this.createWorkItem(metadata.title, file, metadata)
                    };
                } catch (error) {
                    return null;
                }
            })
        );

        const validWorkitems = workitems.filter((x): x is NonNullable<typeof x> => x !== null);
        const groupedByParent = new Map<string | undefined, WorkitemItem[]>();

        validWorkitems.forEach(item => {
            const parentId = item.metadata.parentId;
            const group = groupedByParent.get(parentId) || [];
            group.push(item.workItem);
            this.itemMap.set(item.file, item.workItem);
            groupedByParent.set(parentId, group);
        });
        
        const modifiedItems = groupedByParent.get(undefined)?.filter(item => {
            if (groupedByParent.has(item.workitemId)) {
                groupedByParent.get(item.workitemId)?.push(item);
                return false;
            }
            return true;
        });
        if (modifiedItems) {
            groupedByParent.set(undefined, modifiedItems);
        }

        return Array.from(groupedByParent.entries()).map(([parentId, items]) => {
            const label = parentId ? `父工作项 #${parentId}` : '无父工作项';
            return new WorkitemGroup(
                label,
                items,
                parentId
            );
        });
    }

    async getChildren(element?: WorkitemItem | WorkitemGroup | LogEntryGroupTreeItem): Promise<(WorkitemItem | WorkitemGroup | LogEntryGroupTreeItem)[]> {
        try {
            if (element instanceof WorkitemItem && element.filePath) {
                return this.getLogGroupItems(element);
            }

            if (element instanceof WorkitemGroup) {
                return element.children;
            }

            // 根节点：获取所有工作项并按 parentId 分组
            return this.buildWorkItemGroups();
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

    private createWorkItem(
        label: string,
        filePath: string,
        metadata: Metadata
    ): WorkitemItem {
        return new WorkitemItem(
            label,
            this,
            filePath,
            metadata.workitemId,
            metadata.workitemUrl,
            metadata.type,
            metadata.state
        );
    }

    // 添加公共方法来检查文件是否有日志
    hasLogs(filePath: string): boolean {
        return this.syncLogManager.getLogs(filePath).length > 0;
    }
}
