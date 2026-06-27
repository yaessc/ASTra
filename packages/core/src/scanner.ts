import { readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { globSync } from 'glob';
import { createHash } from 'node:crypto';
import type { AstraConfig, ScannedFile, ScanResult, SupportedLanguage } from './types.js';

class GitIgnoreMatcher {
  private patterns: string[] = [];

  add(patterns: string[]): void {
    for (const p of patterns) {
      this.patterns.push(...p.split('\n').filter(l => {
        const trimmed = l.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#');
      }));
    }
  }

  ignores(path: string): boolean {
    const normalized = path.replace(/\\/g, '/');
    for (const p of this.patterns) {
      if (this.matchPattern(normalized, p.trim())) return true;
    }
    return false;
  }

  private matchPattern(path: string, pattern: string): boolean {
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
      if (path === pattern || path.startsWith(pattern + '/')) return true;
    } else if (pattern.endsWith('/')) {
      if (path.includes(pattern) || path.startsWith(pattern) || path.includes('/' + pattern)) return true;
    } else if (pattern.includes('*')) {
      const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$';
      try {
        return new RegExp(regexStr).test(path);
      } catch { return false; }
    } else if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      if (path.endsWith(ext)) return true;
    } else {
      if (path === pattern) return true;
      if (path.includes('/' + pattern)) return true;
      if (path.startsWith(pattern + '/')) return true;
    }
    return false;
  }
}

function findGitignore(dir: string): string[] {
  const patterns: string[] = [];
  let current = dir;
  for (let i = 0; i < 10; i++) {
    try {
      const gi = join(current, '.gitignore');
      const content = readFileSync(gi, 'utf-8');
      patterns.push(content);
    } catch {}
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
  const ig = new GitIgnoreMatcher();

  const gitignorePatterns = findGitignore(rootDir);
  for (const p of gitignorePatterns) {
    ig.add([p]);
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
      const relPath = relative(rootDir, filePath);
      if (ig.ignores(relPath)) continue;

      const language = detectLanguage(filePath);
      if (!language) continue;

      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      const content = readFileSync(filePath, 'utf-8');
      const hash = createHash('md5').update(content).digest('hex');

      files.push({
        path: filePath,
        relativePath: relPath,
        language,
        content,
        mtime: stat.mtimeMs,
        hash,
      });
    } catch {
      continue;
    }
  }

  return { files };
}
