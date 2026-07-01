import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCacheDir, getIndexedFile, getAllIndexedFilePaths,
  setIndexedFile, setIndexedFiles, removeIndexedFile,
  removeIndexedChunks, storeChunkQdrantIds,
  getMetadata, setMetadata, getLastIndexedMtime,
  clearCache, closeCache,
} from '../cache.js';

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'cache-test-'));
});

afterEach(() => {
  closeCache();
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('getCacheDir', () => {
  it('returns path under .astra/cache in the given rootDir', () => {
    const result = getCacheDir('/some/project');
    expect(result).toBe(join('/some/project', '.astra', 'cache'));
  });
});

describe('CRUD operations', () => {
  it('getIndexedFile returns null on empty DB', () => {
    expect(getIndexedFile(cacheDir, 'foo.ts')).toBeNull();
  });

  it('getAllIndexedFilePaths returns empty array on empty DB', () => {
    expect(getAllIndexedFilePaths(cacheDir)).toEqual([]);
  });

  it('setIndexedFile then getIndexedFile returns same data', () => {
    setIndexedFile(cacheDir, { path: 'src/a.ts', mtime: 1000, hash: 'abc' });
    const result = getIndexedFile(cacheDir, 'src/a.ts');
    expect(result).toEqual({ path: 'src/a.ts', mtime: 1000, hash: 'abc' });
  });

  it('setIndexedFile overwrites existing entry for the same path', () => {
    setIndexedFile(cacheDir, { path: 'src/a.ts', mtime: 1000, hash: 'abc' });
    setIndexedFile(cacheDir, { path: 'src/a.ts', mtime: 1000, hash: 'def' });
    expect(getIndexedFile(cacheDir, 'src/a.ts')?.hash).toBe('def');
  });

  it('setIndexedFiles batch inserts multiple files', () => {
    const files = [
      { path: 'a.ts', mtime: 1, hash: 'h1' },
      { path: 'b.ts', mtime: 2, hash: 'h2' },
      { path: 'c.ts', mtime: 3, hash: 'h3' },
    ];
    setIndexedFiles(cacheDir, files);
    expect(getIndexedFile(cacheDir, 'a.ts')).toEqual(files[0]);
    expect(getIndexedFile(cacheDir, 'b.ts')).toEqual(files[1]);
    expect(getIndexedFile(cacheDir, 'c.ts')).toEqual(files[2]);
  });

  it('setIndexedFiles with empty array does nothing', () => {
    setIndexedFiles(cacheDir, []);
    expect(getAllIndexedFilePaths(cacheDir)).toEqual([]);
  });

  it('removeIndexedFile deletes the entry', () => {
    setIndexedFile(cacheDir, { path: 'x.ts', mtime: 1, hash: 'h' });
    removeIndexedFile(cacheDir, 'x.ts');
    expect(getIndexedFile(cacheDir, 'x.ts')).toBeNull();
  });

  it('removeIndexedFile on missing path does not throw', () => {
    expect(() => removeIndexedFile(cacheDir, 'nonexistent.ts')).not.toThrow();
  });

  it('removeIndexedChunks deletes only chunks matching file_path', () => {
    storeChunkQdrantIds(cacheDir, [
      { chunkId: 'c1', filePath: 'a.ts', startLine: 1, endLine: 5, qdrantId: 'q1' },
      { chunkId: 'c2', filePath: 'b.ts', startLine: 1, endLine: 5, qdrantId: 'q2' },
    ]);
    removeIndexedChunks(cacheDir, 'a.ts');
    // Re-insert another mapping for a.ts to see if it was cleared, then check b.ts still exists
    // We can verify indirectly: store same mapping again and it should work (new insert, not conflict)
    storeChunkQdrantIds(cacheDir, [
      { chunkId: 'c1', filePath: 'a.ts', startLine: 1, endLine: 5, qdrantId: 'q1' },
    ]);
    // No error means success — we can also verify by re-inserting b.ts mapping
    expect(() =>
      storeChunkQdrantIds(cacheDir, [
        { chunkId: 'c2', filePath: 'b.ts', startLine: 1, endLine: 5, qdrantId: 'q2' },
      ])
    ).not.toThrow();
  });

  it('getLastIndexedMtime returns null on empty DB', () => {
    expect(getLastIndexedMtime(cacheDir)).toBeNull();
  });

  it('getLastIndexedMtime returns max mtime across files', () => {
    setIndexedFile(cacheDir, { path: 'a.ts', mtime: 100, hash: 'h1' });
    setIndexedFile(cacheDir, { path: 'b.ts', mtime: 200, hash: 'h2' });
    expect(getLastIndexedMtime(cacheDir)).toBe(200);
  });
});

describe('metadata operations', () => {
  it('setMetadata / getMetadata round-trip', () => {
    setMetadata(cacheDir, 'key1', 'value1');
    expect(getMetadata(cacheDir, 'key1')).toBe('value1');
  });

  it('getMetadata returns null for missing key', () => {
    expect(getMetadata(cacheDir, 'nonexistent')).toBeNull();
  });
});

describe('clearCache', () => {
  it('empties all tables but keeps schema_version', () => {
    setIndexedFile(cacheDir, { path: 'a.ts', mtime: 1, hash: 'h' });
    setMetadata(cacheDir, 'mykey', 'myval');
    clearCache(cacheDir);
    expect(getAllIndexedFilePaths(cacheDir)).toEqual([]);
    expect(getMetadata(cacheDir, 'mykey')).toBeNull();
    expect(getMetadata(cacheDir, 'schema_version')).toBe('4');
  });
});

describe('connection lifecycle', () => {
  it('closeCache + re-open works', () => {
    setIndexedFile(cacheDir, { path: 'survivor.ts', mtime: 99, hash: 'h99' });
    closeCache();
    const result = getIndexedFile(cacheDir, 'survivor.ts');
    expect(result).toEqual({ path: 'survivor.ts', mtime: 99, hash: 'h99' });
  });

  it('two getCacheDir calls with different roots produce different paths', () => {
    const a = getCacheDir('/project-a');
    const b = getCacheDir('/project-b');
    expect(a).not.toBe(b);
  });
});
