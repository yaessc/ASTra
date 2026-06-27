import { loadConfig, getIndexStats } from '@scs/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';

export async function statusCommand(): Promise<void> {
  const config = loadConfig();

  intro(pico.cyan('scs status'));

  const s = spinner();
  s.start('Fetching index stats...');

  try {
    const stats = await getIndexStats(config);
    s.stop('Index stats retrieved');

    note(
      `Collection:  ${pico.green(config.collectionName)}
Total chunks: ${pico.yellow(String(stats.totalChunks))}
Vector size:  384 (Cosine)
Qdrant URL:   ${pico.dim(config.qdrantUrl)}
Model:        ${pico.dim(config.modelId)}`,
      pico.cyan('Index Information'),
    );
  } catch (err) {
    s.stop('Error fetching stats');
    note('Could not connect to Qdrant. Is it running?', 'Error');
  }

  outro('Run `scs index` to (re)index your codebase.');
}
