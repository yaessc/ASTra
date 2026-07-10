import {
  loadConfig, getIndexStats, closeCache,
  ConfigValidationError, QdrantConnectionError,
} from '@astra/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import { resolve } from 'node:path';

export async function statusCommand(options?: { dir?: string }): Promise<void> {
  const rootDir = resolve(options?.dir || '.');
  let config;
  try {
    config = loadConfig(rootDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('astra status'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix astra.config.json and re-run.');
      return;
    }
    throw err;
  }

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
Qdrant URL:      ${pico.dim(config.qdrantUrl)}
Model:           ${pico.dim(config.modelId)}`,
      pico.cyan('Index Information'),
    );
  } catch (err) {
    s.stop('Error fetching stats');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note('Could not connect to Qdrant. Is it running?', 'Error');
    }
    return;
  } finally {
    closeCache();
  }

  outro('Run `astra index` to (re)index your codebase.');
}
