import { RemoteWorkItemState } from './RemoteWorkItemState';
import { WorkItemType } from '../workItemType';

export interface RemoteWorkItem {
    id: string;
    title: string;
    type: WorkItemType;
    state: RemoteWorkItemState;
    parentId?: string;
}