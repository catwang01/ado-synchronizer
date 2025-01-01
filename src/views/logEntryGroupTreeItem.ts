import * as vscode from 'vscode';
import { SyncLogEntry } from '../services/interfaces/ISyncLogManager';
import { WorkitemTreeItem } from './workitemTreeItem';

export class LogEntryGroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly timestamp: number,
        public readonly status: 'success' | 'failed' | 'skipped' | 'syncing',
        public readonly filePath: string,
        public readonly groupId: string,
        public readonly parentItem: WorkitemTreeItem
    ) {
        const label = `同步操作 (${new Date(timestamp).toLocaleString()})`;
        super(label, vscode.TreeItemCollapsibleState.None);

        // 设置图标
        this.iconPath = this.computeIcon();
        
        // 设置命令
        this.command = {
            command: 'markdown-ado-sync.showLogs',
            title: '显示日志',
            arguments: [this.filePath, this.groupId]
        };

        // 设置工具提示
        this.tooltip = this.computeTooltip();
    }

    private computeIcon(): vscode.ThemeIcon {
        switch (this.status) {
            case 'success':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'skipped':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconSkipped'));
            case 'syncing':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private computeTooltip(): string {
        const workItemInfo = this.parentItem ? 
            `工作项: ${this.parentItem.label} (#${this.parentItem.workitemId})\n` : '';
        return `${workItemInfo}同步状态: ${this.status.toUpperCase()}\n时间: ${new Date(this.timestamp).toLocaleString()}`;
    }

    static fromLogEntry(entry: SyncLogEntry, parentItem: WorkitemTreeItem, status?: 'success' | 'failed' | 'skipped' | 'syncing'): LogEntryGroupTreeItem {
        return new LogEntryGroupTreeItem(
            entry.timestamp,
            status ?? entry.status,
            parentItem.filePath!,
            entry.groupId!,
            parentItem
        );
    }
} 