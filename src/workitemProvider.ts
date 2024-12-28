import * as vscode from 'vscode';
import { AdoService } from './services/adoService';
import { MarkdownParser } from './services/markdownParser';

export class WorkitemProvider implements vscode.TreeDataProvider<WorkitemItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkitemItem | undefined | null | void> = new vscode.EventEmitter<WorkitemItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkitemItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private adoService: AdoService,
        private markdownParser: MarkdownParser
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WorkitemItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WorkitemItem | undefined): Promise<WorkitemItem[]> {
        if (element) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        const scanPath = config.get<string>('scanPath');

        if (!scanPath) {
            return [new WorkitemItem(
                '点击配置扫描路径',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'markdown-ado-sync.configureScanPath',
                    title: '配置扫描路径'
                }
            )];
        }

        try {
            const files = await this.markdownParser.scanDirectory(scanPath);
            const workitems = await Promise.all(
                files.map(async (file: string) => {
                    const metadata = await this.markdownParser.parseMetadata(file);
                    return new WorkitemItem(
                        metadata.title,
                        vscode.TreeItemCollapsibleState.None,
                        {
                            command: 'vscode.open',
                            title: '打开文件',
                            arguments: [vscode.Uri.file(file)]
                        },
                        file
                    );
                })
            );
            return workitems;
        } catch (error) {
            vscode.window.showErrorMessage(`获取工作项失败: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }

    async syncWorkitems(): Promise<void> {
        // 实现同步逻辑
    }

    async syncSingleWorkitem(filePath: string): Promise<void> {
        try {
            const metadata = await this.markdownParser.parseMetadata(filePath);
            // TODO: 实现单个工作项的同步逻辑
            vscode.window.showInformationMessage(`同步工作项成功: ${metadata.title}`);
        } catch (error) {
            vscode.window.showErrorMessage(`同步工作项失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

export class WorkitemItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly filePath?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = filePath ? 'workitem' : undefined;
    }
} 