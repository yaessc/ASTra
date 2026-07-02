import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLoadConfig, mockInitEmbedder, mockEnsureCollection,
  mockScanFiles, mockInitLanguages, mockSearchHybrid,
  mockGetIndexStats, mockResetCollection,
  mockReadFileWithHash, mockExtractEntities, mockChunkEntities,
  MockConfigValidationError, MockQdrantConnectionError,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockInitEmbedder: vi.fn(),
  mockEnsureCollection: vi.fn(),
  mockScanFiles: vi.fn(),
  mockInitLanguages: vi.fn(),
  mockSearchHybrid: vi.fn(),
  mockGetIndexStats: vi.fn(),
  mockResetCollection: vi.fn(),
  mockReadFileWithHash: vi.fn(),
  mockExtractEntities: vi.fn(),
  mockChunkEntities: vi.fn(),
  MockConfigValidationError: class extends Error {
    issues: { path: string; message: string }[];
    constructor(issues: { path: string; message: string }[]) {
      super('Config validation failed');
      this.issues = issues;
    }
  },
  MockQdrantConnectionError: class extends Error {
    constructor(msg: string) { super(msg); this.name = 'QdrantConnectionError'; }
  },
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock('picocolors', () => ({
  default: {
    cyan: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
  },
}));

vi.mock('@astra/core', () => ({
  loadConfig: mockLoadConfig,
  initEmbedder: mockInitEmbedder,
  ensureCollection: mockEnsureCollection,
  scanFiles: mockScanFiles,
  initLanguages: mockInitLanguages,
  searchHybrid: mockSearchHybrid,
  getIndexStats: mockGetIndexStats,
  resetCollection: mockResetCollection,
  ConfigValidationError: MockConfigValidationError,
  QdrantConnectionError: MockQdrantConnectionError,
  readFileWithHash: mockReadFileWithHash,
  extractEntities: mockExtractEntities,
  chunkEntities: mockChunkEntities,
  indexChunks: vi.fn(),
  setIndexedFile: vi.fn(),
  setIndexedFiles: vi.fn(),
  getIndexedFile: vi.fn(),
  getAllIndexedFilePaths: vi.fn(() => []),
  removeIndexedFile: vi.fn(),
  removeIndexedFilesBatch: vi.fn(),
  removeIndexedChunks: vi.fn(),
  removeIndexedChunksBatch: vi.fn(),
  getChunkQdrantIdsByFilePaths: vi.fn(() => []),
  deleteFileChunks: vi.fn(),
  deleteFileChunksBatch: vi.fn(),
  getCacheDir: vi.fn(() => '/tmp/cache'),
  closeCache: vi.fn(),
  wasCacheReset: vi.fn(() => false),
  getEmbeddingDimension: vi.fn(),
}));

import { indexCommand } from '../commands/index-cmd.js';
import { queryCommand } from '../commands/query.js';
import { statusCommand } from '../commands/status.js';
import { resetCommand } from '../commands/reset.js';
import { note } from '@clack/prompts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('indexCommand', () => {
  it('handles ConfigValidationError gracefully', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new MockConfigValidationError([
        { path: 'qdrantUrl', message: 'Invalid URL' },
      ]);
    });

    await indexCommand('/tmp');

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'), 'Config Error');
  });

  it('handles QdrantConnectionError during ensureCollection', async () => {
    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockInitEmbedder.mockResolvedValue(undefined);
    mockInitLanguages.mockResolvedValue(undefined);
    mockScanFiles.mockReturnValue({
      files: [{
        path: '/tmp/src/a.ts',
        relativePath: 'src/a.ts',
        language: 'typescript',
        mtime: 1000,
      }],
    });
    mockReadFileWithHash.mockReturnValue({ content: 'const a = 1;', hash: 'abc' });
    mockExtractEntities.mockReturnValue([]);
    mockChunkEntities.mockReturnValue([]);
    mockEnsureCollection.mockRejectedValue(new MockQdrantConnectionError('Connection refused'));

    await expect(indexCommand('/tmp')).rejects.toThrow('Connection refused');
  });
});

describe('queryCommand', () => {
  it('handles invalid --limit flag', async () => {
    await queryCommand('test query', { limit: 'invalid' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Invalid limit'), 'Invalid Option');
  });

  it('handles invalid --mode flag', async () => {
    await queryCommand('test query', { mode: 'invalid' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Invalid mode'), 'Invalid Option');
  });

  it('handles ConfigValidationError gracefully', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new MockConfigValidationError([
        { path: 'qdrantUrl', message: 'Invalid URL' },
      ]);
    });

    await queryCommand('test query', { limit: '10', mode: 'hybrid' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'), 'Config Error');
  });

  it('shows no-matches note when results are empty', async () => {
    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockInitEmbedder.mockResolvedValue(undefined);
    mockEnsureCollection.mockResolvedValue({} as any);
    mockSearchHybrid.mockResolvedValue([]);

    await queryCommand('nonexistent query', { limit: '10', mode: 'hybrid' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('No results'), 'No matches');
  });
});

describe('statusCommand', () => {
  it('shows N/A vector size when Qdrant is unreachable', async () => {
    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockGetIndexStats.mockReturnValue({
      totalFiles: 0,
      totalChunks: 0,
      lastIndexed: null,
      collectionSize: 0,
      vectorSize: null,
    });

    await statusCommand({ dir: '/tmp' });

    expect(note).toHaveBeenCalledWith(
      expect.stringContaining('N/A'),
      expect.any(String),
    );
  });
});

describe('resetCommand', () => {
  it('handles ConfigValidationError gracefully', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new MockConfigValidationError([
        { path: 'qdrantUrl', message: 'Invalid URL' },
      ]);
    });

    await resetCommand({ dir: '/tmp' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'), 'Config Error');
  });
});
