import * as vscode from 'vscode';

export class WelcomeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'adoWelcome';

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

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
            switch (data.type) {
                case 'configureSettings':
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'markdown-ado-sync');
                    break;
                case 'signin':
                    await vscode.commands.executeCommand('markdown-ado-sync.signin');
                    break;
                case 'configureScanPath':
                    await vscode.commands.executeCommand('markdown-ado-sync.configureScanPath');
                    break;
            }
        });

        // 监听配置变化
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('markdown-ado-sync')) {
                webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        const organization = config.get<string>('adoOrganization');
        const project = config.get<string>('adoProject');
        const scanPath = config.get<string>('scanPath');

        const configStatus = {
            organization: !!organization,
            project: !!project,
            scanPath: !!scanPath
        };

        const allConfigured = Object.values(configStatus).every(Boolean);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Markdown ADO Sync</title>
            <style>
                body {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                .config-item {
                    margin: 10px 0;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .config-left {
                    display: flex;
                    align-items: center;
                }
                .status-icon {
                    margin-right: 8px;
                }
                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 12px;
                    cursor: pointer;
                    margin: 5px 0;
                }
                .primary-button {
                    width: 100%;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .success { color: var(--vscode-testing-iconPassed); }
                .error { color: var(--vscode-testing-iconFailed); }
            </style>
        </head>
        <body>
            <h2>配置检查</h2>
            <div class="config-item">
                <div class="config-left">
                    <span class="status-icon ${configStatus.organization ? 'success' : 'error'}">
                        ${configStatus.organization ? '✓' : '✗'}
                    </span>
                    <span>Azure DevOps 组织</span>
                </div>
            </div>
            <div class="config-item">
                <div class="config-left">
                    <span class="status-icon ${configStatus.project ? 'success' : 'error'}">
                        ${configStatus.project ? '✓' : '✗'}
                    </span>
                    <span>Azure DevOps 项目</span>
                </div>
            </div>
            <div class="config-item">
                <div class="config-left">
                    <span class="status-icon ${configStatus.scanPath ? 'success' : 'error'}">
                        ${configStatus.scanPath ? '✓' : '✗'}
                    </span>
                    <span>扫描路径</span>
                </div>
                ${!configStatus.scanPath ? `
                    <button onclick="configureScanPath()">选择路径</button>
                ` : ''}
            </div>

            ${!allConfigured ? `
                <div style="margin: 20px 0;">
                    <p>请完成以下配置以开始使用：</p>
                    <button class="primary-button" onclick="configureSettings()">配置其他设置</button>
                </div>
            ` : `
                <div style="margin: 20px 0;">
                    <p>所有配置已完成，请登录以开始使用：</p>
                    <button class="primary-button" onclick="signin()">登录 Azure DevOps</button>
                </div>
            `}

            <script>
                const vscode = acquireVsCodeApi();
                
                function configureSettings() {
                    vscode.postMessage({ type: 'configureSettings' });
                }
                
                function signin() {
                    vscode.postMessage({ type: 'signin' });
                }

                function configureScanPath() {
                    vscode.postMessage({ type: 'configureScanPath' });
                }
            </script>
        </body>
        </html>`;
    }
} 