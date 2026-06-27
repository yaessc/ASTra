import {
  loadConfig, resetCollection, clearCache,
  ConfigValidationError, QdrantConnectionError,
} from '@astra/core';
import { intro, spinner, note, outro, confirm, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function getCacheDir(): string {
  return join(tmpdir(), 'astra-cache');
}

export async function resetCommand(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('astra reset'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix astra.config.json and re-run.');
      return;
    }
    throw err;
  }

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
    clearCache(getCacheDir());
    s.stop('Index reset complete');
    note('Run `astra index` to rebuild the index from scratch.', 'Next Step');
  } catch (err) {
    s.stop('Error resetting index');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note('Could not reset the index. Is Qdrant running?', 'Error');
    }
  }

  outro('Done');
}
