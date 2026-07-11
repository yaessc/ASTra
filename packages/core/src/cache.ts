import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { IndexedFile } from './types.js';

const SCHEMA_VERSION = '4';
const CHUNK_SIZE = 500;

const databases = new Map<string, Database.Database>();
const resetFlags = new Map<string, boolean>();

function getDb(cacheDir: string): Database.Database {
  const dbPath = join(cacheDir, 'cache.db');
  const existing = databases.get(dbPath);
  if (existing) return existing;

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  const conn = new Database(dbPath);
  conn.exec('PRAGMA journal_mode = WAL;');
  conn.exec('PRAGMA synchronous = NORMAL;');
  conn.exec(`
    CREATE TABLE IF NOT EXISTS indexed_files (
      path TEXT PRIMARY KEY,
      mtime REAL NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS indexed_chunks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      qdrant_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_indexed_chunks_file_path ON indexed_chunks(file_path);
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const row = conn.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version') as { value: string } | undefined;
  if (!row || row.value !== SCHEMA_VERSION) {
    conn.exec('DELETE FROM indexed_files; DELETE FROM indexed_chunks; DELETE FROM metadata;');
    conn.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
    resetFlags.set(cacheDir, true);
  }

  databases.set(dbPath, conn);
  return conn;
}

export function getIndexedFile(cacheDir: string, filePath: string): IndexedFile | null {
  const d = getDb(cacheDir);
  const row = d.prepare('SELECT path, mtime, hash FROM indexed_files WHERE path = ?').get(filePath) as { path: string; mtime: number; hash: string } | undefined;
  return row ? { path: row.path, mtime: row.mtime, hash: row.hash } : null;
}

export function getAllIndexedFilePaths(cacheDir: string): string[] {
  const d = getDb(cacheDir);
  const rows = d.prepare('SELECT path FROM indexed_files').all() as { path: string }[];
  return rows.map(r => r.path);
}

export function setIndexedFile(cacheDir: string, file: IndexedFile): void {
  const d = getDb(cacheDir);
  d.prepare('INSERT OR REPLACE INTO indexed_files (path, mtime, hash) VALUES (?, ?, ?)').run(file.path, file.mtime, file.hash);
}

export function setIndexedFiles(cacheDir: string, files: IndexedFile[]): void {
  if (files.length === 0) return;
  const d = getDb(cacheDir);
  const insert = d.prepare('INSERT OR REPLACE INTO indexed_files (path, mtime, hash) VALUES (?, ?, ?)');
  const tx = d.transaction((rows: IndexedFile[]) => {
    for (const row of rows) {
      insert.run(row.path, row.mtime, row.hash);
    }
  });
  tx(files);
}

export function removeIndexedFile(cacheDir: string, filePath: string): void {
  const d = getDb(cacheDir);
  d.prepare('DELETE FROM indexed_files WHERE path = ?').run(filePath);
}

export function removeIndexedFilesBatch(cacheDir: string, filePaths: string[]): void {
  if (filePaths.length === 0) return;
  const d = getDb(cacheDir);
  const del = d.prepare('DELETE FROM indexed_files WHERE path = ?');
  const tx = d.transaction((paths: string[]) => {
    for (const fp of paths) {
      del.run(fp);
    }
  });
  tx(filePaths);
}

export function removeIndexedChunks(cacheDir: string, filePath: string): void {
  const d = getDb(cacheDir);
  d.prepare('DELETE FROM indexed_chunks WHERE file_path = ?').run(filePath);
}

export function removeIndexedChunksBatch(cacheDir: string, filePaths: string[]): void {
  if (filePaths.length === 0) return;
  const d = getDb(cacheDir);
  const del = d.prepare('DELETE FROM indexed_chunks WHERE file_path = ?');
  const tx = d.transaction((paths: string[]) => {
    for (const fp of paths) {
      del.run(fp);
    }
  });
  tx(filePaths);
}

export function getChunkQdrantIdsByFilePaths(cacheDir: string, filePaths: string[]): string[] {
  if (filePaths.length === 0) return [];
  const d = getDb(cacheDir);
  const allIds: string[] = [];

  for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
    const batch = filePaths.slice(i, i + CHUNK_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = d.prepare(
      `SELECT qdrant_id FROM indexed_chunks WHERE file_path IN (${placeholders})`
    ).all(...batch) as { qdrant_id: string }[];
    allIds.push(...rows.map(r => r.qdrant_id).filter((id): id is string => id != null));
  }

  return allIds;
}

export function storeChunkQdrantIds(
  cacheDir: string,
  mappings: { chunkId: string; filePath: string; startLine: number; endLine: number; qdrantId: string }[],
): void {
  if (mappings.length === 0) return;
  const d = getDb(cacheDir);
  const insert = d.prepare(
    'INSERT OR REPLACE INTO indexed_chunks (id, file_path, start_line, end_line, qdrant_id) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = d.transaction((rows: typeof mappings) => {
    for (const row of rows) {
      insert.run(row.chunkId, row.filePath, row.startLine, row.endLine, row.qdrantId);
    }
  });
  tx(mappings);
}

export function getMetadata(cacheDir: string, key: string): string | null {
  const d = getDb(cacheDir);
  const row = d.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setMetadata(cacheDir: string, key: string, value: string): void {
  const d = getDb(cacheDir);
  d.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, value);
}

export function getChunkCount(cacheDir: string): number {
  const d = getDb(cacheDir);
  const row = d.prepare('SELECT COUNT(*) as cnt FROM indexed_chunks').get() as { cnt: number };
  return row?.cnt ?? 0;
}

export function getAllChunkByFilePath(cacheDir: string): Map<string, string[]> {
  const d = getDb(cacheDir);
  const rows = d.prepare('SELECT file_path, qdrant_id FROM indexed_chunks').all() as { file_path: string; qdrant_id: string }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const ids = map.get(r.file_path);
    if (ids) ids.push(r.qdrant_id);
    else map.set(r.file_path, [r.qdrant_id]);
  }
  return map;
}

export function getLastIndexedMtime(cacheDir: string): number | null {
  const d = getDb(cacheDir);
  const row = d.prepare('SELECT MAX(mtime) as mtime FROM indexed_files').get() as { mtime: number } | undefined;
  return row?.mtime ?? null;
}

export function clearCache(cacheDir: string): void {
  const d = getDb(cacheDir);
  d.exec('DELETE FROM indexed_files; DELETE FROM indexed_chunks; DELETE FROM metadata;');
  d.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
}

export function getCacheDir(rootDir: string): string {
  return join(rootDir, '.astra', 'cache');
}

export function closeCache(): void {
  for (const conn of databases.values()) {
    conn.close();
  }
  databases.clear();
  resetFlags.clear();
}

export function wasCacheReset(cacheDir: string): boolean {
  getDb(cacheDir);
  const val = resetFlags.get(cacheDir) ?? false;
  if (val) resetFlags.delete(cacheDir);
  return val;
}
