import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SyncState } from '../interfaces/syncState';

export class SyncStateManager {
    private states: Map<string, SyncState> = new Map();
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadStates();
    }

    private loadStates() {
        const states = this.context.globalState.get<{ [key: string]: SyncState }>('syncStates', {});
        this.states = new Map(Object.entries(states));
    }

    private saveStates() {
        const states = Object.fromEntries(this.states.entries());
        this.context.globalState.update('syncStates', states);
    }

    async getFileHash(filePath: string): Promise<string> {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        return crypto.createHash('md5').update(content).digest('hex');
    }

    async needsSync(filePath: string): Promise<boolean> {
        const currentHash = await this.getFileHash(filePath);
        const state = this.states.get(filePath);
        
        if (!state) {
            return true;
        }

        return currentHash !== state.lastSyncHash;
    }

    async updateSyncState(filePath: string, success: boolean, workItemId?: number) {
        const currentHash = await this.getFileHash(filePath);
        
        this.states.set(filePath, {
            filePath,
            lastSyncTime: Date.now(),
            lastSyncHash: currentHash,
            workItemId,
            lastSyncStatus: success ? 'success' : 'failed'
        });

        this.saveStates();
    }

    getSyncState(filePath: string): SyncState | undefined {
        return this.states.get(filePath);
    }

    deleteSyncState(filePath: string) {
        this.states.delete(filePath);
        this.saveStates();
    }
} 