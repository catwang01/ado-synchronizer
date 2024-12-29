import { IAdoService, WorkItem, WorkItemUpdate, WorkItemComment } from '../interfaces/IAdoService';

export class MockAdoService implements IAdoService {
    private workItems: Map<string, WorkItem> = new Map();
    private nextId: number = 1;
    private nextCommentId: number = 1;

    private simulateFailure() {
        if (Math.random() < 0.3) {
            throw new Error('模拟的随机失败');
        }
    }

    async getWorkItem(id: string): Promise<WorkItem> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();

        const item = this.workItems.get(id);
        if (!item) {
            throw new Error(`工作项不存在: ${id}`);
        }
        return item;
    }

    async updateWorkItem(id: string, update: WorkItemUpdate): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();

        const item = this.workItems.get(id);
        if (!item) {
            throw new Error(`工作项不存在: ${id}`);
        }

        this.workItems.set(id, {
            ...item,
            title: update.title,
            state: update.state
        });
    }

    async createWorkItem(type: string, update: WorkItemUpdate): Promise<string> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();

        const id = String(this.nextId++);
        this.workItems.set(id, {
            id,
            title: update.title,
            type,
            state: update.state
        });

        return id;
    }

    async validateToken(): Promise<boolean> {
        return true; // Mock 环境总是返回 token 有效
    }

    updateToken(token: string): void {
        // Mock 环境不需要实际实现
    }

    async addComment(id: string, comment: string): Promise<string> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();
        const commentId = String(this.nextCommentId++);
        return commentId;
    }

    async getComments(workItemId: string): Promise<WorkItemComment[]> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();
        return []; // 返回空数组，因为这是模拟服务
    }

    async updateComment(workItemId: string, commentId: string, comment: string): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();
        // Mock 不需要实际实现
    }

    async deleteComment(workItemId: string, commentId: string): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.simulateFailure();
        // Mock 不需要实际实现
    }
} 