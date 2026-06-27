import {
  loadConfig, initEmbedder, searchCodebase,
  ensureCollection, ConfigValidationError, QdrantConnectionError,
} from '@scs/core';
import { intro, spinner, note, outro, text, select, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createEmphasize, common } from 'emphasize';
import cliProgress from 'cli-progress';

const execAsync = promisify(exec);
const emph = createEmphasize(common);

const LANG_MAP: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  tsx: 'typescript',
};

const queryHistory: string[] = [];

function formatCode(code: string, language: string): string {
  try {
    const lang = LANG_MAP[language] || 'typescript';
    return emph.highlight(lang, code).value;
  } catch {
    return code;
  }
}

function displayResult(r: { filePath: string; startLine: number; endLine: number; score: number; code: string; language: string }, index: number): void {
  const lines = r.code.split('\n');
  const maxLines = 30;
  const displayLines = lines.slice(0, maxLines);
  const moreLines = lines.length > maxLines;
  const lineNumWidth = String(r.endLine).length;

  console.log('');
  console.log(
    `${pico.cyan(`${index + 1}.`)} ` +
    `${pico.green(r.filePath)}:${pico.yellow(String(r.startLine))}-${pico.yellow(String(r.endLine))}`
  );
  console.log(`   ${pico.dim(`Score: ${(r.score * 100).toFixed(1)}%`)}`);
  console.log(`   ${pico.dim('┌' + '─'.repeat(50))}`);

  const highlighted = formatCode(displayLines.join('\n'), r.language);
  const hlLines = highlighted.split('\n');

  for (let i = 0; i < hlLines.length; i++) {
    const lineNum = String(r.startLine + i).padStart(lineNumWidth);
    console.log(` ${pico.dim(lineNum)} ${pico.dim('│')} ${hlLines[i]}`);
  }

  if (moreLines) {
    console.log(` ${' '.repeat(lineNumWidth)} ${pico.dim('│')} ${pico.dim(`... ${lines.length - maxLines} more lines`)}`);
  }
  console.log(` ${' '.repeat(lineNumWidth)} ${pico.dim('└' + '─'.repeat(50))}`);
}

async function openInEditor(filePath: string, line: number): Promise<void> {
  try {
    await execAsync(`code -g "${filePath}:${line}"`);
  } catch {
    try {
      const editor = process.env.EDITOR || 'vim';
      await execAsync(`${editor} "${filePath}" +${line}`);
    } catch (e) {
      note(`Could not open editor. File: ${filePath}:${line}`, 'Open Failed');
    }
  }
}

async function runSearch(query: string, limit: number): Promise<any[]> {
  const config = loadConfig();
  const s = spinner();

  s.start('Searching...');
  const results = await searchCodebase(query, config, limit);
  s.stop(`Found ${results.length} results`);

  if (results.length === 0) {
    note('No results found. Try re-indexing with `scs index`.', 'No matches');
    return results;
  }

  for (let i = 0; i < results.length; i++) {
    displayResult(results[i], i);
  }

  return results;
}

async function postSearchMenu(results: any[]): Promise<'search' | 'exit'> {
  const action = await select({
    message: 'What next?',
    options: [
      { value: 'open', label: 'Open in editor' },
      { value: 'search', label: 'Search again' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (isCancel(action) || action === 'exit') return 'exit';
  if (action === 'search') return 'search';

  if (action === 'open') {
    const choices = results.map((r: any, i: number) => ({
      value: i,
      label: `${r.filePath}:${r.startLine}-${r.endLine} (${(r.score * 100).toFixed(0)}%)`,
    }));

    const selected = await select({
      message: 'Which result to open?',
      options: choices,
    });

    if (!isCancel(selected)) {
      const r = results[selected as number];
      await openInEditor(r.filePath, r.startLine);
    }
  }

  return 'search';
}

async function handleReplCommand(cmd: string, currentLimit: number): Promise<number | null> {
  switch (true) {
    case cmd === ':help':
      console.log(`
  ${pico.bold('REPL Commands')}
  ${pico.cyan(':help')}     Show this help
  ${pico.cyan(':clear')}    Clear the screen
  ${pico.cyan(':limit N')}  Set result limit (e.g. :limit 5)
  ${pico.cyan(':history')}  Show query history
  ${pico.cyan(':exit')}     Exit

  ${pico.dim('Or just type a query to search.')}
      `);
      return null;

    case cmd === ':clear':
      console.clear();
      return null;

    case cmd === ':history':
      if (queryHistory.length === 0) {
        console.log(`  ${pico.dim('No queries yet.')}`);
      } else {
        console.log(`\n  ${pico.bold('Query History')}`);
        for (let i = 0; i < queryHistory.length; i++) {
          console.log(`  ${pico.cyan(`${i + 1}.`)} ${queryHistory[i]}`);
        }
        console.log('');
      }
      return null;

    case cmd === ':exit':
      return -1;

    case cmd.startsWith(':limit '):
      const n = parseInt(cmd.slice(7).trim(), 10);
      if (isNaN(n) || n < 1) {
        console.log(`  ${pico.yellow('Usage:')} :limit <number>`);
        return null;
      }
      console.log(`  ${pico.green(`Limit set to ${n}`)}`);
      return n;

    default:
      console.log(`  ${pico.yellow('Unknown command:')} ${cmd}. Type ${pico.cyan(':help')} for available commands.`);
      return null;
  }
}

export async function queryCommand(query?: string, options?: { limit?: string }): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('scs query'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix scs.config.json and re-run.');
      return;
    }
    throw err;
  }

  let limit = parseInt(options?.limit || '10', 10);

  intro(pico.cyan('scs query'));

  const s = spinner();
  s.start('Initializing...');

  let modelBar: any = null;
  let lastFile = '';

  try {
    await initEmbedder(config, (progress: any) => {
      if (progress.status === 'initiate') {
        lastFile = progress.file || '';
        if (!modelBar) {
          modelBar = new cliProgress.SingleBar({
            format: `${pico.cyan('Downloading')} ${pico.dim('{file}')} |{bar}| ${pico.green('{percentage}%')} {loadedMb}/{totalMb} MB`,
            barCompleteChar: '█',
            barIncompleteChar: '░',
            hideCursor: true,
            clearOnComplete: true,
          });
          modelBar.start(100, 0, { file: lastFile, loadedMb: '0.0', totalMb: '0.0' });
        }
      }
      if (progress.status === 'progress' && modelBar) {
        const totalMb = (progress.total / 1024 / 1024).toFixed(1);
        const loadedMb = (progress.loaded / 1024 / 1024).toFixed(1);
        modelBar.update(progress.progress ?? 0, { file: lastFile, loadedMb, totalMb });
      }
      if (progress.status === 'done' || progress.status === 'ready') {
        if (modelBar) {
          modelBar.stop();
          modelBar = null;
        }
      }
    });

    try {
      await ensureCollection(config);
    } catch (err) {
      if (err instanceof QdrantConnectionError) {
        s.stop('Qdrant not reachable');
        note(err.message, 'Qdrant Error');
        outro('Done');
        return;
      }
      throw err;
    }

    s.stop('Ready');
  } catch (err) {
    (modelBar as cliProgress.SingleBar | null)?.stop();
    modelBar = null;
    s.stop('Initialization failed');
    note(err instanceof Error ? err.message : String(err), 'Error');
    outro('Done');
    return;
  }

  if (query) {
    queryHistory.push(query);
    const results = await runSearch(query, limit);
    if (results.length > 0) {
      await postSearchMenu(results);
    }
    outro('Done');
    return;
  }

  console.log(`  ${pico.dim('Type :help for REPL commands. Ctrl+C to quit.')}`);

  while (true) {
    const q = await text({
      message: 'What are you looking for?',
      placeholder: 'e.g. Where is the authentication middleware?',
    });

    if (isCancel(q)) {
      outro('Goodbye!');
      break;
    }

    if (!q || q.trim() === '') continue;

    const trimmed = q.trim();

    if (trimmed.startsWith(':')) {
      const result = await handleReplCommand(trimmed, limit);
      if (result === -1) {
        outro('Goodbye!');
        break;
      }
      if (result !== null) {
        limit = result;
      }
      continue;
    }

    queryHistory.push(trimmed);
    const results = await runSearch(trimmed, limit);
    if (results.length > 0) {
      const next = await postSearchMenu(results);
      if (next === 'exit') {
        outro('Goodbye!');
        break;
      }
    }
  }
}
