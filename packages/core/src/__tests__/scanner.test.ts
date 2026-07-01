import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFiles, readFileWithHash, findGitignore } from '../scanner.js';
import type { AstraConfig } from '../types.js';

// Access the unexported detectLanguage via the module internals.
// Since it's not exported, we test it indirectly through scanFiles behavior.
// For direct unit tests, we rely on scanFiles filtering as a proxy.

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'scanner-test-'));
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<AstraConfig> = {}): AstraConfig {
  return {
    include: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
    qdrantUrl: 'http://localhost:6333',
    collectionName: 'code_chunks',
    modelId: 'Xenova/all-MiniLM-L6-v2',
    maxChunkSize: 50,
    maxBodyLines: 150,
    maxBodyChars: 4000,
    linesPerBodyChunk: 100,
    chunkOverlap: 25,
    ...overrides,
  };
}

describe('readFileWithHash', () => {
  it('reads file content and returns MD5 hash', () => {
    const filePath = join(fixtureDir, 'test.txt');
    writeFileSync(filePath, 'hello world', 'utf-8');
    const result = readFileWithHash(filePath);
    expect(result.content).toBe('hello world');
    // MD5 of "hello world" is 5eb63bbbe01eeed093cb22bb8f5acdc3
    expect(result.hash).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  it('throws on nonexistent file', () => {
    expect(() => readFileWithHash(join(fixtureDir, 'nonexistent.js'))).toThrow();
  });
});

describe('scanFiles', () => {
  it('scans .ts files matching include patterns', () => {
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(fixtureDir, 'src', 'util.ts'), 'export const b = 2;');

    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts'] }));
    const paths = result.files.map(f => f.relativePath).sort();
    expect(paths).toEqual(['src/index.ts', 'src/util.ts']);
  });

  it('excludes node_modules by default', () => {
    mkdirSync(join(fixtureDir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(fixtureDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};');
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'app.ts'), 'const a = 1;');

    const result = scanFiles(fixtureDir, makeConfig());
    const paths = result.files.map(f => f.relativePath);
    expect(paths).not.toContain('node_modules/pkg/index.js');
    expect(paths).toContain('src/app.ts');
  });

  it('excludes dist and build directories by default', () => {
    mkdirSync(join(fixtureDir, 'dist'), { recursive: true });
    writeFileSync(join(fixtureDir, 'dist', 'output.js'), '// built');
    mkdirSync(join(fixtureDir, 'build'), { recursive: true });
    writeFileSync(join(fixtureDir, 'build', 'bundle.js'), '// bundled');
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'app.ts'), 'const a = 1;');

    const result = scanFiles(fixtureDir, makeConfig());
    const paths = result.files.map(f => f.relativePath);
    expect(paths).not.toContain('dist/output.js');
    expect(paths).not.toContain('build/bundle.js');
    expect(paths).toContain('src/app.ts');
  });

  it('excludes .d.ts files', () => {
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(fixtureDir, 'src', 'types.d.ts'), 'export type A = string;');

    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts', 'src/**/*.d.ts'] }));
    const paths = result.files.map(f => f.relativePath);
    expect(paths).toEqual(['src/index.ts']);
  });

  it('applies config.exclude patterns', () => {
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(fixtureDir, 'src', 'deprecated.ts'), '// old');

    const result = scanFiles(fixtureDir, makeConfig({
      include: ['src/**/*.ts'],
      exclude: ['**/deprecated.ts'],
    }));
    const paths = result.files.map(f => f.relativePath);
    expect(paths).toEqual(['src/index.ts']);
  });

  it('applies .gitignore patterns', () => {
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(fixtureDir, 'src', 'secret.ts'), '// secret');
    writeFileSync(join(fixtureDir, '.gitignore'), 'src/secret.ts\n');

    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts'] }));
    const paths = result.files.map(f => f.relativePath);
    expect(paths).toEqual(['src/index.ts']);
  });

  it('returns empty files array for empty project', () => {
    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts'] }));
    expect(result.files).toEqual([]);
  });

  it('populates mtime as a number', () => {
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'index.ts'), 'export const a = 1;');

    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts'] }));
    expect(result.files.length).toBe(1);
    expect(typeof result.files[0].mtime).toBe('number');
  });

  it('uses forward slashes in relativePath on all platforms', () => {
    mkdirSync(join(fixtureDir, 'src'), { recursive: true });
    writeFileSync(join(fixtureDir, 'src', 'index.ts'), 'export const a = 1;');

    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts'] }));
    expect(result.files[0].relativePath).not.toContain('\\');
    expect(result.files[0].relativePath).toContain('/');
  });

  it('sets language field correctly', () => {
    mkdirSync(join(fixtureDir, 'src'));
    writeFileSync(join(fixtureDir, 'src', 'app.ts'), 'const a = 1;');
    writeFileSync(join(fixtureDir, 'src', 'app.tsx'), '<div />;');
    writeFileSync(join(fixtureDir, 'src', 'app.js'), 'const a = 1;');

    const result = scanFiles(fixtureDir, makeConfig({ include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js'] }));
    const langMap: Record<string, string> = {};
    for (const f of result.files) {
      langMap[f.relativePath] = f.language;
    }
    expect(langMap['src/app.ts']).toBe('typescript');
    expect(langMap['src/app.tsx']).toBe('tsx');
    expect(langMap['src/app.js']).toBe('javascript');
  });
});

describe('findGitignore', () => {
  it('finds .gitignore in the target directory', () => {
    writeFileSync(join(fixtureDir, '.gitignore'), 'node_modules\n');
    const results = findGitignore(fixtureDir);
    expect(results.length).toBe(1);
    expect(results[0].dir).toBe(fixtureDir);
    expect(results[0].content).toContain('node_modules');
  });

  it('walks up to parent directories to find .gitignore', () => {
    const subDir = join(fixtureDir, 'a', 'b', 'c');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(fixtureDir, '.gitignore'), 'dist\n');
    const results = findGitignore(subDir);
    expect(results.length).toBe(1);
    expect(results[0].dir).toBe(fixtureDir);
  });

  it('stops walking at a .git/ boundary', () => {
    const inner = join(fixtureDir, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, '.gitignore'), 'inner-only\n');
    mkdirSync(join(inner, '.git'));
    writeFileSync(join(fixtureDir, '.gitignore'), 'root\n');
    const results = findGitignore(inner);
    expect(results.some(r => r.dir === fixtureDir)).toBe(false);
    expect(results.some(r => r.dir === inner)).toBe(true);
  });

  it('returns empty array when no .gitignore exists', () => {
    const results = findGitignore(fixtureDir);
    expect(results).toEqual([]);
  });

  it('returns multiple entries when .gitignore exists at multiple levels', () => {
    const subDir = join(fixtureDir, 'sub');
    mkdirSync(subDir);
    writeFileSync(join(fixtureDir, '.gitignore'), 'root\n');
    writeFileSync(join(subDir, '.gitignore'), 'sub\n');
    const results = findGitignore(subDir);
    expect(results.length).toBe(2);
    expect(results.some(r => r.dir === fixtureDir)).toBe(true);
    expect(results.some(r => r.dir === subDir)).toBe(true);
  });

  it('stops at filesystem root when no .git/ marker exists', () => {
    const deep = join(fixtureDir, 'x', 'y', 'z');
    mkdirSync(deep, { recursive: true });
    const results = findGitignore(deep);
    expect(Array.isArray(results)).toBe(true);
  });
});
