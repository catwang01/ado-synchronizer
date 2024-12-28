import * as fs from 'fs/promises';
import * as path from 'path';
import MarkdownIt from 'markdown-it';

export interface Metadata {
    title: string;
    workitemId?: number;
    type?: string;
    state?: string;
}

export class MarkdownParser {
    private md: MarkdownIt;

    constructor() {
        this.md = new MarkdownIt();
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
                title: path.basename(filePath, '.md')
            };

            // 查找元数据部分
            const metadataStart = lines.findIndex(line => line.trim() === '---');
            if (metadataStart !== -1) {
                const metadataEnd = lines.findIndex((line, i) => i > metadataStart && line.trim() === '---');
                if (metadataEnd !== -1) {
                    const metadataLines = lines.slice(metadataStart + 1, metadataEnd);
                    metadataLines.forEach(line => {
                        const [key, value] = line.split(':').map(s => s.trim());
                        if (key && value) {
                            switch (key) {
                                case 'workitemId':
                                    metadata.workitemId = parseInt(value);
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
                }
            }

            return metadata;
        } catch (error) {
            throw new Error(`解析文件失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 