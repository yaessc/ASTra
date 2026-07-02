export type SupportedLanguage = 'typescript' | 'javascript' | 'tsx';

export interface AstraConfig {
  include: string[];
  exclude: string[];
  qdrantUrl: string;
  collectionName: string;
  modelId: string;
  maxChunkSize: number;
  maxBodyLines: number;
  maxBodyChars: number;
  linesPerBodyChunk: number;
  chunkOverlap: number;
}

export interface CodeEntity {
  type: 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'decorator' | 'export' | 'import' | 'field';
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  code: string;
  docComment: string;
  language: SupportedLanguage;
}

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  entities: CodeEntity[];
  language: SupportedLanguage;
  chunkType: 'metadata' | 'body';
}

export interface SearchResult {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  score: number;
  code: string;
  entities: CodeEntity[];
  language: SupportedLanguage;
  chunkType: 'metadata' | 'body';
}

export interface IndexStats {
  totalFiles: number;
  totalChunks: number;
  lastIndexed: string | null;
  collectionSize: number;
  vectorSize: number | null;
  cacheChunkCount?: number;
}

export interface FileIntegrityEntry {
  filePath: string;
  cacheChunkCount: number;
  qdrantChunkCount: number;
  status: 'ok' | 'missing' | 'orphaned' | 'mismatch';
}

export interface IndexVerificationReport {
  ok: number;
  missingFromQdrant: number;
  orphanedInQdrant: number;
  mismatched: number;
  details: FileIntegrityEntry[];
}

export interface IndexedFile {
  path: string;
  mtime: number;
  hash: string;
}

export interface ScannedFile {
  path: string;
  relativePath: string;
  language: SupportedLanguage;
  mtime: number;
}

export interface ScanResult {
  files: ScannedFile[];
}

export interface QdrantCodeChunkPayload {
  filePath: string;
  startLine: number;
  endLine: number;
  entityTypes: string[];
  entityNames: string[];
  firstEntitySignature: string;
  entities: Omit<CodeEntity, 'code'>[];
  entitiesJson: string;
  code: string;
  language: string;
  chunkType: string;
}
