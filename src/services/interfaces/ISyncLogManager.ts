export interface SyncLogEntry {
    timestamp: number;
    status: 'success' | 'failed' | 'skipped';
    message: string;
    details?: string;
}

export interface ISyncLogManager {
    addLog(filePath: string, entry: SyncLogEntry): void;
    getLogs(filePath: string): SyncLogEntry[];
    clearLogs(filePath: string): void;
    formatLogEntry(entry: SyncLogEntry): string;
} 