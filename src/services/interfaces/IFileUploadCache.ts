export interface IFileUploadCache {
    getUploadedUrl(filePath: string): string | undefined;
    setUploadedUrl(filePath: string, url: string): Promise<void>;
    clear(): Promise<void>;
} 