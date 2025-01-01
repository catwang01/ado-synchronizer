import * as fs from 'fs';
import * as vscode from 'vscode';
import { IAdoService } from '../services/adoService';
import { ISyncLogManager, SyncLogEntry } from '../services/interfaces/ISyncLogManager';
import { CommentSection, MarkdownParser } from '../services/markdownParser';
import { Metadata } from '../services/Metadata';
import { StateTransformer } from '../services/stateTransformer';
import { SyncStateManager } from '../services/syncStateManager';
import { log } from '../utils';
import { WorkitemGroup } from './workitemGroup';
import { LogEntryGroupTreeItem } from './logEntryGroupTreeItem';
import { TreeItemStatus, WorkitemTreeItem } from './workitemTreeItem';

export class WorkitemProvider implements vscode.TreeDataProvider<WorkitemTreeItem | WorkitemGroup | LogEntryGroupTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkitemTreeItem | WorkitemGroup | LogEntryGroupTreeItem | undefined> = new vscode.EventEmitter<WorkitemTreeItem | WorkitemGroup | LogEntryGroupTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkitemTreeItem | WorkitemGroup | LogEntryGroupTreeItem | undefined> = this._onDidChangeTreeData.event;

    private itemMap: Map<string, WorkitemTreeItem> = new Map();
    private _scanPaths: string[] = [];
    private _stateFilter: string | undefined;

    constructor(
        private adoService: IAdoService,
        private markdownParser: MarkdownParser,
        private syncStateManager: SyncStateManager,
        private syncLogManager: ISyncLogManager
    ) { 
        this._scanPaths = vscode.workspace.getConfiguration('markdown-ado-sync').get<string[]>('scanPaths') || [];
    }

    get scanPaths(): string[] {
        if (this._scanPaths.length === 0) {
            throw new Error('扫描路径未配置');
        }
        return this._scanPaths;
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
                this.updateItemStatus(filePath, 'default');
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
        this.updateItemStatus(filePath, 'default');
        // 更新 label 显示修改状态
        const item = this.itemMap.get(filePath);
        if (item) {
            this.markdownParser.parseMetadata(filePath).then(metadata => {
                item.update(metadata);
                this._onDidChangeTreeData.fire(item);
            });
        }
    }

    getTreeItem(element: WorkitemTreeItem): vscode.TreeItem {
        return element;
    }

    private getLogGroupItems(element: WorkitemTreeItem): LogEntryGroupTreeItem[] {
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

        const logItems: LogEntryGroupTreeItem[] = [];
        let firstLog = false;
        for (const [_, groupLogs] of groupedLogs.entries()) {
            const latestLog = groupLogs[0];
            if (!firstLog && element.treeItemStatus === 'syncing') {
                firstLog = true;
                logItems.push(LogEntryGroupTreeItem.fromLogEntry(latestLog, element, 'syncing'));
                continue;
            }
            logItems.push(LogEntryGroupTreeItem.fromLogEntry(latestLog, element));
        }
        return logItems;
    }

    private async buildWorkItemGroups(): Promise<WorkitemGroup[]> {
        const files = await this.markdownParser.scanDirectory(this.scanPaths);
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

        const validWorkitems = workitems
            .filter((x): x is NonNullable<typeof x> => x !== null)
            .filter(item => !this._stateFilter || item.metadata.state === this._stateFilter);

        const groupedByParent = new Map<string | undefined, WorkitemTreeItem[]>();

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

    async getChildren(element?: WorkitemTreeItem | WorkitemGroup | LogEntryGroupTreeItem): Promise<(WorkitemTreeItem | WorkitemGroup | LogEntryGroupTreeItem)[]> {
        try {
            if (element instanceof WorkitemTreeItem && element.filePath) {
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
                this.updateItemStatus(filePath, 'syncing');
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
            this.updateItemStatus(filePath, 'syncing');
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
                this.updateItemStatus(filePath, 'failed');
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
                    this.updateItemStatus(filePath, 'success');
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

            this.updateItemStatus(filePath, 'success');
            return 'success';
        } catch (error) {
            this.syncLogManager.addLog(filePath, {
                timestamp: Date.now(),
                status: 'failed',
                message: '同步失败',
                details: error instanceof Error ? error.message : String(error),
                groupId
            });
            this.updateItemStatus(filePath, 'failed');
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
    ): WorkitemTreeItem {
        return new WorkitemTreeItem(
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

    private updateItemStatus(filePath: string, status: TreeItemStatus): void {
        const item = this.itemMap.get(filePath);
        if (item) {
            item.treeItemStatus = status;
            this._onDidChangeTreeData.fire(item);
        }
    }

    // 添加状态过滤方法
    setStateFilter(state: string | undefined) {
        this._stateFilter = state;
        this.refresh();
    }
}
