import { IAdoService, WorkItem, WorkItemUpdate } from '../interfaces/IAdoService';

export class MockAdoService implements IAdoService {
    private workItems: Map<number, WorkItem> = new Map();
    private nextId: number = 1;

    async getWorkItem(id: number): Promise<WorkItem> {
        const item = this.workItems.get(id);
        if (!item) {
            throw new Error(`工作项不存在: ${id}`);
        }
        return item;
    }

    async updateWorkItem(id: number, update: WorkItemUpdate): Promise<void> {
        // 模拟网络延迟
        await new Promise(resolve => setTimeout(resolve, 1000));

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

    async createWorkItem(type: string, update: WorkItemUpdate): Promise<number> {
        // 模拟网络延迟
        await new Promise(resolve => setTimeout(resolve, 1000));

        const id = this.nextId++;
        this.workItems.set(id, {
            id,
            title: update.title,
            type,
            state: update.state
        });

        return id;
    }
} 