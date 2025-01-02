import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { IFileUploadCache } from '../interfaces/IFileUploadCache';

interface CacheData {
    uploadedFiles: { [key: string]: string };
}

export class FileUploadCache implements IFileUploadCache {
    private cachePath: string;
    private cache: CacheData = { uploadedFiles: {} };

    constructor(context: vscode.ExtensionContext) {
        this.cachePath = path.join(context.globalStorageUri.fsPath, 'file-upload-cache.json');
        this.loadCache();
    }

    private async loadCache() {
        try {
            const data = await fs.readFile(this.cachePath, 'utf-8');
            this.cache = JSON.parse(data);
        } catch {
            this.cache = { uploadedFiles: {} };
        }
    }

    private async saveCache() {
        try {
            await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
            await fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2));
        } catch (error) {
            console.error('Failed to save cache:', error);
        }
    }

    getUploadedUrl(filePath: string): string | undefined {
        return this.cache.uploadedFiles[filePath];
    }

    async setUploadedUrl(filePath: string, url: string): Promise<void> {
        this.cache.uploadedFiles[filePath] = url;
        await this.saveCache();
    }

    async clear(): Promise<void> {
        this.cache.uploadedFiles = {};
        await this.saveCache();
    }
} 