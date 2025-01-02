import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel;

export function initializeLogger() {
    outputChannel = vscode.window.createOutputChannel('Markdown ADO Sync');
}

export function log(message: string, level: 'INFO' | 'ERROR' | 'DEBUG' = 'INFO') {
    if (!outputChannel) {
        initializeLogger();
    }

    const timestamp = new Date().toLocaleString();
    const prefix = `[${timestamp}] [${level}] `;
    outputChannel.appendLine(prefix + message);

    // 如果是错误级别，自动显示输出面板
    if (level === 'ERROR') {
        outputChannel.show(true);
    }

    // 只在调试模式下显示 DEBUG 级别的日志
    if (level === 'DEBUG' && !vscode.workspace.getConfiguration('markdown-ado-sync').get('debug')) {
        return;
    }
}

export function showOutput() {
    if (!outputChannel) {
        initializeLogger();
    }
    outputChannel.show();
}