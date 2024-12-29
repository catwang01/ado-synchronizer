import { ISyncLogManager, SyncLogEntry } from '../interfaces/ISyncLogManager';
import { v4 as uuidv4 } from 'uuid';

export class SyncLogManager implements ISyncLogManager {
    private logs: Map<string, SyncLogEntry[]> = new Map();
    private static readonly MAX_LOGS_PER_ITEM = 50;

    addLog(filePath: string, entry: Omit<SyncLogEntry, 'id'>): string {
        const id = uuidv4();
        const fullEntry: SyncLogEntry = {
            ...entry,
            id
        };

        let logs = this.logs.get(filePath) || [];
        logs.unshift(fullEntry);
        
        if (logs.length > SyncLogManager.MAX_LOGS_PER_ITEM) {
            logs = logs.slice(0, SyncLogManager.MAX_LOGS_PER_ITEM);
        }
        
        this.logs.set(filePath, logs);
        return id;
    }

    getLogs(filePath: string): SyncLogEntry[] {
        return this.logs.get(filePath) || [];
    }

    getLogGroup(filePath: string, groupId: string): SyncLogEntry[] {
        const logs = this.logs.get(filePath) || [];
        return logs.filter(log => log.groupId === groupId);
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