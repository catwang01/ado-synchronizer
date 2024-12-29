export interface WorkItem {
    id: string;
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
    getWorkItem(id: string): Promise<WorkItem>;
    updateWorkItem(id: string, update: WorkItemUpdate): Promise<void>;
    createWorkItem(type: string, update: WorkItemUpdate): Promise<string>;
    validateToken(): Promise<boolean>;
    updateToken(token: string): void;
} 