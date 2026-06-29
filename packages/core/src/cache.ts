import Database from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { IndexedFile } from './types.js';

const SCHEMA_VERSION = '4';

let db: Database.Database | null = null;

function getDb(cacheDir: string): Database.Database {
  if (db) return db;

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  db = new Database(join(cacheDir, 'cache.db'));
  db.exec(`
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
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version') as any;
  if (!row || row.value !== SCHEMA_VERSION) {
    db.exec('DELETE FROM indexed_files; DELETE FROM indexed_chunks; DELETE FROM metadata;');
    db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run('schema_version', SCHEMA_VERSION);
  }

  return db;
}

export function getIndexedFile(cacheDir: string, filePath: string): IndexedFile | null {
  const d = getDb(cacheDir);
  const row = d.prepare('SELECT path, mtime, hash FROM indexed_files WHERE path = ?').get(filePath) as any;
  return row ? { path: row.path, mtime: row.mtime, hash: row.hash } : null;
}

export function getAllIndexedFilePaths(cacheDir: string): string[] {
  const d = getDb(cacheDir);
  const rows = d.prepare('SELECT path FROM indexed_files').all() as any[];
  return rows.map(r => r.path);
}

export function setIndexedFile(cacheDir: string, file: IndexedFile): void {
  const d = getDb(cacheDir);
  d.prepare('INSERT OR REPLACE INTO indexed_files (path, mtime, hash) VALUES (?, ?, ?)').run(file.path, file.mtime, file.hash);
}

export function removeIndexedFile(cacheDir: string, filePath: string): void {
  const d = getDb(cacheDir);
  d.prepare('DELETE FROM indexed_files WHERE path = ?').run(filePath);
}

export function removeIndexedChunks(cacheDir: string, filePath: string): void {
  const d = getDb(cacheDir);
  d.prepare('DELETE FROM indexed_chunks WHERE file_path = ?').run(filePath);
}

export function storeChunkQdrantId(cacheDir: string, chunkId: string, filePath: string, startLine: number, endLine: number, qdrantId: string): void {
  const d = getDb(cacheDir);
  d.prepare('INSERT OR REPLACE INTO indexed_chunks (id, file_path, start_line, end_line, qdrant_id) VALUES (?, ?, ?, ?, ?)').run(chunkId, filePath, startLine, endLine, qdrantId);
}

export function getMetadata(cacheDir: string, key: string): string | null {
  const d = getDb(cacheDir);
  const row = d.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function setMetadata(cacheDir: string, key: string, value: string): void {
  const d = getDb(cacheDir);
  d.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, value);
}

export function clearCache(cacheDir: string): void {
  if (db) {
    db.close();
    db = null;
  }
  const d = getDb(cacheDir);
  d.exec('DELETE FROM indexed_files; DELETE FROM indexed_chunks; DELETE FROM metadata;');
}

export function closeCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}
