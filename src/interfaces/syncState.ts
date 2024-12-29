export interface SyncState {
    filePath: string;
    lastSyncTime: number;
    lastSyncHash: string;
    workItemId?: number;
    lastSyncStatus: 'success' | 'failed';
} 