import * as vscode from 'vscode';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'adoWelcome';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.command === 'signin') {
                await vscode.commands.executeCommand('markdown-ado-sync.signin');
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                .header {
                    margin-bottom: 20px;
                }
                .title {
                    font-size: 1.2em;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                .description {
                    opacity: 0.8;
                    margin-bottom: 20px;
                }
                .features {
                    margin: 20px 0;
                }
                .feature-item {
                    display: flex;
                    align-items: center;
                    margin: 8px 0;
                }
                .feature-icon {
                    margin-right: 8px;
                }
                .button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    margin-top: 20px;
                }
                .button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .button-icon {
                    margin-right: 8px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">Markdown ADO Sync</div>
                <div class="description">在 Markdown 和 Azure DevOps 工作项之间同步内容</div>
            </div>

            <div class="features">
                <div class="title">主要功能</div>
                <div class="feature-item">
                    <span class="feature-icon">📝</span>
                    <span>自动同步 Markdown 文件到工作项</span>
                </div>
                <div class="feature-item">
                    <span class="feature-icon">💬</span>
                    <span>支持双向同步评论</span>
                </div>
                <div class="feature-item">
                    <span class="feature-icon">👀</span>
                    <span>实时监控文件变化</span>
                </div>
                <div class="feature-item">
                    <span class="feature-icon">📊</span>
                    <span>详细的同步日志</span>
                </div>
            </div>

            <div class="start">
                <div class="title">开始使用</div>
                <div class="description">点击下方按钮登录 Azure DevOps 开始使用</div>
                <button class="button" onclick="signin()">
                    <span class="button-icon">$(sign-in)</span>
                    登录 Azure DevOps
                </button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function signin() {
                    vscode.postMessage({ command: 'signin' });
                }
            </script>
        </body>
        </html>`;
    }
} 