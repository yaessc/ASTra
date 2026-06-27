import {
  loadConfig, initEmbedder, searchCodebase,
  ensureCollection,
} from '@scs/core';
import { intro, spinner, note, outro, text, isCancel } from '@clack/prompts';
import pico from 'picocolors';

export async function queryCommand(query?: string, options?: { limit?: string }): Promise<void> {
  const config = loadConfig();
  const limit = parseInt(options?.limit || '10', 10);

  intro(pico.cyan('scs query'));

  const s = spinner();

  s.start('Initializing...');
  await initEmbedder(config);
  try {
    await ensureCollection(config);
  } catch {
    s.stop('Warning: Qdrant not reachable');
    note('Make sure Qdrant is running: docker compose up -d', 'Qdrant Required');
    outro('Done');
    return;
  }
  s.stop('Ready');

  if (query) {
    await runSearch(query, limit);
    outro('Done');
    return;
  }

  // Interactive mode
  while (true) {
    const q = await text({
      message: 'Ask a question about the codebase (Ctrl+C to quit):',
      placeholder: 'e.g. Where is the authentication middleware?',
    });

    if (isCancel(q)) {
      outro('Goodbye!');
      break;
    }

    if (!q || q.trim() === '') continue;

    await runSearch(q.trim(), limit);
  }
}

async function runSearch(query: string, limit: number): Promise<void> {
  const config = loadConfig();
  const s = spinner();

  s.start('Searching...');
  const results = await searchCodebase(query, config, limit);
  s.stop(`Found ${results.length} results`);

  if (results.length === 0) {
    note('No results found. Try re-indexing with `scs index`.', 'No matches');
    return;
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const lines = r.code.split('\n');
    const preview = lines.slice(0, 5).join('\n');
    const ellipsis = lines.length > 5 ? '\n  ...' : '';

    console.log('');
    console.log(
      `${pico.cyan(`${i + 1}.`)} ` +
      `${pico.green(r.filePath)}:${pico.yellow(`${r.startLine}`)}-${pico.yellow(`${r.endLine}`)}`
    );
    console.log(`   ${pico.dim(`Score: ${(r.score * 100).toFixed(1)}%`)}`);
    if (preview) {
      console.log(`   ${pico.dim('```')}`);
      console.log(`   ${preview.split('\n').join('\n   ')}${ellipsis}`);
      console.log(`   ${pico.dim('```')}`);
    }
    console.log('');
  }
}
