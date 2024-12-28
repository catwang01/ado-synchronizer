import * as vscode from 'vscode';

export function isDebug(): boolean {
    const config = vscode.workspace.getConfiguration('markdown-ado-sync');
    return config.get<boolean>('debug') ?? false;
}

export function log(message: string) {
    if (isDebug()) {
        vscode.window.showInformationMessage(message);
    }
}