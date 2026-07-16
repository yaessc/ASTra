import {
  getIndexStats, closeCache,
  QdrantConnectionError,
} from '@astra/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import { resolve } from 'node:path';
import { loadConfigOrExit } from '../utils/config.js';

export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function statusCommand(options?: { dir?: string }): Promise<void> {
  const rootDir = resolve(options?.dir || '.');
  const config = loadConfigOrExit(rootDir, 'status');
  if (!config) return;

  intro(pico.cyan('astra status'));

  const s = spinner();
  s.start('Fetching index stats...');

  try {
    const stats = await getIndexStats(config, rootDir);
    s.stop('Index stats retrieved');

    note(
      `Collection:     ${pico.green(config.collectionName)}
Total files:     ${pico.yellow(String(stats.totalFiles))}
Total chunks:    ${pico.yellow(String(stats.totalChunks))}
${stats.cacheChunkCount !== undefined ? `Cache chunks:    ${pico.yellow(String(stats.cacheChunkCount))}${stats.cacheChunkCount !== stats.totalChunks ? ` ${pico.yellow(pico.dim('⚠ count differs'))}` : ''}\n` : ''}${stats.lastIndexed ? `Last indexed:    ${pico.dim(stats.lastIndexed)}\n` : ''}Vector size:     ${stats.vectorSize !== null ? pico.green(String(stats.vectorSize)) : pico.dim('N/A')} (Cosine)
Qdrant URL:      ${pico.dim(maskUrl(config.qdrantUrl))}
Model:           ${pico.dim(config.modelId)}`,
      pico.cyan('Index Information'),
    );
  } catch (err) {
    s.stop('Error fetching stats');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note(err instanceof Error ? err.message : String(err), 'Error');
    }
    return;
  } finally {
    closeCache();
  }

  outro('Run `astra index` to (re)index your codebase.');
}
