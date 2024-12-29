export interface WorkItem {
    id: number;
    title: string;
    type: string;
    state: string;
}

export interface WorkItemUpdate {
    title: string;
    description: string;
    state: string;
}

export interface IAdoService {
    getWorkItem(id: number): Promise<WorkItem>;
    updateWorkItem(id: number, update: WorkItemUpdate): Promise<void>;
    createWorkItem(type: string, update: WorkItemUpdate): Promise<number>;
} 