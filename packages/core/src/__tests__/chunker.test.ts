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
