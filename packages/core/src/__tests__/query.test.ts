import { describe, it, expect, vi } from 'vitest';

const mockClientQuery = vi.fn();

vi.mock('../qdrant.js', () => ({
  createClient: vi.fn(() => ({ query: mockClientQuery })),
  safeQdrantCall: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../embedder.js', () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import { toQdrantPayload, mapResult, searchCodebase, keywordSearch, searchHybrid } from '../query.js';
import type { AstraConfig } from '../types.js';

const mockConfig: AstraConfig = {
  include: ['src/**/*.ts'],
  exclude: [],
  qdrantUrl: 'http://localhost:6333',
  collectionName: 'test',
  modelId: 'test-model',
  maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
  linesPerBodyChunk: 100, chunkOverlap: 25,
};

describe('toQdrantPayload', () => {
  it('returns defaults for null payload', () => {
    const p = toQdrantPayload(null);
    expect(p.filePath).toBe('');
    expect(p.startLine).toBe(0);
    expect(p.endLine).toBe(0);
    expect(p.entities).toEqual([]);
    expect(p.entitiesJson).toBe('[]');
    expect(p.code).toBe('');
    expect(p.language).toBe('typescript');
    expect(p.chunkType).toBe('body');
  });

  it('returns defaults for undefined payload', () => {
    const p = toQdrantPayload(undefined);
    expect(p.filePath).toBe('');
    expect(p.entities).toEqual([]);
  });

  it('maps all fields when present', () => {
    const p = toQdrantPayload({
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 20,
      entityTypes: ['function'],
      entityNames: ['foo'],
      firstEntitySignature: 'function foo()',
      entities: [{ type: 'function', name: 'foo' }],
      entitiesJson: '[{"type":"function","name":"foo"}]',
      code: 'function foo() {}',
      language: 'typescript',
      chunkType: 'body',
    });
    expect(p.filePath).toBe('src/a.ts');
    expect(p.startLine).toBe(10);
    expect(p.endLine).toBe(20);
    expect(p.entities).toEqual([{ type: 'function', name: 'foo' }]);
    expect(p.code).toBe('function foo() {}');
    expect(p.language).toBe('typescript');
  });

  it('coerces wrong types to defaults', () => {
    const p = toQdrantPayload({
      filePath: 42,
      startLine: 'abc',
      entities: 'not-an-array',
      code: true,
    });
    expect(p.filePath).toBe('42');
    expect(p.startLine).toBeNaN();
    expect(p.entities).toEqual([]);
    expect(p.code).toBe('true');
  });
});

describe('mapResult', () => {
  it('uses native entities array when present', () => {
    const r = mapResult({
      id: 'abc-123',
      payload: {
        filePath: 'src/a.ts',
        entities: [{ type: 'function', name: 'foo' }],
        entitiesJson: '[{"type":"function","name":"foo"}]',
        code: 'function foo() {}',
        language: 'typescript',
        chunkType: 'body',
      },
      score: 0.95,
    });
    expect(r.chunkId).toBe('abc-123');
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0].name).toBe('foo');
    expect(r.score).toBe(0.95);
  });

  it('falls back to entitiesJson when native array is empty', () => {
    const r = mapResult({
      id: 'def-456',
      payload: {
        filePath: 'src/b.ts',
        entitiesJson: '[{"type":"class","name":"Bar"}]',
        code: 'class Bar {}',
        language: 'typescript',
        chunkType: 'body',
      },
    });
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0].name).toBe('Bar');
  });

  it('returns empty entities when both are absent', () => {
    const r = mapResult({
      id: 'ghi-789',
      payload: { filePath: 'src/c.ts', code: '', language: 'typescript', chunkType: 'body' },
    });
    expect(r.entities).toEqual([]);
  });

  it('prefers native entities over entitiesJson when both present', () => {
    const r = mapResult({
      id: 'xyz',
      payload: {
        filePath: 'src/x.ts',
        entities: [{ type: 'variable', name: 'native' }],
        entitiesJson: '[{"type":"variable","name":"legacy"}]',
        code: '',
        language: 'typescript',
        chunkType: 'body',
      },
    });
    expect(r.entities[0].name).toBe('native');
  });

  it('handles null/undefined score', () => {
    const r = mapResult({
      id: '123',
      payload: undefined,
    });
    expect(r.score).toBe(0);
    expect(r.filePath).toBe('');
  });
});

describe('searchCodebase', () => {
  it('returns SearchResult[] on success', async () => {
    mockClientQuery.mockResolvedValue({
      points: [{
        id: 'p1',
        payload: { filePath: 'src/a.ts', code: 'const x = 1;', language: 'typescript', chunkType: 'body' },
        score: 0.9,
      }],
    });

    const results = await searchCodebase('test query', mockConfig, 5);
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('src/a.ts');
  });

  it('throws on Qdrant error', async () => {
    mockClientQuery.mockRejectedValue(new Error('Connection refused'));
    await expect(searchCodebase('test', mockConfig, 5)).rejects.toThrow();
  });
});

describe('keywordSearch', () => {
  it('returns SearchResult[] on success', async () => {
    mockClientQuery.mockResolvedValue({
      points: [{
        id: 'p1',
        payload: { filePath: 'src/a.ts', code: 'const x = 1;', language: 'typescript', chunkType: 'body' },
        score: 0.8,
      }],
    });

    const results = await keywordSearch('test query', mockConfig, 5);
    expect(results).toHaveLength(1);
    expect(results[0].filePath).toBe('src/a.ts');
  });
});

describe('searchHybrid', () => {
  it('dispatches to vector mode', async () => {
    mockClientQuery.mockResolvedValue({ points: [{
      id: 'p1',
      payload: { filePath: 'src/a.ts', code: '', language: 'typescript', chunkType: 'body' },
      score: 0.9,
    }] });
    const results = await searchHybrid('test', mockConfig, 5, { mode: 'vector' });
    expect(results).toHaveLength(1);
  });

  it('dispatches to keyword mode', async () => {
    mockClientQuery.mockResolvedValue({ points: [{
      id: 'p1',
      payload: { filePath: 'src/a.ts', code: '', language: 'typescript', chunkType: 'body' },
      score: 0.8,
    }] });
    const results = await searchHybrid('test', mockConfig, 5, { mode: 'keyword' });
    expect(results).toHaveLength(1);
  });

  it('merges results in hybrid mode', async () => {
    mockClientQuery.mockResolvedValue({ points: [{
      id: 'p1',
      payload: { filePath: 'src/a.ts', code: '', language: 'typescript', chunkType: 'body' },
      score: 0.9,
    }] });
    const results = await searchHybrid('test', mockConfig, 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty array on no matches', async () => {
    mockClientQuery.mockResolvedValue({ points: [] });
    const results = await searchHybrid('nonexistent', mockConfig, 5);
    expect(results).toEqual([]);
  });
});
