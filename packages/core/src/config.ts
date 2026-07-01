import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigValidationError } from './errors.js';
import type { AstraConfig } from './types.js';

const AstraConfigSchema = z.object({
  include: z.array(z.string()).default(['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx']),
  exclude: z.array(z.string()).default(['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts']),
  qdrantUrl: z.string().url('Must be a valid URL starting with http:// or https://').default('http://localhost:6333'),
  collectionName: z.string().min(1, 'Collection name cannot be empty').default('code_chunks'),
  modelId: z.string().min(1, 'Model ID cannot be empty').default('Xenova/all-MiniLM-L6-v2'),
  // maxChunkSize controls the line window for files with zero AST entities
  // and for uncovered (inter-entity) lines. For files with entities, the
  // entity-body chunking is governed by maxBodyLines, maxBodyChars,
  // linesPerBodyChunk, and chunkOverlap below.
  maxChunkSize: z.number().int().positive('Must be a positive number').default(50),
  maxBodyLines: z.number().int().positive('Must be a positive number').default(150),
  maxBodyChars: z.number().int().positive('Must be a positive number').default(4000),
  linesPerBodyChunk: z.number().int().positive('Must be a positive number').default(100),
  chunkOverlap: z.number().int().min(0).default(25),
});

export function loadConfig(dir?: string): AstraConfig {
  const configDir = dir || process.cwd();
  const configPath = join(configDir, 'astra.config.json');

  if (!existsSync(configPath)) {
    return AstraConfigSchema.parse({});
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const user = JSON.parse(raw);
    const result = AstraConfigSchema.parse(user);
    return result as AstraConfig;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ConfigValidationError([{
        path: 'astra.config.json',
        message: `Invalid JSON: ${err.message}`,
      }]);
    }
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => ({
        path: i.path.join('.'),
        message: `${i.path.join('.')}: ${i.message}`,
      }));
      throw new ConfigValidationError(issues);
    }
    throw err;
  }
}

export function writeDefaultConfig(dir: string): void {
  const configPath = join(dir, 'astra.config.json');
  if (existsSync(configPath)) return;
  const defaults = AstraConfigSchema.parse({}) as AstraConfig;
  writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
}
