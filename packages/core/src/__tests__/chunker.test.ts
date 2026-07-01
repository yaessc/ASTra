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
      'a.ts', '', 'typescript', { maxChunkSize: 50 },
    );
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkType).toBe('body');
  });

  it('windows all lines when no entities exist', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
    const source = lines.join('\n');
    const chunks = chunkEntities([], 'a.ts', source, 'typescript', { maxChunkSize: 50 });
    expect(chunks.length).toBe(3);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
    expect(chunks[1].startLine).toBe(51);
    expect(chunks[1].endLine).toBe(100);
    expect(chunks[2].startLine).toBe(101);
    expect(chunks[2].endLine).toBe(120);
    expect(chunks.every(c => c.content.length > 0)).toBe(true);
  });

  it('produces both chunks when docComment is valid', () => {
    const chunks = chunkEntities(
      [{
        docComment: '/** Does x */', signature: 'function doX(): void',
        startLine: 1, endLine: 5, code: 'function doX() {}',
        filePath: 'a.ts', language: 'typescript', type: 'function', name: 'doX',
      }] as any,
      'a.ts', '', 'typescript', { maxChunkSize: 50 },
    );
    expect(chunks.length).toBe(2);
    expect(chunks.find(c => c.chunkType === 'metadata')).toBeDefined();
    expect(chunks.find(c => c.chunkType === 'body')).toBeDefined();
  });
});
