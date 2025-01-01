import { LocalWorkItemState } from './localWorkItemState';
import { WorkItemType } from './workItemType';

export interface Metadata {
    title: string;
    workitemId?: string;
    workitemUrl?: string;
    type: WorkItemType;
    state: LocalWorkItemState;
    parentId?: string;
}

export interface MetadataUpdateOptions {
    addMissing?: boolean;
    overwrite?: boolean;
    fields?: (keyof Metadata)[];
}