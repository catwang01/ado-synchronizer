import * as vscode from 'vscode';
import axios from 'axios';
import { IAdoService } from '../interfaces/IAdoService';
import { RemoteWorkItem } from '../interfaces/WorkItem';
import { WorkItemUpdate } from "../interfaces/WorkItemUpdate";
import { WorkItemComment } from "../interfaces/WorkItemComment";

export class RealAdoService implements IAdoService {
    private token: string;
    private organization: string;
    private project: string;
    private client: any;

    constructor() {
        const config = vscode.workspace.getConfiguration('markdown-ado-sync');
        this.token = config.get<string>('adoToken') || '';
        this.organization = config.get<string>('adoOrganization') || '';
        this.project = config.get<string>('adoProject') || '';
        this.updateClient();
    }

    private updateClient() {
        this.client = axios.create({
            baseURL: `https://dev.azure.com/${this.organization}/${this.project}/`,
            headers: {
                'Authorization': `Basic ${Buffer.from(`:${this.token}`).toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });
    }

    updateToken(token: string): void {
        this.token = token;
        this.updateClient();
    }

    async validateToken(): Promise<boolean> {
        try {
            const response = await this.client.get('_apis/projects');
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    private handleApiError(error: any, operation: string): never {
        let errorMessage = `${operation}失败: `;
        
        if (axios.isAxiosError(error)) {
            const axiosError = error;
            errorMessage += [
                `状态码: ${axiosError.response?.status || '未知'}`,
                `URL: ${axiosError.config?.url || '未知'}`,
                `响应: ${JSON.stringify(axiosError.response?.data) || '未知'}`,
                `错误: ${axiosError.message}`
            ].join(' | ');
        } else {
            errorMessage += error instanceof Error ? error.message : String(error);
        }

        throw new Error(errorMessage);
    }

    async getWorkItem(id: string): Promise<RemoteWorkItem> {
        try {
            const response = await this.client.get(
                `_apis/wit/workitems/${id}?api-version=6.0`
            );
            return {
                id: response.data.id.toString(),
                title: response.data.fields['System.Title'],
                type: response.data.fields['System.WorkItemType'],
                state: response.data.fields['System.State']
            };
        } catch (error) {
            this.handleApiError(error, `获取工作项(ID: ${id})`);
        }
    }

    async updateWorkItem(id: string, update: WorkItemUpdate): Promise<void> {
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

            await this.client.patch(
                `_apis/wit/workitems/${id}?api-version=6.0`,
                patchDocument,
                {
                    headers: {
                        'Content-Type': 'application/json-patch+json'
                    }
                }
            );
        } catch (error) {
            this.handleApiError(error, `更新工作项(ID: ${id})`);
        }
    }

    async createWorkItem(type: string, update: WorkItemUpdate): Promise<string> {
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

            const response = await this.client.post(
                `_apis/wit/workitems/$${type}?api-version=6.0`,
                patchDocument,
                {
                    headers: {
                        'Content-Type': 'application/json-patch+json'
                    }
                }
            );

            return response.data.id.toString();
        } catch (error) {
            this.handleApiError(error, `创建工作项(类型: ${type})`);
        }
    }

    async addComment(id: string, comment: string): Promise<string> {
        try {
            const response = await this.client.post(
                `_apis/wit/workitems/${id}/comments?api-version=6.0-preview`,
                { text: comment }
            );
            return response.data.id;
        } catch (error) {
            this.handleApiError(error, `添加评论(工作项ID: ${id})`);
        }
    }

    async getComments(workItemId: string): Promise<WorkItemComment[]> {
        try {
            const response = await this.client.get(
                `_apis/wit/workitems/${workItemId}/comments?api-version=6.0-preview`
            );
            return response.data.comments.map((comment: any) => ({
                id: comment.id.toString(),
                text: comment.text
            }));
        } catch (error) {
            throw new Error(`获取评论失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async updateComment(workItemId: string, commentId: string, comment: string): Promise<void> {
        try {
            await this.client.patch(
                `_apis/wit/workitems/${workItemId}/comments/${commentId}?api-version=6.0-preview`,
                { text: comment }
            );
        } catch (error) {
            throw new Error(`更新评论失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async deleteComment(workItemId: string, commentId: string): Promise<void> {
        try {
            await this.client.delete(
                `_apis/wit/workitems/${workItemId}/comments/${commentId}?api-version=6.0-preview`
            );
        } catch (error) {
            throw new Error(`删除评论失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async getWorkItemDetails(id: string): Promise<RemoteWorkItem> {
        try {
            const response = await this.client.get(
                `_apis/wit/workitems/${id}?api-version=6.0&$expand=all`
            );
            
            return {
                id: response.data.id.toString(),
                title: response.data.fields['System.Title'],
                type: response.data.fields['System.WorkItemType'],
                state: response.data.fields['System.State']
            };
        } catch (error) {
            throw new Error(`获取工作项详情失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 