import { RemoteWorkItem } from "./WorkItem";
import { WorkItemComment } from "./WorkItemComment";
import { WorkItemUpdate } from "./WorkItemUpdate";

export interface IAdoService {
    getWorkItem(id: string): Promise<RemoteWorkItem>;
    updateWorkItem(id: string, update: WorkItemUpdate): Promise<void>;
    createWorkItem(type: string, update: WorkItemUpdate): Promise<string>;
    validateToken(): Promise<boolean>;
    updateToken(token: string): void;
    addComment(id: string, comment: string): Promise<string>;
    getComments(workItemId: string): Promise<WorkItemComment[]>;
    updateComment(workItemId: string, commentId: string, comment: string): Promise<void>;
    deleteComment(workItemId: string, commentId: string): Promise<void>;
    getWorkItemDetails(id: string): Promise<RemoteWorkItem>;
} 