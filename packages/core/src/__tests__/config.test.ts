import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../config.js';

describe('ConfigValidationError', () => {
  const dir = join(tmpdir(), `astra-test-${Date.now()}`);
  const configPath = join(dir, 'astra.config.json');

  beforeEach(() => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ maxChunkSize: 'fifty' }));
  });

  afterEach(() => {
    try { unlinkSync(configPath); } catch {}
    try { rmdirSync(dir); } catch {}
  });

  it('throws ConfigValidationError when maxChunkSize is a string', () => {
    expect(() => loadConfig(dir)).toThrowError('Config validation failed');
  });

  it('includes maxChunkSize in the error issue path', () => {
    try {
      loadConfig(dir);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.issues).toBeDefined();
      expect(err.issues.some((i: any) => i.path.includes('maxChunkSize'))).toBe(true);
    }
  });
});
