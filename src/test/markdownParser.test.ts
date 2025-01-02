import * as assert from 'assert';
import { MarkdownParser } from '../services/markdownParser';
import { WorkitemTreeItem } from '../views/workitemTreeItem';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IFileUploadCache } from '../services/interfaces/IFileUploadCache';

suite('MarkdownParser Test Suite', () => {
    let parser: MarkdownParser;
    let mockFileUploadCache: IFileUploadCache;
    let tempDir: string;

    setup(async () => {
        mockFileUploadCache = {
            getUploadedUrl: () => undefined,
            setUploadedUrl: async () => {},
            clear: async () => {}
        };
        parser = new MarkdownParser(mockFileUploadCache);
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-test-'));
        WorkitemTreeItem.setAdoConfig('testorg', 'testproject');
    });

    teardown(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('Parse empty markdown file', async () => {
        const filePath = path.join(tempDir, 'empty.md');
        await fs.writeFile(filePath, '');
        const metadata = await parser.parseMetadata(filePath);
        assert.strictEqual(metadata.title, 'empty');
        assert.strictEqual(metadata.state, 'NotSpecified');
        assert.strictEqual(metadata.workitemId, undefined);
        assert.strictEqual(metadata.workitemUrl, undefined);
        assert.strictEqual(metadata.type, undefined);
    });

    test('Parse markdown file with metadata', async () => {
        const filePath = path.join(tempDir, 'test.md');
        const content = `---
title: Test Title
workitemId: 123
type: Task
state: Active
---
# Content`;
        await fs.writeFile(filePath, content);
        const metadata = await parser.parseMetadata(filePath);
        assert.strictEqual(metadata.title, 'Test Title');
        assert.strictEqual(metadata.workitemId, '123');
        assert.strictEqual(metadata.type, 'Task');
        assert.strictEqual(metadata.state, 'Active');
        assert.strictEqual(metadata.workitemUrl, 'https://dev.azure.com/testorg/testproject/_workitems/edit/123');
    });

    test('Parse markdown file with URL', async () => {
        const filePath = path.join(tempDir, 'url.md');
        const content = `---
title: URL Test
workitemUrl: https://dev.azure.com/org/project/_workitems/edit/456
type: Bug
state: Active
---`;
        await fs.writeFile(filePath, content);
        const metadata = await parser.parseMetadata(filePath);
        assert.strictEqual(metadata.workitemId, '456');
        assert.strictEqual(metadata.workitemUrl, 'https://dev.azure.com/org/project/_workitems/edit/456');
    });

    test('Parse markdown file with mismatched ID and URL', async () => {
        const filePath = path.join(tempDir, 'mismatch.md');
        const content = `---
title: Mismatch Test
workitemId: 123
workitemUrl: https://dev.azure.com/org/project/_workitems/edit/456
---`;
        await fs.writeFile(filePath, content);
        await assert.rejects(async () => {
            await parser.parseMetadata(filePath);
        }, /工作项 ID 不匹配/);
    });

    test('Parse markdown file with colon in title', async () => {
        const filePath = path.join(tempDir, 'colon.md');
        const content = `---
title: Test: With Colon
workitemId: 123
---`;
        await fs.writeFile(filePath, content);
        const metadata = await parser.parseMetadata(filePath);
        assert.strictEqual(metadata.title, 'Test: With Colon');
    });

    test('Scan directory for markdown files', async () => {
        await fs.writeFile(path.join(tempDir, 'test1.md'), '');
        await fs.writeFile(path.join(tempDir, 'test2.md'), '');
        await fs.writeFile(path.join(tempDir, 'test.txt'), '');
        await fs.writeFile(path.join(tempDir, 'test3.MD'), '');

        const files = await parser.scanDirectory([tempDir]);
        assert.strictEqual(files.length, 2); // 只包含 .md 文件，不包含 .MD 和 .txt
        assert.ok(files.every(file => file.endsWith('.md')));
    });

    test('Parse invalid markdown file', async () => {
        const filePath = path.join(tempDir, 'invalid.md');
        const content = `---
invalid yaml format
---`;
        await fs.writeFile(filePath, content);
        const metadata = await parser.parseMetadata(filePath);
        assert.strictEqual(metadata.title, 'invalid');
        assert.strictEqual(metadata.state, 'NotSpecified');
    });

    test('Parse markdown file with missing metadata section', async () => {
        const filePath = path.join(tempDir, 'nometa.md');
        const content = '# Just content\nNo metadata section';
        await fs.writeFile(filePath, content);
        const metadata = await parser.parseMetadata(filePath);
        assert.strictEqual(metadata.title, 'nometa');
        assert.strictEqual(metadata.state, 'NotSpecified');
    });
}); 