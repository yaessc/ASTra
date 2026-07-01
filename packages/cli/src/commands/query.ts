import {
  loadConfig, initEmbedder, searchHybrid,
  ensureCollection, ConfigValidationError, QdrantConnectionError,
  type SearchMode, type AstraConfig,
} from '@astra/core';
import { intro, spinner, note, outro, text, select, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { resolve, join } from 'node:path';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createEmphasize, common } from 'emphasize';
import { ProgressBarManager } from '../utils/progress.js';

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
  const pct = r.score * 100;
  let tier: string;
  if (pct >= 85) tier = pico.green(pico.dim(' excellent'));
  else if (pct >= 70) tier = pico.yellow(pico.dim(' good'));
  else tier = pico.red(pico.dim(' weak'));
  console.log(`   ${pico.dim(`Score: ${pct.toFixed(1)}%`)}${tier}`);
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

async function openInEditor(filePath: string, line: number, rootDir: string): Promise<void> {
  const fullPath = join(rootDir, filePath);
  try {
    await execAsync(`code -g "${fullPath}:${line}"`);
    return;
  } catch {
    // VSCode not available — fall through
  }

  const editor = process.env.EDITOR;
  if (editor) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(`"${editor}" "${fullPath}" +${line}`, [], {
          stdio: 'inherit',
          shell: true,
        });
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Editor exited with code ${code}`));
        });
        child.on('error', reject);
      });
      return;
    } catch {
      note(`Could not open with EDITOR="${editor}". File: ${fullPath}:${line}`, 'Open Failed');
      return;
    }
  }

  try {
    if (process.platform === 'win32') {
      await execAsync(`start "" "${fullPath}"`);
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${fullPath}"`);
    } else {
      await execAsync(`xdg-open "${fullPath}"`);
    }
  } catch {
    note(`Could not open editor. File: ${fullPath}:${line}`, 'Open Failed');
  }
}

async function runSearch(query: string, limit: number, mode: SearchMode, config: AstraConfig): Promise<any[]> {
  const s = spinner();

  s.start('Searching...');
  const results = await searchHybrid(query, config, limit, { mode });
  s.stop(`Found ${results.length} results`);

  if (results.length === 0) {
    note(`No results for "${query}". Try: astra index to rebuild, or rephrase with more specific terms.`, 'No matches');
    return results;
  }

  console.log('');
  console.log(`  ${pico.bold(pico.cyan(`Found ${results.length} results for "${query}"`))}`);
  console.log('');

  for (let i = 0; i < results.length; i++) {
    displayResult(results[i], i);
  }

  return results;
}

async function postSearchMenu(results: any[], rootDir: string): Promise<'search' | 'exit'> {
  console.log(`\n  ${pico.dim('─'.repeat(60))}`);

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
      await openInEditor(r.filePath, r.startLine, rootDir);
    }
  }

  return 'search';
}

async function handleReplCommand(cmd: string): Promise<{ limit?: number; mode?: SearchMode } | -1 | null> {
  switch (true) {
    case cmd === ':help':
      console.log(`
  ${pico.bold('REPL Commands')}
  ${pico.cyan(':help')}     Show this help
  ${pico.cyan(':clear')}    Clear the screen
  ${pico.cyan(':limit N')}  Set result limit (e.g. :limit 5)
  ${pico.cyan(':mode M')}   Set search mode: vector | keyword | hybrid
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

    case cmd.startsWith(':limit '): {
      const n = parseInt(cmd.slice(7).trim(), 10);
      if (isNaN(n) || n < 1) {
        console.log(`  ${pico.yellow('Usage:')} :limit <number>`);
        return null;
      }
      console.log(`  ${pico.green(`Limit set to ${n}`)}`);
      return { limit: n };
    }

    case cmd.startsWith(':mode '): {
      const m = cmd.slice(6).trim().toLowerCase();
      if (m !== 'vector' && m !== 'keyword' && m !== 'hybrid') {
        console.log(`  ${pico.yellow('Usage:')} :mode vector | keyword | hybrid`);
        return null;
      }
      console.log(`  ${pico.green(`Mode set to ${m}`)}`);
      return { mode: m as SearchMode };
    }

    default:
      console.log(`  ${pico.yellow('Unknown command:')} ${cmd}. Type ${pico.cyan(':help')} for available commands.`);
      return null;
  }
}

export async function queryCommand(query?: string, options?: { limit?: string; mode?: string; dir?: string }): Promise<void> {
  const rootDir = resolve(options?.dir || '.');
  let config;
  try {
    config = loadConfig(rootDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('astra query'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix astra.config.json and re-run.');
      return;
    }
    throw err;
  }

  let limit = parseInt(options?.limit || '10', 10);

  intro(pico.cyan('astra query'));

  const s = spinner();
  s.start('Initializing...');

  const modelBar = new ProgressBarManager();
  let lastFile = '';
  const DOWNLOAD_FMT = `${pico.cyan('Downloading')} ${pico.dim('{file}')} |{bar}| ${pico.green('{percentage}%')} {loadedMb}/{totalMb} MB`;

  try {
    await initEmbedder(config, (progress: any) => {
      if (progress.status === 'initiate') {
        lastFile = progress.file || '';
        if (!modelBar.isRunning) {
          modelBar.start(DOWNLOAD_FMT, 100, 0, { file: lastFile, loadedMb: '0.0', totalMb: '0.0' });
        }
      }
      if (progress.status === 'progress' && modelBar.isRunning) {
        const totalMb = (progress.total / 1024 / 1024).toFixed(1);
        const loadedMb = (progress.loaded / 1024 / 1024).toFixed(1);
        modelBar.update(progress.progress ?? 0, { file: lastFile, loadedMb, totalMb });
      }
      if (progress.status === 'done' || progress.status === 'ready') {
        modelBar.stop();
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
    modelBar.stop();
    s.stop('Initialization failed');
    note(err instanceof Error ? err.message : String(err), 'Error');
    outro('Done');
    return;
  }

  let mode = (options?.mode || 'hybrid') as SearchMode;

  if (query) {
    queryHistory.push(query);
    const results = await runSearch(query, limit, mode, config);
    if (results.length > 0) {
      await postSearchMenu(results, rootDir);
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
      const result = await handleReplCommand(trimmed);
      if (result === -1) {
        outro('Goodbye!');
        break;
      }
      if (result !== null) {
        if (result.limit !== undefined) limit = result.limit;
        if (result.mode !== undefined) mode = result.mode;
      }
      continue;
    }

    console.log(`  ${pico.dim(pico.cyan('›'))} ${pico.dim(trimmed)}`);
    queryHistory.push(trimmed);
    const results = await runSearch(trimmed, limit, mode, config);
    if (results.length > 0) {
      const next = await postSearchMenu(results, rootDir);
      if (next === 'exit') {
        outro('Goodbye!');
        break;
      }
    }
  }
}
