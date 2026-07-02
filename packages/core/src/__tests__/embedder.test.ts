import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPipelineResult = {
  data: new Float32Array([0.1, 0.2, 0.3]),
  dims: [1, 3],
};
const mockPipeline = vi.fn().mockResolvedValue(mockPipelineResult);

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(mockPipeline),
}));

import { embedBatch, embedText, formatCodeForEmbedding } from '../embedder.js';
import type { AstraConfig, CodeChunk } from '../types.js';

const mockConfig: AstraConfig = {
  include: ['src/**/*.ts'],
  exclude: [],
  qdrantUrl: 'http://localhost:6333',
  collectionName: 'test',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
  linesPerBodyChunk: 100, chunkOverlap: 25,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatCodeForEmbedding', () => {
  function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
    return {
      id: 'chunk-1',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 5,
      content: 'const x = 1;',
      entities: [],
      language: 'typescript',
      chunkType: 'body',
      ...overrides,
    };
  }

  it('returns raw content for metadata chunks', () => {
    const result = formatCodeForEmbedding(makeChunk({ chunkType: 'metadata', content: 'file header' }), mockConfig);
    expect(result).toBe('file header');
  });

  it('prepends entity signatures for body chunks with entities', () => {
    const chunk = makeChunk({
      entities: [
        { type: 'function', name: 'foo', filePath: 'src/a.ts', startLine: 1, endLine: 3, signature: 'function foo()', code: 'function foo() {}', docComment: '', language: 'typescript' },
      ],
    });
    const result = formatCodeForEmbedding(chunk, mockConfig);
    expect(result).toContain('[function] function foo()');
    expect(result).toContain(chunk.content);
  });

  it('returns only truncated content for body chunks without entities', () => {
    const chunk = makeChunk({ entities: [], content: 'const x = 1;' });
    const result = formatCodeForEmbedding(chunk, mockConfig);
    expect(result).toBe(chunk.content);
  });

  it('truncates content to config.maxBodyChars', () => {
    const longContent = 'a'.repeat(5000);
    const chunk = makeChunk({ entities: [], content: longContent });
    const result = formatCodeForEmbedding(chunk, mockConfig);
    expect(result.length).toBeLessThanOrEqual(4000);
  });
});

describe('getEmbeddingDimension', () => {
  it('runs inference and caches result across calls', async () => {
    mockPipeline.mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]), dims: [1, 3] });
    const { getEmbeddingDimension } = await import('../embedder.js');
    const dim1 = await getEmbeddingDimension(mockConfig);
    expect(dim1).toBe(3);
    const dim2 = await getEmbeddingDimension(mockConfig);
    expect(dim2).toBe(3);
  });

  it('falls back to 384 when dims is undefined', async () => {
    vi.resetModules();
    mockPipeline.mockResolvedValue({ data: new Float32Array(384), dims: undefined });
    const { getEmbeddingDimension } = await import('../embedder.js');
    const dim = await getEmbeddingDimension(mockConfig);
    expect(dim).toBe(384);
  });
});

describe('embedBatch', () => {
  function makeChunk(id: string): CodeChunk {
    return {
      id,
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 5,
      content: 'const x = 1;',
      entities: [],
      language: 'typescript',
      chunkType: 'body',
    };
  }

  it('yields one result for a single chunk', async () => {
    const results: Array<{ chunk: CodeChunk; embedding: number[] }> = [];
    for await (const r of embedBatch([makeChunk('c1')], mockConfig)) {
      results.push(r);
    }
    expect(results).toHaveLength(1);
    expect(results[0].chunk.id).toBe('c1');
  });

  it('batches 16 chunks in one call', async () => {
    const chunks = Array.from({ length: 16 }, (_, i) => makeChunk(`c${i}`));
    mockPipeline.mockResolvedValue({
      data: new Float32Array(16 * 3),
      dims: [16, 3],
    });
    const results: Array<{ chunk: CodeChunk; embedding: number[] }> = [];
    for await (const r of embedBatch(chunks, mockConfig)) {
      results.push(r);
    }
    expect(results).toHaveLength(16);
    expect(mockPipeline).toHaveBeenCalledTimes(1);
  });

  it('splits 17 chunks into two batches', async () => {
    const chunks = Array.from({ length: 17 }, (_, i) => makeChunk(`c${i}`));
    mockPipeline.mockResolvedValue({
      data: new Float32Array(16 * 3),
      dims: [16, 3],
    });
    const results: Array<{ chunk: CodeChunk; embedding: number[] }> = [];
    for await (const r of embedBatch(chunks, mockConfig)) {
      results.push(r);
    }
    expect(results).toHaveLength(17);
    expect(mockPipeline).toHaveBeenCalledTimes(2);
  });
});

describe('embedText', () => {
  it('returns an array of numbers from embedding', async () => {
    mockPipeline.mockResolvedValue({
      data: new Float32Array([0.1, 0.2, 0.3]),
      dims: [1, 3],
    });
    const result = await embedText('test', mockConfig);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
  });
});
