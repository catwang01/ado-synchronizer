import * as vscode from 'vscode';
import axios from 'axios';

export interface WorkItem {
    id: number;
    title: string;
    type: string;
    state: string;
}

export class AdoService {
    private token: string;
    private organization: string;
    private project: string;

    constructor() {
        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        this.token = config.get<string>('adoToken') || '';
        this.organization = config.get<string>('adoOrganization') || '';
        this.project = config.get<string>('adoProject') || '';
    }

    async getWorkItem(id: number): Promise<WorkItem> {
        try {
            const response = await axios.get(
                `https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workitems/${id}?api-version=6.0`,
                {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`
                    }
                }
            );
            return {
                id: response.data.id,
                title: response.data.fields['System.Title'],
                type: response.data.fields['System.WorkItemType'],
                state: response.data.fields['System.State']
            };
        } catch (error) {
            throw new Error(`获取工作项失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 