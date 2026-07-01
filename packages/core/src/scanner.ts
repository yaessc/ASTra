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

function findGitignore(dir: string): string[] {
  const patterns: string[] = [];
  let current = dir;
  for (let i = 0; i < 10; i++) {
    try {
      const gi = join(current, '.gitignore');
      const content = readFileSync(gi, 'utf-8');
      patterns.push(content);
    } catch { /* not a git repo or no .gitignore */ }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return patterns;
}

function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.toLowerCase();
  if (ext.endsWith('.tsx')) return 'tsx';
  if (ext.endsWith('.ts')) return 'typescript';
  if (ext.endsWith('.jsx')) return 'tsx';
  if (ext.endsWith('.js')) return 'javascript';
  return null;
}

export function scanFiles(rootDir: string, config: AstraConfig): ScanResult {
  const ig = ignore();

  const gitignorePatterns = findGitignore(rootDir);
  for (const p of gitignorePatterns) {
    ig.add(p);
  }
  ig.add(['node_modules', 'dist', 'build', '.git']);

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
      if (ig.ignores(relPath)) continue;

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
