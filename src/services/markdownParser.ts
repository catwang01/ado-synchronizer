import * as fs from 'fs/promises';
import * as path from 'path';
import MarkdownIt from 'markdown-it';
import { WorkitemItem } from '../workitemProvider';

export interface Metadata {
    title: string;
    workitemId?: number;
    workitemUrl?: string;
    type?: string;
    state: string;
}

export class MarkdownParser {
    private md: MarkdownIt;

    constructor() {
        this.md = new MarkdownIt();
    }

    private parseWorkItemIdFromUrl(url: string): number | undefined {
        try {
            // 尝试从 URL 中解析 ID
            // 例如: https://dev.azure.com/org/project/_workitems/edit/123
            const match = url.match(/_workitems\/edit\/(\d+)/);
            if (match) {
                return parseInt(match[1], 10);
            }
            return undefined;
        } catch {
            return undefined;
        }
    }

    async scanDirectory(dirPath: string): Promise<string[]> {
        try {
            const files = await fs.readdir(dirPath);
            return files
                .filter(file => file.endsWith('.md'))
                .map(file => path.join(dirPath, file));
        } catch (error) {
            throw new Error(`扫描目录失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async parseMetadata(filePath: string): Promise<Metadata> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const metadata: Metadata = {
                title: path.basename(filePath, '.md'),
                state: 'NotSpecified'
            };

            // 查找元数据部分
            const metadataStart = lines.findIndex(line => line.trim() === '---');
            if (metadataStart !== -1) {
                const metadataEnd = lines.findIndex((line, i) => i > metadataStart && line.trim() === '---');
                if (metadataEnd !== -1) {
                    const metadataLines = lines.slice(metadataStart + 1, metadataEnd);
                    metadataLines.forEach(line => {
                        const [key, ...valueParts] = line.split(':');
                        const value = valueParts.join(':').trim();
                        const trimmedKey = key.trim();
                        if (trimmedKey && value) {
                            switch (trimmedKey) {
                                case 'workitemId':
                                    metadata.workitemId = parseInt(value);
                                    break;
                                case 'workitemUrl':
                                    metadata.workitemUrl = value;
                                    break;
                                case 'type':
                                    metadata.type = value;
                                    break;
                                case 'state':
                                    metadata.state = value;
                                    break;
                                case 'title':
                                    metadata.title = value;
                                    break;
                            }
                        }
                    });

                    // 处理 workitemUrl 和 workitemId
                    if (metadata.workitemUrl) {
                        const urlWorkItemId = this.parseWorkItemIdFromUrl(metadata.workitemUrl);
                        if (urlWorkItemId) {
                            if (metadata.workitemId && metadata.workitemId !== urlWorkItemId) {
                                throw new Error(
                                    `工作项 ID 不匹配: URL 中的 ID (${urlWorkItemId}) 与指定的 ID (${metadata.workitemId}) 不同`
                                );
                            }
                            metadata.workitemId = urlWorkItemId;
                        }
                    }

                    if (metadata.workitemId && !metadata.workitemUrl) {
                        metadata.workitemUrl = WorkitemItem.getWorkItemUrl(metadata.workitemId);
                    }
                }
            }

            return metadata;
        } catch (error) {
            throw new Error(`解析文件失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 