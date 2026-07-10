import {
  resetCollection, clearCache, getCacheDir, closeCache,
  QdrantConnectionError,
} from '@astra/core';
import { intro, spinner, note, outro, confirm, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { resolve } from 'node:path';
import { loadConfigOrExit } from '../utils/config.js';

export async function resetCommand(options?: { dir?: string }): Promise<void> {
  const rootDir = resolve(options?.dir || '.');
  const config = loadConfigOrExit(rootDir, 'reset');
  if (!config) return;

  intro(pico.cyan('astra reset'));

  const proceed = await confirm({
    message: 'This will delete the entire index. Continue?',
  });

  if (isCancel(proceed) || !proceed) {
    outro('Cancelled');
    return;
  }

  const s = spinner();
  s.start('Resetting index...');

  try {
    await resetCollection(config);
    clearCache(getCacheDir(rootDir));
    s.stop('Index reset complete');
    note('Run `astra index` to rebuild the index from scratch.', 'Next Step');
  } catch (err) {
    s.stop('Error resetting index');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note(err instanceof Error ? err.message : String(err), 'Error');
    }
    return;
  } finally {
    closeCache();
  }

  outro('Done');
}
