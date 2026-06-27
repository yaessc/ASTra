import { loadConfig, resetCollection, clearCache } from '@scs/core';
import { intro, spinner, note, outro, confirm, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function getCacheDir(): string {
  return join(tmpdir(), 'scs-cache');
}

export async function resetCommand(): Promise<void> {
  const config = loadConfig();

  intro(pico.cyan('scs reset'));

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
    note('Run `scs index` to rebuild the index from scratch.', 'Next Step');
  } catch (err) {
    s.stop('Error resetting index');
    note('Could not reset the index. Is Qdrant running?', 'Error');
  }

  outro('Done');
}
