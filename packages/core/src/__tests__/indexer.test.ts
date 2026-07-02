import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AstraConfig, CodeChunk } from '../types.js';

// Must mock before importing the module under test
const mockGetCollections = vi.fn();
const mockCreateCollection = vi.fn();
const mockCreatePayloadIndex = vi.fn();
const mockDelete = vi.fn();
const mockUpsert = vi.fn();
const mockGetCollection = vi.fn();
const mockDeleteCollection = vi.fn();
const mockGetCollectionInfo = vi.fn();
const mockScroll = vi.fn();

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    getCollections: mockGetCollections,
    createCollection: mockCreateCollection,
    createPayloadIndex: mockCreatePayloadIndex,
    delete: mockDelete,
    upsert: mockUpsert,
    getCollection: mockGetCollection,
    deleteCollection: mockDeleteCollection,
    getCollectionInfo: mockGetCollectionInfo,
    scroll: mockScroll,
  })),
}));

vi.mock('../embedder.js', () => ({
  initEmbedder: vi.fn(),
  getEmbeddingDimension: vi.fn().mockResolvedValue(384),
  embedBatch: vi.fn(),
}));

let mockCacheData: {
  getAllIndexedFilePaths: string[];
  getAllChunkByFilePath: Map<string, string[]>;
  getChunkCount: number;
};

vi.mock('../cache.js', () => ({
  getCacheDir: vi.fn(() => '/tmp/test-cache'),
  storeChunkQdrantIds: vi.fn(),
  removeIndexedChunksBatch: vi.fn(),
  removeIndexedFilesBatch: vi.fn(),
  getChunkQdrantIdsByFilePaths: vi.fn(() => []),
  getAllIndexedFilePaths: vi.fn(() => mockCacheData?.getAllIndexedFilePaths ?? []),
  getAllChunkByFilePath: vi.fn(() => mockCacheData?.getAllChunkByFilePath ?? new Map()),
  getChunkCount: vi.fn(() => mockCacheData?.getChunkCount ?? 0),
  getLastIndexedMtime: vi.fn(() => null),
  removeIndexedFile: vi.fn(),
  removeIndexedChunks: vi.fn(),
}));

import {
  ensureCollection, indexChunks, deleteFileChunks, deleteFileChunksBatch, resetCollection,
  verifyIndexIntegrity, repairIndex,
} from '../indexer.js';
import { embedBatch } from '../embedder.js';
import type { QdrantClient } from '@qdrant/js-client-rest';

const mockConfig: AstraConfig = {
  include: ['**/*.ts'],
  exclude: [],
  qdrantUrl: 'http://localhost:6333',
  collectionName: 'test_collection',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  maxChunkSize: 50,
  maxBodyLines: 150,
  maxBodyChars: 4000,
  linesPerBodyChunk: 100,
  chunkOverlap: 25,
};

function makeMockClient() {
  return {
    delete: mockDelete,
    upsert: mockUpsert,
  } as unknown as QdrantClient;
}

function makeChunk(overrides: Partial<CodeChunk> = {}): CodeChunk {
  return {
    id: 'test-chunk',
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCacheData = {
    getAllIndexedFilePaths: [],
    getAllChunkByFilePath: new Map(),
    getChunkCount: 0,
  };
});

describe('ensureCollection', () => {
  it('creates collection when it does not exist', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockGetCollectionInfo.mockRejectedValue(new Error('not found'));

    await ensureCollection(mockConfig);

    expect(mockCreateCollection).toHaveBeenCalledWith('test_collection', expect.objectContaining({
      vectors: expect.objectContaining({
        dense: expect.objectContaining({ size: 384 }),
      }),
      sparse_vectors: expect.objectContaining({
        bm25: expect.objectContaining({}),
      }),
    }));
  });

  it('passes when collection already exists with matching config', async () => {
    mockGetCollections.mockResolvedValue({
      collections: [{ name: 'test_collection' }],
    });
    mockGetCollection.mockResolvedValue({
      config: {
        params: {
          vectors: {
            dense: { size: 384, distance: 'Cosine' },
          },
          sparse_vectors: {
            bm25: {},
          },
        },
      },
    });

    await expect(ensureCollection(mockConfig)).resolves.toBeDefined();
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  it('throws on vector size mismatch', async () => {
    mockGetCollections.mockResolvedValue({
      collections: [{ name: 'test_collection' }],
    });
    mockGetCollection.mockResolvedValue({
      config: {
        params: {
          vectors: {
            dense: { size: 768, distance: 'Cosine' },
          },
          sparse_vectors: {
            bm25: {},
          },
        },
      },
    });

    await expect(ensureCollection(mockConfig)).rejects.toThrow(/dimension|size/i);
  });

  it('throws when BM25 sparse vectors are missing', async () => {
    mockGetCollections.mockResolvedValue({
      collections: [{ name: 'test_collection' }],
    });
    mockGetCollection.mockResolvedValue({
      config: {
        params: {
          vectors: {
            dense: { size: 384, distance: 'Cosine' },
          },
        },
      },
    });

    await expect(ensureCollection(mockConfig)).rejects.toThrow(/migrate|bm25|sparse/i);
  });
});

describe('indexChunks', () => {
  it('upserts new points and does not blanket-delete by filePath', async () => {
    vi.mocked(embedBatch).mockImplementation(async function* () {
      yield { chunk: makeChunk({ id: 'c1' }), embedding: [0.1, 0.2] };
    });

    await indexChunks([makeChunk({ id: 'c1' })], mockConfig, '/tmp', makeMockClient());

    expect(mockUpsert).toHaveBeenCalledWith('test_collection', expect.objectContaining({
      points: expect.arrayContaining([
        expect.objectContaining({ id: expect.any(String) }),
      ]),
    }));
    expect(mockDelete).not.toHaveBeenCalledWith('test_collection', expect.objectContaining({
      filter: expect.objectContaining({
        key: 'filePath',
      }),
    }));
  });

  it('calls onProgress for each chunk', async () => {
    vi.mocked(embedBatch).mockImplementation(async function* () {
      yield { chunk: makeChunk({ id: 'c1' }), embedding: [0.1, 0.2] };
    });

    const onProgress = vi.fn();
    await indexChunks([makeChunk({ id: 'c1' })], mockConfig, '/tmp', makeMockClient(), onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it('throws QdrantConnectionError on network failure', async () => {
    vi.mocked(embedBatch).mockImplementation(async function* () {
      yield { chunk: makeChunk({ id: 'c1' }), embedding: [0.1, 0.2] };
    });
    mockUpsert.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      indexChunks([makeChunk({ id: 'c1' })], mockConfig, '/tmp', makeMockClient())
    ).rejects.toThrow(/connection|fetch|Qdrant/i);
  });
});

describe('deleteFileChunks', () => {
  it('suppresses "not found" errors', async () => {
    const err = new Error('Not Found');
    (err as unknown as Record<string, unknown>).status = 404;
    mockDelete.mockRejectedValue(err);

    await expect(deleteFileChunks('src/a.ts', mockConfig)).resolves.toBeUndefined();
  });
});

describe('deleteFileChunksBatch', () => {
  it('suppresses "not found" errors', async () => {
    const err = new Error('Not Found');
    (err as unknown as Record<string, unknown>).status = 404;
    mockDelete.mockRejectedValue(err);

    await expect(deleteFileChunksBatch(['src/a.ts', 'src/b.ts'], mockConfig)).resolves.toBeUndefined();
  });

  it('is a no-op for empty arrays', async () => {
    await expect(deleteFileChunksBatch([], mockConfig)).resolves.toBeUndefined();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('resetCollection', () => {
  it('deletes the collection', async () => {
    mockDeleteCollection.mockResolvedValue({ result: true });

    await resetCollection(mockConfig);

    expect(mockDeleteCollection).toHaveBeenCalledWith('test_collection');
  });

  it('suppresses "not found" errors (idempotent reset)', async () => {
    const err = new Error('Not Found');
    (err as unknown as Record<string, unknown>).status = 404;
    mockDeleteCollection.mockRejectedValue(err);

    await expect(resetCollection(mockConfig)).resolves.toBeUndefined();
  });

  it('propagates other errors', async () => {
    mockDeleteCollection.mockRejectedValue(new Error('Permission denied'));

    await expect(resetCollection(mockConfig)).rejects.toThrow();
  });
});

describe('verifyIndexIntegrity', () => {
  it('classifies ok when cache and Qdrant agree', async () => {
    mockCacheData = {
      getAllIndexedFilePaths: ['src/a.ts', 'src/b.ts'],
      getAllChunkByFilePath: new Map([
        ['src/a.ts', ['uuid-1', 'uuid-2']],
        ['src/b.ts', ['uuid-3']],
      ]),
      getChunkCount: 3,
    };

    mockScroll.mockResolvedValue({
      points: [
        { id: 'uuid-1', payload: { filePath: 'src/a.ts' } },
        { id: 'uuid-2', payload: { filePath: 'src/a.ts' } },
        { id: 'uuid-3', payload: { filePath: 'src/b.ts' } },
      ],
      next_page_offset: null,
    });

    const report = await verifyIndexIntegrity(mockConfig, '/tmp');

    expect(report.ok).toBe(2);
    expect(report.missingFromQdrant).toBe(0);
    expect(report.orphanedInQdrant).toBe(0);
    expect(report.mismatched).toBe(0);
  });

  it('classifies missing when cache has file but Qdrant has no points', async () => {
    mockCacheData = {
      getAllIndexedFilePaths: ['src/orphan.ts'],
      getAllChunkByFilePath: new Map([['src/orphan.ts', ['uuid-1']]]),
      getChunkCount: 1,
    };

    mockScroll.mockResolvedValue({
      points: [],
      next_page_offset: null,
    });

    const report = await verifyIndexIntegrity(mockConfig, '/tmp');

    expect(report.missingFromQdrant).toBe(1);
    expect(report.details[0].status).toBe('missing');
  });

  it('classifies orphaned when Qdrant has points but cache has no record', async () => {
    mockCacheData = {
      getAllIndexedFilePaths: [],
      getAllChunkByFilePath: new Map(),
      getChunkCount: 0,
    };

    mockScroll.mockResolvedValue({
      points: [
        { id: 'uuid-1', payload: { filePath: 'src/stale.ts' } },
      ],
      next_page_offset: null,
    });

    const report = await verifyIndexIntegrity(mockConfig, '/tmp');

    expect(report.orphanedInQdrant).toBe(1);
    expect(report.details[0].status).toBe('orphaned');
  });

  it('classifies mismatch when chunk counts differ', async () => {
    mockCacheData = {
      getAllIndexedFilePaths: ['src/mismatch.ts'],
      getAllChunkByFilePath: new Map([['src/mismatch.ts', ['uuid-1']]]),
      getChunkCount: 1,
    };

    mockScroll.mockResolvedValue({
      points: [
        { id: 'uuid-1', payload: { filePath: 'src/mismatch.ts' } },
        { id: 'uuid-2', payload: { filePath: 'src/mismatch.ts' } },
      ],
      next_page_offset: null,
    });

    const report = await verifyIndexIntegrity(mockConfig, '/tmp');

    expect(report.mismatched).toBe(1);
    expect(report.details[0].status).toBe('mismatch');
  });

  it('paginates through multiple scroll results', async () => {
    mockCacheData = {
      getAllIndexedFilePaths: ['src/a.ts'],
      getAllChunkByFilePath: new Map([['src/a.ts', ['uuid-1', 'uuid-2']]]),
      getChunkCount: 2,
    };

    mockScroll
      .mockResolvedValueOnce({
        points: [
          { id: 'uuid-1', payload: { filePath: 'src/a.ts' } },
        ],
        next_page_offset: 100,
      })
      .mockResolvedValueOnce({
        points: [
          { id: 'uuid-2', payload: { filePath: 'src/a.ts' } },
        ],
        next_page_offset: null,
      });

    const report = await verifyIndexIntegrity(mockConfig, '/tmp');

    expect(report.ok).toBe(1);
    expect(mockScroll).toHaveBeenCalledTimes(2);
  });
});

describe('repairIndex', () => {
  it('deletes orphaned Qdrant points and removes missing cache entries', async () => {
    mockCacheData = {
      getAllIndexedFilePaths: ['src/missing.ts'],
      getAllChunkByFilePath: new Map([['src/missing.ts', ['uuid-1']]]),
      getChunkCount: 1,
    };

    mockScroll.mockResolvedValue({
      points: [
        { id: 'uuid-orphan', payload: { filePath: 'src/orphan.ts' } },
      ],
      next_page_offset: null,
    });

    const report = await repairIndex(mockConfig, '/tmp');

    expect(report.missingFromQdrant).toBe(1);
    expect(report.orphanedInQdrant).toBe(1);

    // orphaned path was deleted from Qdrant
    expect(mockDelete).toHaveBeenCalledWith('test_collection', expect.objectContaining({
      filter: expect.objectContaining({
        must: expect.arrayContaining([
          expect.objectContaining({ key: 'filePath', match: { any: ['src/orphan.ts'] } }),
        ]),
      }),
    }));
  });
});
