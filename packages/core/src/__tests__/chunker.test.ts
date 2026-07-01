import { describe, it, expect } from 'vitest';
import { chunkEntities } from '../chunker.js';

describe('chunkEntities — metadata guard', () => {
  it('produces only body chunk when docComment is empty and signature is short', () => {
    const chunks = chunkEntities(
      [{
        docComment: '', signature: 'fn()', startLine: 1, endLine: 5,
        code: 'function fn() {}', filePath: 'a.ts', language: 'typescript',
        type: 'function', name: 'fn', entity: 'function',
      }] as any,
      'a.ts', '', 'typescript', { maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000, linesPerBodyChunk: 100 },
    );
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('body');
  });

  it('windows all lines when no entities exist', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
    const source = lines.join('\n');
    const chunks = chunkEntities([], 'a.ts', source, 'typescript', { maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000, linesPerBodyChunk: 100 });
    expect(chunks.length).toBe(3);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
    expect(chunks[1].startLine).toBe(51);
    expect(chunks[1].endLine).toBe(100);
    expect(chunks[2].startLine).toBe(101);
    expect(chunks[2].endLine).toBe(120);
    expect(chunks.every(c => c.content.length > 0)).toBe(true);
  });

  it('chunks uncovered lines between entities and skips blank-only ranges', () => {
    const source = [
      'import { x } from "./x";',
      'const app = createApp();',
      '',
      'app.use(middleware);',
      'app.use(routes);',
      '',
      'const PORT = 3000;',
      'app.listen(PORT);',
    ].join('\n');

    const chunks = chunkEntities(
      [
        { docComment: '', signature: '', startLine: 1, endLine: 1, code: 'import { x } from "./x";', filePath: 'server.ts', language: 'typescript', type: 'variable', name: 'x' },
        { docComment: '', signature: '', startLine: 2, endLine: 2, code: 'const app = createApp();', filePath: 'server.ts', language: 'typescript', type: 'variable', name: 'app' },
        { docComment: '', signature: '', startLine: 7, endLine: 7, code: 'const PORT = 3000;', filePath: 'server.ts', language: 'typescript', type: 'variable', name: 'PORT' },
      ] as any,
      'server.ts', source, 'typescript', { maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000, linesPerBodyChunk: 100 },
    );

    const uncovered = chunks.filter(c => c.entities.length === 0);
    expect(uncovered.length).toBe(2);
    expect(uncovered[0].startLine).toBe(3);
    expect(uncovered[0].content).toContain('app.use(middleware)');
    expect(uncovered[1].startLine).toBe(8);
    expect(uncovered[1].content).toContain('app.listen(PORT)');
  });

  it('produces both chunks when docComment is valid', () => {
    const chunks = chunkEntities(
      [{
        docComment: '/** Does x */', signature: 'function doX(): void',
        startLine: 1, endLine: 5, code: 'function doX() {}',
        filePath: 'a.ts', language: 'typescript', type: 'function', name: 'doX',
      }] as any,
      'a.ts', '', 'typescript', { maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000, linesPerBodyChunk: 100 },
    );
    expect(chunks.length).toBe(2);
    expect(chunks.find(c => c.chunkType === 'metadata')).toBeDefined();
    expect(chunks.find(c => c.chunkType === 'body')).toBeDefined();
  });
});
