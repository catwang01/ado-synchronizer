export interface SyncState {
    filePath: string;
    lastSyncTime: number;
    lastSyncHash: string;
    workItemId?: string;
    lastSyncStatus: 'success' | 'failed';
} 