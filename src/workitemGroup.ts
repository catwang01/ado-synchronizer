import * as vscode from 'vscode';
import { WorkitemItem } from './workitemProvider';

export class WorkitemGroup extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly children: WorkitemItem[],
        public readonly parentId?: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
    ) {
        super(label, collapsibleState);
        
        // 设置工具提示
        this.tooltip = this.computeTooltip();
        
        // 设置图标
        this.iconPath = new vscode.ThemeIcon('folder');
    }

    private computeTooltip(): string {
        return `${this.label}\n包含 ${this.children.length} 个工作项`;
    }
} 