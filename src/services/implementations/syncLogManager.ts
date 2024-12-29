import { ISyncLogManager, SyncLogEntry } from '../interfaces/ISyncLogManager';

export class SyncLogManager implements ISyncLogManager {
    private logs: Map<string, SyncLogEntry[]> = new Map();
    private static readonly MAX_LOGS_PER_ITEM = 50;

    addLog(filePath: string, entry: SyncLogEntry): void {
        let logs = this.logs.get(filePath) || [];
        logs.unshift(entry);
        
        if (logs.length > SyncLogManager.MAX_LOGS_PER_ITEM) {
            logs = logs.slice(0, SyncLogManager.MAX_LOGS_PER_ITEM);
        }
        
        this.logs.set(filePath, logs);
    }

    getLogs(filePath: string): SyncLogEntry[] {
        return this.logs.get(filePath) || [];
    }

    clearLogs(filePath: string): void {
        this.logs.delete(filePath);
    }

    formatLogEntry(entry: SyncLogEntry): string {
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString();
        let result = `[${timeStr}] ${entry.status.toUpperCase()}: ${entry.message}`;
        if (entry.details) {
            result += `\n${entry.details}`;
        }
        return result;
    }
} 