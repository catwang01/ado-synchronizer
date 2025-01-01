import * as vscode from 'vscode';
import { SyncLogEntry } from './services/interfaces/ISyncLogManager';

export class LogEntryGroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly timestamp: number,
        public readonly status: 'success' | 'failed' | 'skipped' | 'syncing',
        public readonly filePath: string,
        public readonly groupId: string
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
                return new vscode.ThemeIcon('check');
            case 'failed':
                return new vscode.ThemeIcon('error');
            case 'skipped':
                return new vscode.ThemeIcon('warning');
            case 'syncing':
                return new vscode.ThemeIcon('sync~spin');
            default:
                return new vscode.ThemeIcon('history');
        }
    }

    private computeTooltip(): string {
        return `同步状态: ${this.status.toUpperCase()}\n时间: ${new Date(this.timestamp).toLocaleString()}`;
    }

    static fromLogEntry(entry: SyncLogEntry, filePath: string): LogEntryGroupTreeItem {
        return new LogEntryGroupTreeItem(
            entry.timestamp,
            entry.status,
            filePath,
            entry.groupId!
        );
    }
} 