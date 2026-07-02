export type {
  AstraConfig, CodeEntity, CodeChunk, SearchResult, IndexStats,
  SupportedLanguage, IndexedFile, ScanResult, ScannedFile,
  IndexVerificationReport, FileIntegrityEntry,
} from './types.js';
export { loadConfig, writeDefaultConfig, AstraConfigSchema } from './config.js';
export { scanFiles, readFileWithHash } from './scanner.js';
export { initLanguages } from './languages.js';
export { parseFile } from './parser.js';
export { extractEntities } from './entities.js';
export { chunkEntities } from './chunker.js';
export { initEmbedder, embedText, embedBatch, getEmbeddingDimension } from './embedder.js';
export {
  ensureCollection, indexChunks, deleteFileChunks, deleteFileChunksBatch,
  getIndexStats, resetCollection, verifyIndexIntegrity, repairIndex,
} from './indexer.js';
export { searchCodebase, searchHybrid, type SearchMode } from './query.js';
export {
  getCacheDir, clearCache, closeCache, wasCacheReset, setIndexedFile, setIndexedFiles, getIndexedFile,
  removeIndexedFile, removeIndexedFilesBatch, removeIndexedChunks, removeIndexedChunksBatch, getChunkQdrantIdsByFilePaths, getAllIndexedFilePaths,
  getMetadata, setMetadata, getChunkCount, getAllChunkByFilePath,
} from './cache.js';
export {
  QdrantConnectionError, ModelLoadError, ConfigValidationError,
  isQdrantError, wrapQdrantError,
} from './errors.js';
