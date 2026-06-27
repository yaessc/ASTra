export type SupportedLanguage = 'typescript' | 'javascript' | 'tsx';

export interface ScsConfig {
  include: string[];
  exclude: string[];
  qdrantUrl: string;
  collectionName: string;
  modelId: string;
  maxChunkSize: number;
}

export interface CodeEntity {
  type: 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'decorator' | 'export' | 'import';
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
  content: string;
  mtime: number;
  hash: string;
}

export interface ScanResult {
  files: ScannedFile[];
}
