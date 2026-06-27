import {
  loadConfig, getIndexStats,
  ConfigValidationError, QdrantConnectionError,
} from '@scs/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';

export async function statusCommand(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('scs status'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix scs.config.json and re-run.');
      return;
    }
    throw err;
  }

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
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note('Could not connect to Qdrant. Is it running?', 'Error');
    }
  }

  outro('Run `scs index` to (re)index your codebase.');
}
