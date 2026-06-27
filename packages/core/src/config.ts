import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ConfigValidationError } from './errors.js';
import type { ScsConfig } from './types.js';

const ScsConfigSchema = z.object({
  include: z.array(z.string()).default(['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx']),
  exclude: z.array(z.string()).default(['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts']),
  qdrantUrl: z.string().min(1, 'Must be a URL like http://localhost:6333').default('http://localhost:6333'),
  collectionName: z.string().min(1, 'Collection name cannot be empty').default('code_chunks'),
  modelId: z.string().min(1, 'Model ID cannot be empty').default('Xenova/all-MiniLM-L6-v2'),
  // maxChunkSize is a legacy fallback for files where no AST entities are found.
  // With the dual-chunk strategy, each entity produces its own body chunk(s)
  // split at 150 lines / 4000 chars. This field only applies to the
  // zero-entities fallback path and may be removed in a future version.
  maxChunkSize: z.number().int().positive('Must be a positive number').default(50),
});

export function loadConfig(dir?: string): ScsConfig {
  const configDir = dir || process.cwd();
  const configPath = join(configDir, 'scs.config.json');

  if (!existsSync(configPath)) {
    return ScsConfigSchema.parse({});
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const user = JSON.parse(raw);
    const result = ScsConfigSchema.parse(user);
    return result as ScsConfig;
  } catch (err) {
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
  const configPath = join(dir, 'scs.config.json');
  if (existsSync(configPath)) return;
  const defaults = ScsConfigSchema.parse({}) as ScsConfig;
  writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
}
