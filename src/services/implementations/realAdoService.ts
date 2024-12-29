import * as vscode from 'vscode';
import axios from 'axios';
import { IAdoService, WorkItem, WorkItemUpdate } from '../interfaces/IAdoService';

export class RealAdoService implements IAdoService {
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

    async updateWorkItem(id: number, update: WorkItemUpdate): Promise<void> {
        try {
            const patchDocument = [
                {
                    op: "add",
                    path: "/fields/System.Title",
                    value: update.title
                },
                {
                    op: "add",
                    path: "/fields/System.Description",
                    value: update.description
                }
            ];

            if (update.state) {
                patchDocument.push({
                    op: "add",
                    path: "/fields/System.State",
                    value: update.state
                });
            }

            await axios.patch(
                `https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workitems/${id}?api-version=6.0`,
                patchDocument,
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`,
                        'Content-Type': 'application/json-patch+json'
                    }
                }
            );
        } catch (error) {
            throw new Error(`更新工作项失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async createWorkItem(type: string, update: WorkItemUpdate): Promise<number> {
        try {
            const patchDocument = [
                {
                    op: "add",
                    path: "/fields/System.Title",
                    value: update.title
                },
                {
                    op: "add",
                    path: "/fields/System.Description",
                    value: update.description
                }
            ];

            if (update.state) {
                patchDocument.push({
                    op: "add",
                    path: "/fields/System.State",
                    value: update.state
                });
            }

            const response = await axios.post(
                `https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workitems/$${type}?api-version=6.0`,
                patchDocument,
                {
                    headers: {
                        'Authorization': `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`,
                        'Content-Type': 'application/json-patch+json'
                    }
                }
            );

            return response.data.id;
        } catch (error) {
            throw new Error(`创建工作项失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 