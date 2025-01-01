import * as vscode from 'vscode';
import { WorkitemItem } from "./workitemProvider";

export class WorkitemGroup extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly children: WorkitemItem[],
        public readonly parentId: string | undefined,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(name, collapsibleState);
    }
} 