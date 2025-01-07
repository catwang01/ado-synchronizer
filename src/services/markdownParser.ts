import * as fs from 'fs/promises';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import { Metadata } from './Metadata';
import { LocalWorkItemState, LocalWorkItemStateHelper } from './localWorkItemState';
import { WorkItemTypeHelper } from './workItemType';
import { WorkitemTreeItem } from '../views/workitemTreeItem';
import { IAdoService } from './interfaces/IAdoService';
import { IFileUploadCache } from './interfaces/IFileUploadCache';
import { ISyncLogManager } from './interfaces/ISyncLogManager';
import * as vscode from 'vscode';
import { log } from '../utils';

export interface CommentSection {
    id?: string;  // ADO comment ID
    text: string;
    lineRange?: {
        start: number;
        end: number;
    };
}

export interface ParsedMarkdown {
    metadata: Metadata;
    description: string;
    comments: CommentSection[];
}

export class MarkdownParser {
    private md: MarkdownIt;

    constructor(
        private fileUploadCache: IFileUploadCache
    ) {
        this.md = new MarkdownIt({
            html: true,
            breaks: true,
            linkify: true,
            typographer: true
        });
    }

    private get resourceRoot(): string {
        return vscode.workspace.getConfiguration('markdown-ado-sync').get<string>('resourceRoot') || '';
    }

    private getAbsolutePath(relativePath: string, markdownFilePath?: string): string {
        log(`Resolving path: ${relativePath} with markdown file: ${markdownFilePath}`, 'DEBUG');
        // 如果设置了资源根目录，基于资源根目录解析
        if (this.resourceRoot) {
            return path.resolve(this.resourceRoot, relativePath.replace(/^\/+/, ''));
        }

        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }

        // 如果提供了 markdown 文件路径，基于它解析相对路径
        if (markdownFilePath) {
            return path.resolve(path.dirname(markdownFilePath), relativePath);
        }

        return relativePath;
    }

    // 处理本地文件引用
    async processLocalFiles(
        markdown: string, 
        adoService: IAdoService, 
        workItemId: string,
        filePath?: string,
        groupId?: string,
        syncLogManager?: ISyncLogManager
    ): Promise<string> {
        const localFilePattern = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src="([^"]+)"[^>]*>/g;
        let result = markdown;
        let match;

        while ((match = localFilePattern.exec(markdown)) !== null) {
            const attachmentPath = match[2] || match[3];
            if (attachmentPath && this.isLocalFile(attachmentPath)) {
                // 获取绝对路径
                const absolutePath = this.getAbsolutePath(attachmentPath, filePath);
                
                // 检查文件是否已上传
                let adoUrl = this.fileUploadCache.getUploadedUrl(absolutePath);
                if (!adoUrl) {
                    try {
                        if (syncLogManager && filePath && groupId) {
                            syncLogManager.addLog(filePath, {
                                timestamp: Date.now(),
                                status: 'success',
                                message: '开始上传附件',
                                details: `正在上传文件: ${absolutePath}`,
                                groupId
                            });
                        }

                        adoUrl = await adoService.uploadAttachment(workItemId, absolutePath);
                        
                        if (adoUrl) {
                            await this.fileUploadCache.setUploadedUrl(absolutePath, adoUrl);
                            if (syncLogManager && filePath && groupId) {
                                syncLogManager.addLog(filePath, {
                                    timestamp: Date.now(),
                                    status: 'success',
                                    message: '附件上传成功',
                                    details: `文件 ${absolutePath} 已上传到 ${adoUrl}`,
                                    groupId
                                });
                            }
                        }
                    } catch (error) {
                        log(`Failed to upload file ${absolutePath}: ${error}`, 'ERROR');
                        if (syncLogManager && filePath && groupId) {
                            syncLogManager.addLog(filePath, {
                                timestamp: Date.now(),
                                status: 'failed',
                                message: '附件上传失败',
                                details: `文件 ${absolutePath} 上传失败: ${error instanceof Error ? error.message : String(error)}`,
                                groupId
                            });
                        }
                        continue;
                    }
                }

                if (adoUrl) {
                    if (match[2]) {
                        result = result.replace(
                            `![${match[1]}](${attachmentPath})`,
                            `![${match[1]}](${adoUrl})`
                        );
                    } else {
                        result = result.replace(
                            `src="${attachmentPath}"`,
                            `src="${adoUrl}"`
                        );
                    }
                }
            }
        }

        return result;
    }

    private isLocalFile(path: string): boolean {
        // 检查是否是本地文件路径（不是 URL）
        return !path.startsWith('http://') && 
               !path.startsWith('https://') && 
               !path.startsWith('data:');
    }

    async convertToHtml(
        markdown: string, 
        adoService?: IAdoService, 
        workItemId?: string,
        filePath?: string,
        groupId?: string,
        syncLogManager?: ISyncLogManager
    ): Promise<string> {
        let processedMarkdown = markdown;
        
        // 如果提供了 adoService 和 workItemId，处理本地文件
        if (adoService && workItemId) {
            processedMarkdown = await this.processLocalFiles(
                markdown, 
                adoService, 
                workItemId,
                filePath,
                groupId,
                syncLogManager
            );
        }

        return this.md.render(processedMarkdown)
            .trim()
            .replace(/(<p>|<\/p>)/g, '')
            .replace(/\n{3,}/g, '\n\n');
    }

    private parseWorkItemIdFromUrl(url: string): string | undefined {
        try {
            // 检查是否是 dummy URL
            if (url.toLowerCase().includes('dummy')) {
                return 'dummy-' + Math.random().toString(36).substring(2, 8);
            }

            // 尝试从不同格式的 URL 中解析 ID
            const patterns = [
                // 标准格式: /_workitems/edit/123
                /_workitems\/edit\/(\d+)/,
                // 查询参数格式: ?workitemId=123 或 ?id=123
                /[?&](workitem|id)=(\d+)/i,
                // 其他可能的格式...
            ];

            for (const pattern of patterns) {
                const match = url.match(pattern);
                if (match) {
                    // 如果是查询参数格式，ID 在第二个捕获组
                    return match[match.length - 1];
                }
            }

            return undefined;
        } catch {
            return undefined;
        }
    }

    async scanDirectory(dirPaths: string[]): Promise<string[]> {
        try {
            const allFiles: string[] = [];
            
            for (const dirPath of dirPaths) {
                const files = await fs.readdir(dirPath, { recursive: true });
                const markdownFiles = files
                    .filter(file => file.endsWith('.md'))
                    .map(file => path.join(dirPath, file));
                allFiles.push(...markdownFiles);
            }

            return allFiles;
        } catch (error) {
            throw new Error(`扫描目录失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async parseMetadata(filePath: string): Promise<Metadata> {
        const content = await fs.readFile(filePath, 'utf-8');
        const metadata = this.parseMetadataFromContent(content);

        // 如果没有标题，使用文件名
        if (!metadata.title) {
            metadata.title = path.basename(filePath, '.md');
        }

        if (!metadata.workitemId && !metadata.workitemUrl) {
            throw new Error('缺少工作项 ID 或 URL');
        }

        if (!metadata.state) {
            throw new Error('缺少状态');
        }
        
        return metadata;
    }

    private parseMetadataFromContent(content: string): Metadata {
        const metadata = this.extractMetadata(content);
        this.processWorkItemUrls(metadata);

        if (!metadata.workitemId && !metadata.workitemUrl) {
            throw new Error('缺少工作项 ID 或 URL');
        }
        if (!metadata.state) {
            throw new Error('缺少状态');
        }
        return metadata;
    }

    private extractMetadata(content: string): Metadata {
        const lines = content.split('\n');
        const metadata: Metadata = {} as Metadata;

        // 查找元数据部分
        const metadataStart = lines.findIndex(line => line.trim() === '---');
        if (metadataStart !== -1) {
            const metadataEnd = lines.findIndex((line, i) => i > metadataStart && line.trim() === '---');
            if (metadataEnd !== -1) {
                const metadataLines = lines.slice(metadataStart + 1, metadataEnd);
                metadataLines.forEach(line => {
                    const [key, ...valueParts] = line.split(':');
                    const value = valueParts.join(':').trim();
                    const trimmedKey = key.trim().toLowerCase();
                    if (trimmedKey && value) {
                        switch (trimmedKey) {
                            case 'workitemid':
                                metadata.workitemId = value;
                                break;
                            case 'workitemurl':
                                metadata.workitemUrl = value;
                                break;
                            case 'type':
                                metadata.type = WorkItemTypeHelper.normalize(value);
                                break;
                            case 'state':
                            case 'workitemstate':
                                metadata.state = LocalWorkItemStateHelper.normalize(value);
                                break;
                            case 'title':
                                metadata.title = value;
                                break;
                            case 'parentid':
                                metadata.parentId = value;
                                break;
                        }
                    }
                });
            }
        }
        return metadata;
    }

    private processWorkItemUrls(metadata: Metadata): void {
        // 如果已有 ID，检查是否是 dummy ID
        if (metadata.workitemId?.startsWith('dummy-')) {
            metadata.state = LocalWorkItemState.DUMMY;
            return;
        }

        // 从 URL 中解析 ID
        if (metadata.workitemUrl && !metadata.workitemId) {
            const id = this.parseWorkItemIdFromUrl(metadata.workitemUrl);
            if (id) {
                metadata.workitemId = id;
            }
        }

        if (metadata.workitemId && !metadata.workitemUrl) {
            metadata.workitemUrl = WorkitemTreeItem.getWorkItemUrl(metadata.workitemId);
        }
    }

    parseContent(content: string): ParsedMarkdown {
        const sections = content.split(/\r?\n===+\r?\n/);
        const firstSection = sections[0];

        const metadata = this.parseMetadataFromContent(firstSection);
        const description = this.getDescriptionFromContent(firstSection);

        // 解析评论部分
        const comments: CommentSection[] = [];
        const lines = content.split('\n');
        let currentComment: CommentSection | null = null;
        let commentStartLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('===')) {
                if (currentComment) {
                    currentComment.lineRange = {
                        start: commentStartLine,
                        end: i - 1
                    };
                    comments.push(currentComment);
                }
                currentComment = { text: '' };
                commentStartLine = i + 1;

                // 检查评论ID
                const nextLine = lines[i + 1];
                if (nextLine?.startsWith('<!--comment-id:')) {
                    const match = nextLine.match(/<!--comment-id:(.+)-->/);
                    if (match) {
                        currentComment.id = match[1];
                        i++; // 跳过ID行
                        commentStartLine++;
                    }
                }
            } else if (currentComment) {
                currentComment.text += (currentComment.text ? '\n' : '') + line;
            }
        }

        // 处理最后一个评论
        if (currentComment) {
            currentComment.lineRange = {
                start: commentStartLine,
                end: lines.length - 1
            };
            comments.push(currentComment);
        }

        return {
            metadata,
            description: description.trim(),
            comments
        };
    }

    private getDescriptionFromContent(content: string): string {
        const lines = content.split('\n');
        const metadataStart = lines.findIndex(line => line.trim() === '---');
        
        if (metadataStart === -1) {
            return content;
        }

        const metadataEnd = lines.findIndex((line, i) => i > metadataStart && line.trim() === '---');
        if (metadataEnd === -1) {
            return content;
        }

        return lines.slice(metadataEnd + 1).join('\n');
    }

    async updateWorkItemId(content: string, id: string): Promise<string> {
        const lines = content.split('\n');
        const metadataStart = lines.findIndex(line => line.trim() === '---');

        if (metadataStart === -1) {
            // 如果没有元数据，在文件开头添加
            return `---\nworkitemId: ${id}\n---\n${content}`;
        }

        const metadataEnd = lines.findIndex((line, i) => i > metadataStart && line.trim() === '---');
        if (metadataEnd === -1) {
            return content; // 元数据格式不正确，返回原内容
        }

        // 更新或添加 workitemId
        let hasWorkItemId = false;
        for (let i = metadataStart + 1; i < metadataEnd; i++) {
            if (lines[i].trim().startsWith('workitemId:')) {
                lines[i] = `workitemId: ${id}`;
                hasWorkItemId = true;
                break;
            }
        }

        if (!hasWorkItemId) {
            // 在元数据部分末尾添加 workitemId
            lines.splice(metadataEnd, 0, `workitemId: ${id}`);
        }

        return lines.join('\n');
    }

    async updateCommentId(content: string, index: number, commentId: string): Promise<string> {
        const sections = content.split(/\n===+\n/);
        if (index + 1 >= sections.length) {
            return content;
        }

        const commentSection = sections[index + 1];
        const lines = commentSection.trim().split('\n');

        // 如果已经有评论ID，更新它
        if (lines[0]?.startsWith('<!--comment-id:')) {
            lines[0] = `<!--comment-id:${commentId}-->`;
        } else {
            // 在评论开头添加ID
            lines.unshift(`<!--comment-id:${commentId}-->`);
        }

        sections[index + 1] = lines.join('\n');
        return sections.join('\n===\n');
    }

    /**
     * 更新 Markdown 文件的元数据
     */
    async updateMetadata(filePath: string, newMetadata: Partial<Metadata>): Promise<void> {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        
        const metadataStart = lines.findIndex(line => line.trim() === '---');
        const metadataEnd = lines.findIndex((line, i) => i > metadataStart && line.trim() === '---');
        
        if (metadataStart === -1 || metadataEnd === -1) {
            // 如果没有元数据部分，创建一个新的
            const newContent = this.createMetadataSection(newMetadata) + content;
            await fs.writeFile(filePath, newContent, 'utf-8');
            return;
        }

        // 更新现有元数据
        const updatedMetadata = { ...this.parseMetadataFromContent(content), ...newMetadata };
        const metadataLines = this.formatMetadata(updatedMetadata);
        
        const newContent = [
            ...lines.slice(0, metadataStart + 1),
            ...metadataLines,
            ...lines.slice(metadataEnd)
        ].join('\n');

        await fs.writeFile(filePath, newContent, 'utf-8');
    }

    private formatMetadata(metadata: Metadata): string[] {
        const lines: string[] = [];
        
        if (metadata.title) lines.push(`title: ${metadata.title}`);
        if (metadata.workitemId) lines.push(`workitemId: ${metadata.workitemId}`);
        if (metadata.workitemUrl) lines.push(`workitemUrl: ${metadata.workitemUrl}`);
        if (metadata.type) lines.push(`type: ${metadata.type}`);
        if (metadata.state) lines.push(`state: ${metadata.state}`);
        if (metadata.parentId) lines.push(`parentId: ${metadata.parentId}`);
        
        return lines;
    }

    private createMetadataSection(metadata: Partial<Metadata>): string {
        return [
            '---',
            ...this.formatMetadata(metadata as Metadata),
            '---',
            '',
        ].join('\n');
    }
} 