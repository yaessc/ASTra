export type {
  AstraConfig, CodeEntity, CodeChunk, SearchResult, IndexStats,
  SupportedLanguage, IndexedFile, ScanResult, ScannedFile,
} from './types.js';
export { loadConfig, writeDefaultConfig } from './config.js';
export { scanFiles } from './scanner.js';
export { initLanguages } from './languages.js';
export { parseFile } from './parser.js';
export { extractEntities } from './entities.js';
export { chunkEntities } from './chunker.js';
export { initEmbedder, embedText, embedBatch } from './embedder.js';
export {
  ensureCollection, indexChunks, deleteFileChunks,
  getIndexStats, resetCollection,
} from './indexer.js';
export { searchCodebase, searchHybrid, type SearchMode } from './query.js';
export {
  getCacheDir, clearCache, closeCache, setIndexedFile, getIndexedFile,
  removeIndexedFile, removeIndexedChunks, getAllIndexedFilePaths,
  getMetadata, setMetadata,
} from './cache.js';
export {
  QdrantConnectionError, ModelLoadError, ConfigValidationError,
  isQdrantError, wrapQdrantError,
} from './errors.js';
