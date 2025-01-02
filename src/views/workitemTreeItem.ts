import * as vscode from 'vscode';
import { WorkItemType } from '../services/workItemType';
import { WorkitemProvider } from './workitemProvider';
import { LocalWorkItemStateHelper } from '../services/localWorkItemState';

// 私有 symbol 用于存储 provider 引用
const providerSymbol = Symbol('provider');

export type WorkItemUpdate = Partial<{
    title: string;
    state: string;
    workitemId: string;
    workitemUrl: string;
    type: string;
    description: string;
    iconPath: vscode.ThemeIcon;
}>;

export type TreeItemStatus = 'syncing' | 'success' | 'failed' | 'default' | 'skipped';

export class WorkitemTreeItem extends vscode.TreeItem {
    private static adoConfig: { organization?: string; project?: string } = {};
    private _syncing: boolean = false;
    private [providerSymbol]: WorkitemProvider;
    private _treeItemStatus: TreeItemStatus = 'default';

    private _workitemId?: string;
    private _workitemUrl?: string;
    private _type?: string;
    private _filePath?: string;
    private _state?: string;

    get workitemId(): string | undefined { return this._workitemId; }
    get workitemUrl(): string | undefined { return this._workitemUrl; }
    get type(): string | undefined { return this._type; }
    get filePath(): string | undefined { return this._filePath; }
    get state(): string | undefined { return this._state; }
    get syncing(): boolean { return this._syncing; }
    set syncing(value: boolean) {
        this._syncing = value;
        this.iconPath = this.computeInitialIcon();
    }

    get treeItemStatus(): TreeItemStatus { return this._treeItemStatus; }
    set treeItemStatus(value: TreeItemStatus) {
        this._treeItemStatus = value;
        this.iconPath = this.computeInitialIcon();
    }

    constructor(
        label: string,
        provider: WorkitemProvider,
        filePath?: string,
        workitemId?: string,
        workitemUrl?: string,
        type?: string,
        state?: string
    ) {
        // 如果有文件路径，检查是否有日志条目来决定 collapsibleState
        const hasLogs = filePath ? provider.hasLogs(filePath) : false;
        super(label, hasLogs ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        this[providerSymbol] = provider;
        this._workitemId = workitemId;
        this._workitemUrl = workitemUrl;
        this._type = type;
        this._filePath = filePath;
        this._state = state;

        // 设置图标和工具提示
        this.iconPath = this.computeInitialIcon();
        this.tooltip = this.computeTooltip();
        this.description = this.computeDescription();

        // 设置命令和上下文
        this.command = this.computeCommand();
        if (this.filePath && (this.workitemId || this.workitemUrl)) {
            this.contextValue = 'workitem';
        }
    }

    static setAdoConfig(organization: string, project: string) {
        WorkitemTreeItem.adoConfig = { organization, project };
    }

    static getWorkItemUrl(workItemId: string): string | undefined {
        const { organization, project } = WorkitemTreeItem.adoConfig;
        if (!organization || !project) {
            return undefined;
        }
        return `https://dev.azure.com/${organization}/${project}/_workitems/edit/${workItemId}`;
    }

    update(updates: WorkItemUpdate): void {
        if (updates.title) {
            this.label = updates.title;
        }
        if (updates.state) {
            this._state = updates.state;
        }
        if (updates.workitemId) {
            this._workitemId = updates.workitemId;
        }
        if (updates.workitemUrl) {
            this._workitemUrl = updates.workitemUrl;
        }
        if (updates.type) {
            this._type = updates.type;
        }
        if (updates.iconPath) {
            this.iconPath = updates.iconPath;
        }

        this.description = this.computeDescription();
        this.tooltip = this.computeTooltip();
    }

    private computeInitialIcon(): vscode.ThemeIcon {
        // 首先检查状态
        switch (this._treeItemStatus) {
            case 'syncing':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
            case 'success':
                return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')); 
            case 'skipped':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconSkipped'));
        }

        // 如果状态是 default，则根据工作项类型显示图标
        if (this.type) {
            switch (this.type as WorkItemType) {
                case WorkItemType.BUG:
                    return new vscode.ThemeIcon('bug');
                case WorkItemType.FEATURE:
                    return new vscode.ThemeIcon('star');
                case WorkItemType.TASK:
                    return new vscode.ThemeIcon('tasklist');
                case WorkItemType.USER_STORY:
                    return new vscode.ThemeIcon('book');
                case WorkItemType.EPIC:
                    return new vscode.ThemeIcon('rocket');
                default:
                    return new vscode.ThemeIcon('circle-outline');
            }
        }
        return new vscode.ThemeIcon('circle-outline');
    }

    private computeTooltip(): vscode.MarkdownString {
        const tooltipParts = [
            this.label as string,
            this.workitemId ? `ID: ${this.workitemId}` : undefined,
            this.workitemUrl ? `[在 Azure DevOps 中打开](${this.workitemUrl})` : undefined,
            this.type ? `类型: ${this.type}` : undefined,
            this.state ? `状态: ${this.state}` : undefined,
            this.filePath ? `文件: ${this.filePath}` : undefined
        ].filter(Boolean);

        const tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'), true);
        tooltip.isTrusted = true;
        tooltip.supportHtml = true;
        return tooltip;
    }

    private computeDescription(): string {
        const descriptionParts = [];
        if (this.workitemId) {
            descriptionParts.push(`#${this.workitemId}`);
        }
        if (this.type) {
            descriptionParts.push(`[${this.type}]`);
        }
        if (this.state) {
            descriptionParts.push(`(${this.state})`);
        }
        return descriptionParts.join(' ');
    }

    private computeCommand(): vscode.Command | undefined {
        if (this.filePath) {
            return {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [vscode.Uri.file(this.filePath)]
            };
        }
        return undefined;
    }
}
