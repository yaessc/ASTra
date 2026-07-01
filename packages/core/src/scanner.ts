import { readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { globSync } from 'glob';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { AstraConfig, ScannedFile, ScanResult, SupportedLanguage } from './types.js';

export function readFileWithHash(filePath: string): { content: string; hash: string } {
  const content = readFileSync(filePath, 'utf-8');
  const hash = createHash('md5').update(content).digest('hex');
  return { content, hash };
}

const ignore = createRequire(import.meta.url)('ignore') as {
  (options?: { ignorecase?: boolean }): {
    add(patterns: string | readonly string[]): void;
    ignores(pathname: string): boolean;
  };
};

function findGitignore(dir: string): { dir: string; content: string }[] {
  const results: { dir: string; content: string }[] = [];
  let current = dir;
  for (let i = 0; i < 10; i++) {
    try {
      const content = readFileSync(join(current, '.gitignore'), 'utf-8');
      results.push({ dir: current, content });
    } catch { /* no .gitignore in this directory */ }
    const parent = resolve(current, '..');
    if (parent === current) break;
    try {
      if (statSync(join(current, '.git')).isDirectory()) break;
    } catch { /* not the repo root — continue */ }
    current = parent;
  }
  return results;
}

function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.d.ts')) return null;
  if (ext.endsWith('.tsx')) return 'tsx';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.jsx')) return 'javascript';
  if (ext.endsWith('.js')) return 'javascript';
  return null;
}

export function scanFiles(rootDir: string, config: AstraConfig): ScanResult {
  const globalIg = ignore();
  globalIg.add(['node_modules', 'dist', 'build', '.git']);

  const gitignoreEntries = findGitignore(rootDir).map(e => {
    const ig = ignore();
    ig.add(e.content);
    return { ig, dir: e.dir };
  });

  const allFiles = globSync(config.include, {
    cwd: rootDir,
    dot: false,
    absolute: true,
    ignore: config.exclude,
  });

  const files: ScannedFile[] = [];

  for (const filePath of allFiles) {
    try {
      const relPath = relative(rootDir, filePath).replace(/\\/g, '/');
      if (globalIg.ignores(relPath)) continue;

      let ignored = false;
      for (const { ig, dir } of gitignoreEntries) {
        if (ig.ignores(relative(dir, filePath).replace(/\\/g, '/'))) {
          ignored = true;
          break;
        }
      }
      if (ignored) continue;

      const language = detectLanguage(filePath);
      if (!language) continue;

      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      files.push({
        path: filePath,
        relativePath: relPath,
        language,
        mtime: stat.mtimeMs,
      });
    } catch {
      continue;
    }
  }

  return { files };
}
