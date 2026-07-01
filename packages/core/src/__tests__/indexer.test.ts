import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AstraConfig, CodeChunk } from '../types.js';

// Must mock before importing the module under test
const mockGetCollections = vi.fn();
const mockCreateCollection = vi.fn();
const mockDelete = vi.fn();
const mockUpsert = vi.fn();
const mockGetCollection = vi.fn();
const mockDeleteCollection = vi.fn();
const mockGetCollectionInfo = vi.fn();

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    getCollections: mockGetCollections,
    createCollection: mockCreateCollection,
    delete: mockDelete,
    upsert: mockUpsert,
    getCollection: mockGetCollection,
    deleteCollection: mockDeleteCollection,
    getCollectionInfo: mockGetCollectionInfo,
  })),
}));

vi.mock('../embedder.js', () => ({
  initEmbedder: vi.fn(),
  getEmbeddingDimension: vi.fn().mockResolvedValue(384),
  embedBatch: vi.fn(),
}));

import { ensureCollection, indexChunks, deleteFileChunks, deleteFileChunksBatch, resetCollection } from '../indexer.js';
import { embedBatch } from '../embedder.js';

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
  } as any;
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
  it('deletes existing points per unique filePath before upsert', async () => {
    vi.mocked(embedBatch).mockImplementation(async function* () {
      yield { chunk: makeChunk({ id: 'c1' }), embedding: [0.1, 0.2] };
    });

    await indexChunks([makeChunk({ id: 'c1' })], mockConfig, '/tmp', makeMockClient());

    expect(mockDelete).toHaveBeenCalledWith('test_collection', expect.objectContaining({
      filter: expect.objectContaining({
        must: expect.arrayContaining([
          expect.objectContaining({
            key: 'filePath',
            match: { any: ['src/a.ts'] },
          }),
        ]),
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
    mockDelete.mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      indexChunks([makeChunk({ id: 'c1' })], mockConfig, '/tmp', makeMockClient())
    ).rejects.toThrow(/connection|fetch|Qdrant/i);
  });
});

describe('deleteFileChunks', () => {
  it('suppresses "not found" errors', async () => {
    mockDelete.mockRejectedValue(new Error('Not found: Collection test_collection does not exist'));

    await expect(deleteFileChunks('src/a.ts', mockConfig)).resolves.toBeUndefined();
  });
});

describe('deleteFileChunksBatch', () => {
  it('suppresses "not found" errors', async () => {
    mockDelete.mockRejectedValue(new Error('Not found: Collection test_collection does not exist'));

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
});
