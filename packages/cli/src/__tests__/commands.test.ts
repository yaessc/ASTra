import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLoadConfig, mockInitEmbedder, mockEnsureCollection,
  mockScanFiles, mockInitLanguages, mockSearchHybrid,
  mockGetIndexStats, mockResetCollection,
  mockReadFileWithHash, mockExtractEntities, mockChunkEntities,
  mockVerifyIndexIntegrity, mockRepairIndex,
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
  mockVerifyIndexIntegrity: vi.fn(),
  mockRepairIndex: vi.fn(),
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

vi.mock('node:child_process', () => {
  const EventEmitter = require('events');
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.stdout = null;
      child.stderr = null;
      child.pid = 999;
      child.connected = true;
      child.kill = vi.fn();
      process.nextTick(() => child.emit('error', new Error('spawn ENOENT')));
      return child;
    }),
  };
});

vi.mock('@astra/core', () => ({
  loadConfig: mockLoadConfig,
  initEmbedder: mockInitEmbedder,
  ensureCollection: mockEnsureCollection,
  scanFiles: mockScanFiles,
  initLanguages: mockInitLanguages,
  searchHybrid: mockSearchHybrid,
  getIndexStats: mockGetIndexStats,
  resetCollection: mockResetCollection,
  verifyIndexIntegrity: mockVerifyIndexIntegrity,
  repairIndex: mockRepairIndex,
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
import { queryCommand, handleReplCommand, queryHistory } from '../commands/query.js';
import { statusCommand } from '../commands/status.js';
import { resetCommand } from '../commands/reset.js';
import { verifyCommand } from '../commands/verify.js';
import { note, outro, select, text, isCancel } from '@clack/prompts';

const defaultConfig = {
  include: ['src/**/*.ts'],
  exclude: [],
  qdrantUrl: 'http://localhost:6333',
  collectionName: 'test',
  modelId: 'test-model',
  maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
  linesPerBodyChunk: 100, chunkOverlap: 25,
};

const mockResult = {
  chunkId: '1', filePath: 'test.ts', startLine: 1, endLine: 10,
  score: 0.9, code: 'function foo() {}', entities: [],
  language: 'typescript' as const, chunkType: 'body' as const,
};

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
        language: 'typescript' as const,
        mtime: 1000,
      }],
      warnings: [],
    });
    mockReadFileWithHash.mockReturnValue({ content: 'const a = 1;', hash: 'abc' });
    mockExtractEntities.mockReturnValue([]);
    mockChunkEntities.mockReturnValue([]);
    mockEnsureCollection.mockRejectedValue(new MockQdrantConnectionError('Connection refused'));

    await indexCommand('/tmp');

    expect(note).toHaveBeenCalledWith('Connection refused', 'Qdrant Error');
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
    mockEnsureCollection.mockResolvedValue({} as never);
    mockSearchHybrid.mockResolvedValue([]);

    await queryCommand('nonexistent query', { limit: '10', mode: 'hybrid' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('No results'), 'No matches');
  });
});

describe('postSearchMenu via queryCommand', () => {
  beforeEach(() => {
    mockLoadConfig.mockReturnValue(defaultConfig);
    mockInitEmbedder.mockResolvedValue(undefined);
    mockEnsureCollection.mockResolvedValue({} as never);
    mockSearchHybrid.mockResolvedValue([mockResult]);
    queryHistory.length = 0;
  });

  it('exits when user selects Exit', async () => {
    vi.mocked(select).mockResolvedValueOnce('exit');

    await queryCommand('find foo', { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Done');
  });

  it('returns search when user selects Search again', async () => {
    vi.mocked(select).mockResolvedValueOnce('search');

    await queryCommand('find foo', { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Done');
  });

  it('re-enters loop after Open + file pick then exits', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('open')
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce('exit');

    await queryCommand('find foo', { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Done');
  });

  it('re-enters loop after Open + cancel file pick then exits', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('open')
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce('exit');
    vi.mocked(isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true);

    await queryCommand('find foo', { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Done');
  });
});

describe('queryCommand interactive REPL', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockLoadConfig.mockReturnValue(defaultConfig);
    mockInitEmbedder.mockResolvedValue(undefined);
    mockEnsureCollection.mockResolvedValue({} as never);
    mockSearchHybrid.mockResolvedValue([]);
    queryHistory.length = 0;
    vi.mocked(text).mockReset();
    vi.mocked(select).mockReset();
  });

  it('exits on Ctrl+C at text prompt', async () => {
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('skips empty input and continues to :exit', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(':exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('exits via :exit command', async () => {
    vi.mocked(text).mockResolvedValueOnce(':exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('updates limit via :limit command then exits', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce(':limit 20')
      .mockResolvedValueOnce(':exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Limit set to 20'));
    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('updates mode via :mode keyword command then exits', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce(':mode keyword')
      .mockResolvedValueOnce(':exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Mode set to keyword'));
    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('executes a search query and exits via menu', async () => {
    mockSearchHybrid.mockResolvedValue([mockResult]);
    vi.mocked(text)
      .mockResolvedValueOnce('find foo')
      .mockResolvedValueOnce(':exit');
    vi.mocked(select).mockResolvedValueOnce('exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(mockSearchHybrid).toHaveBeenCalledWith('find foo', defaultConfig, 10, { mode: 'hybrid' });
    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('shows no-matches note on empty search results then continues', async () => {
    mockSearchHybrid.mockResolvedValue([]);
    vi.mocked(text)
      .mockResolvedValueOnce('find foo')
      .mockResolvedValueOnce(':exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(note).toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });

  it('handles search error gracefully then continues', async () => {
    mockSearchHybrid.mockRejectedValue(new Error('Search crashed'));
    vi.mocked(text)
      .mockResolvedValueOnce('find foo')
      .mockResolvedValueOnce(':exit');

    await queryCommand(undefined, { limit: '10', mode: 'hybrid' });

    expect(note).toHaveBeenCalledWith('Search crashed', 'Search Error');
    expect(outro).toHaveBeenCalledWith('Goodbye!');
  });
});

describe('handleReplCommand', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'clear').mockImplementation(() => {});
    queryHistory.length = 0;
  });

  it(':help returns null', async () => {
    expect(await handleReplCommand(':help')).toBeNull();
  });

  it(':clear calls console.clear and returns null', async () => {
    expect(await handleReplCommand(':clear')).toBeNull();
    expect(console.clear).toHaveBeenCalled();
  });

  it(':history on empty history logs no-queries message', async () => {
    expect(await handleReplCommand(':history')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No queries yet'));
  });

  it(':history with entries logs numbered history', async () => {
    queryHistory.push('query1', 'query2');
    expect(await handleReplCommand(':history')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('1.'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('query1'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('2.'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('query2'));
  });

  it(':exit returns -1', async () => {
    expect(await handleReplCommand(':exit')).toBe(-1);
  });

  it(':limit N returns { limit: N } for valid number', async () => {
    const result = await handleReplCommand(':limit 5');
    expect(result).toEqual({ limit: 5 });
  });

  it(':limit 0 returns null and logs usage', async () => {
    expect(await handleReplCommand(':limit 0')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it(':limit negative returns null and logs usage', async () => {
    expect(await handleReplCommand(':limit -1')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it(':limit with non-numeric arg returns null and logs usage', async () => {
    expect(await handleReplCommand(':limit abc')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it(':limit with no arg returns null and logs usage', async () => {
    expect(await handleReplCommand(':limit ')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it(':mode vector returns { mode: "vector" }', async () => {
    expect(await handleReplCommand(':mode vector')).toEqual({ mode: 'vector' });
  });

  it(':mode keyword returns { mode: "keyword" }', async () => {
    expect(await handleReplCommand(':mode keyword')).toEqual({ mode: 'keyword' });
  });

  it(':mode hybrid returns { mode: "hybrid" }', async () => {
    expect(await handleReplCommand(':mode hybrid')).toEqual({ mode: 'hybrid' });
  });

  it(':mode with invalid value returns null and logs usage', async () => {
    expect(await handleReplCommand(':mode invalid')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  });

  it('unknown command returns null and logs unknown message', async () => {
    expect(await handleReplCommand(':foo')).toBeNull();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Unknown command'));
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

describe('verifyCommand', () => {
  it('reports OK when integrity is clean', async () => {
    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockVerifyIndexIntegrity.mockResolvedValue({
      ok: 5, missingFromQdrant: 0, orphanedInQdrant: 0, mismatched: 0,
      details: [],
    });

    await verifyCommand({ dir: '/tmp' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Cache and Qdrant are in sync'), 'Integrity OK');
  });

  it('shows repair hint when issues found without --fix', async () => {
    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockVerifyIndexIntegrity.mockResolvedValue({
      ok: 0, missingFromQdrant: 2, orphanedInQdrant: 1, mismatched: 0,
      details: [],
    });

    await verifyCommand({ dir: '/tmp' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('--fix'), 'Repair available');
  });

  it('calls repairIndex when --fix is passed and confirmed', async () => {
    const { confirm } = await import('@clack/prompts');
    vi.mocked(confirm).mockResolvedValueOnce(true);

    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockVerifyIndexIntegrity.mockResolvedValue({
      ok: 0, missingFromQdrant: 1, orphanedInQdrant: 0, mismatched: 0,
      details: [],
    });
    mockRepairIndex.mockResolvedValue({
      ok: 0, missingFromQdrant: 1, orphanedInQdrant: 0, mismatched: 0,
      details: [],
    });

    await verifyCommand({ dir: '/tmp', fix: true });

    expect(mockRepairIndex).toHaveBeenCalled();
    expect(note).toHaveBeenCalledWith(expect.stringContaining('re-index'), 'Next Step');
  });

  it('handles ConfigValidationError gracefully', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new MockConfigValidationError([
        { path: 'qdrantUrl', message: 'Invalid URL' },
      ]);
    });

    await verifyCommand({ dir: '/tmp' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Invalid URL'), 'Config Error');
  });

  it('handles QdrantConnectionError gracefully', async () => {
    mockLoadConfig.mockReturnValue({
      include: ['src/**/*.ts'],
      exclude: [],
      qdrantUrl: 'http://localhost:6333',
      collectionName: 'test',
      modelId: 'test-model',
      maxChunkSize: 50, maxBodyLines: 150, maxBodyChars: 4000,
      linesPerBodyChunk: 100, chunkOverlap: 25,
    });
    mockVerifyIndexIntegrity.mockRejectedValue(new MockQdrantConnectionError('Connection refused'));

    await verifyCommand({ dir: '/tmp' });

    expect(note).toHaveBeenCalledWith(expect.stringContaining('Connection refused'), 'Qdrant Error');
  });
});
