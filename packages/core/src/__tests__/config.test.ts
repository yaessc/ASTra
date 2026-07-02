import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, writeDefaultConfig } from '../config.js';
import { ConfigValidationError } from '../errors.js';

describe('ConfigValidationError', () => {
  const dir = join(tmpdir(), `astra-test-${Date.now()}`);
  const configPath = join(dir, 'astra.config.json');

  beforeEach(() => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ maxChunkSize: 'fifty' }));
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch { /* cleanup: ignore if already absent */ }
    try { rmdirSync(dir); } catch { /* cleanup: ignore if not empty */ }
  });

  it('throws ConfigValidationError when maxChunkSize is a string', () => {
    expect(() => loadConfig(dir)).toThrowError('Config validation failed');
  });

  it('includes maxChunkSize in the error issue path', () => {
    try {
      loadConfig(dir);
      expect.fail('Should have thrown');
    } catch (err) {
      expect((err as ConfigValidationError).issues).toBeDefined();
      expect((err as ConfigValidationError).issues.some((i: { path: string; message: string }) => i.path.includes('maxChunkSize'))).toBe(true);
    }
  });

  it('throws ConfigValidationError when JSON is malformed', () => {
    writeFileSync(configPath, '{ invalid json }');
    expect(() => loadConfig(dir)).toThrow(ConfigValidationError);
  });

  it('rejects chunkOverlap >= linesPerBodyChunk', () => {
    writeFileSync(configPath, JSON.stringify({ chunkOverlap: 100, linesPerBodyChunk: 50 }));
    expect(() => loadConfig(dir)).toThrowError('Config validation failed');
  });
});

describe('writeDefaultConfig', () => {
  const dir = join(tmpdir(), `astra-write-default-${Date.now()}`);

  beforeEach(() => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    const configPath = join(dir, 'astra.config.json');
    try { unlinkSync(configPath); } catch { /* cleanup */ }
    try { rmdirSync(dir); } catch { /* cleanup */ }
  });

  it('writes a valid config file to disk', () => {
    writeDefaultConfig(dir);
    const configPath = join(dir, 'astra.config.json');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('does not overwrite an existing config file', () => {
    const configPath = join(dir, 'astra.config.json');
    writeFileSync(configPath, '{"include":["custom/**/*.ts"],"exclude":[],"qdrantUrl":"http://localhost:6333","collectionName":"test","modelId":"test","maxChunkSize":50,"maxBodyLines":150,"maxBodyChars":4000,"linesPerBodyChunk":100,"chunkOverlap":25}', 'utf-8');
    writeDefaultConfig(dir);
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    expect(config.include).toEqual(['custom/**/*.ts']);
  });

  it('written config can be loaded with loadConfig', () => {
    writeDefaultConfig(dir);
    const config = loadConfig(dir);
    expect(config.include).toBeDefined();
    expect(config.qdrantUrl).toBe('http://localhost:6333');
  });
});
