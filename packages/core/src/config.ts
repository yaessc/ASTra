import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ScsConfig } from './types.js';

const DEFAULT_CONFIG: ScsConfig = {
  include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx'],
  exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
  qdrantUrl: 'http://localhost:6333',
  collectionName: 'code_chunks',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  maxChunkSize: 50,
};

export function loadConfig(dir?: string): ScsConfig {
  const configDir = dir || process.cwd();
  const configPath = join(configDir, 'scs.config.json');

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const user = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...user } as ScsConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeDefaultConfig(dir: string): void {
  const configPath = join(dir, 'scs.config.json');
  if (existsSync(configPath)) return;
  writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
}
