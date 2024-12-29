import { ISyncLogManager, SyncLogEntry } from '../interfaces/ISyncLogManager';
import { v4 as uuidv4 } from 'uuid';
import * as vscode from 'vscode';

export class SyncLogManager implements ISyncLogManager {
    private logs: Map<string, SyncLogEntry[]> = new Map();
    private static readonly MAX_LOGS_PER_ITEM = 50;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadLogs();
    }

    private async loadLogs() {
        const storedLogs = this.context.globalState.get<{ [key: string]: SyncLogEntry[] }>('syncLogs');
        if (storedLogs) {
            Object.entries(storedLogs).forEach(([filePath, logs]) => {
                this.logs.set(filePath, logs);
            });
        }
    }

    private async saveLogs() {
        const logsObject: { [key: string]: SyncLogEntry[] } = {};
        this.logs.forEach((value, key) => {
            logsObject[key] = value;
        });
        await this.context.globalState.update('syncLogs', logsObject);
    }

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
        this.saveLogs();  // 保存到持久存储
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
        this.saveLogs();  // 保存到持久存储
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