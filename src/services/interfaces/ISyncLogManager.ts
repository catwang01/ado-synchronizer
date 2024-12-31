export interface SyncLogEntry {
    id: string;
    timestamp: number;
    status: 'success' | 'failed' | 'skipped' | 'syncing';
    message: string;
    details?: string;
    groupId?: string;
}

export interface ISyncLogManager {
    addLog(filePath: string, entry: Omit<SyncLogEntry, 'id'>): string;
    getLogs(filePath: string): SyncLogEntry[];
    getLogGroup(filePath: string, groupId: string): SyncLogEntry[];
    clearLogs(filePath: string): void;
    formatLogEntry(entry: SyncLogEntry): string;
} 