import {
  initEmbedder, searchHybrid,
  ensureCollection, QdrantConnectionError,
  type SearchMode, type AstraConfig, type SearchResult,
} from '@astra/core';
import { intro, spinner, note, outro, text, select, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { initModelWithProgress } from '../utils/progress.js';
import { loadConfigOrExit } from '../utils/config.js';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createEmphasize, common } from 'emphasize';

const emph = createEmphasize(common);

const LANG_MAP: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  tsx: 'typescript',
};

const queryHistory: string[] = [];
const MAX_HISTORY = 100;

function pushHistory(entry: string): void {
  queryHistory.push(entry);
  if (queryHistory.length > MAX_HISTORY) {
    queryHistory.splice(0, queryHistory.length - MAX_HISTORY);
  }
}

const KNOWN_REPL = /^:/;

function formatCode(code: string, language: string): string {
  try {
    const lang = LANG_MAP[language] || 'typescript';
    return emph.highlight(lang, code).value;
  } catch {
    return code;
  }
}

function displayResult(r: SearchResult, index: number): void {
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

function parseEditorCmd(s: string): { cmd: string; args: string[] } {
  const args: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else cur += c;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i];
      else cur += c;
    } else if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === ' ' || c === '\t') {
      if (cur) { args.push(cur); cur = ''; }
    }
    else if (c === '\\' && (s[i + 1] === ' ' || s[i + 1] === '"' || s[i + 1] === "'" || s[i + 1] === '\\')) cur += s[++i];
    else cur += c;
  }
  if (cur) args.push(cur);
  return { cmd: args[0] ?? '', args: args.slice(1) };
}

function spawnAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd}" exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function openInEditor(filePath: string, line: number, rootDir: string): Promise<void> {
  const fullPath = join(rootDir, filePath);
  const attempts: string[] = [];

  const editor = process.env.EDITOR;
  if (editor) {
    try {
      const { cmd, args } = parseEditorCmd(editor);
      await spawnAsync(cmd, [...args, fullPath, `+${line}`]);
      return;
    } catch {
      attempts.push(`EDITOR="${editor}"`);
    }
  }

  try {
    await spawnAsync('code', ['-g', `${fullPath}:${line}`]);
    return;
  } catch {
    attempts.push('VSCode (code)');
  }

  try {
    if (process.platform === 'win32') {
      await spawnAsync('cmd', ['/c', 'start', '', fullPath]);
    } else if (process.platform === 'darwin') {
      await spawnAsync('open', [fullPath]);
    } else {
      await spawnAsync('xdg-open', [fullPath]);
    }
    return;
  } catch {
    const platform = process.platform === 'win32' ? 'start'
      : process.platform === 'darwin' ? 'open'
      : 'xdg-open';
    attempts.push(platform);
  }

  note(
    `Could not open file. Tried: ${attempts.join(', ')}.\nFile: ${fullPath}:${line}`,
    'Open Failed',
  );
}

async function runSearch(query: string, limit: number, mode: SearchMode, config: AstraConfig): Promise<SearchResult[]> {
  const s = spinner();

  s.start('Searching...');
  let results;
  try {
    results = await searchHybrid(query, config, limit, { mode });
  } catch (err) {
    s.stop('Search failed');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Connection Error');
    } else {
      note(err instanceof Error ? err.message : String(err), 'Search Error');
    }
    return [];
  }
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

async function postSearchMenu(results: SearchResult[], rootDir: string): Promise<'search' | 'exit'> {
  while (true) {
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
      const choices = results.map((r: SearchResult, i: number) => ({
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
  }
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
  const config = loadConfigOrExit(rootDir, 'query');
  if (!config) return;

  intro(pico.cyan('astra query'));

  let limit = parseInt(options?.limit || '10', 10);
  if (isNaN(limit) || limit < 1) {
    note(`Invalid limit "${options?.limit}". Must be a positive number.`, 'Invalid Option');
    outro('Done');
    return;
  }

  const VALID_MODES = ['vector', 'keyword', 'hybrid'] as const;
  const modeRaw = options?.mode || 'hybrid';
  if (!VALID_MODES.includes(modeRaw as (typeof VALID_MODES)[number])) {
    note(`Invalid mode "${options?.mode}". Must be one of: ${VALID_MODES.join(', ')}`, 'Invalid Option');
    outro('Done');
    return;
  }

  const s = spinner();
  s.start('Initializing...');

  try {
    await initModelWithProgress(config, initEmbedder);

    const warnings: string[] = [];
    await ensureCollection(config, (msg) => { warnings.push(msg); });
    s.stop('Ready');
    for (const w of warnings) {
      note(w, 'Warning');
    }
  } catch (err) {
    s.stop('Initialization failed');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note(err instanceof Error ? err.message : String(err), 'Error');
    }
    outro('Done');
    return;
  }

  let mode = modeRaw as SearchMode;

  if (query) {
    pushHistory(query);
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

    if (KNOWN_REPL.test(trimmed)) {
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
    pushHistory(trimmed);
    try {
      const results = await runSearch(trimmed, limit, mode, config);
      if (results.length > 0) {
        const next = await postSearchMenu(results, rootDir);
        if (next === 'exit') {
          outro('Goodbye!');
          break;
        }
      }
    } catch (err) {
      note(err instanceof Error ? err.message : String(err), 'Unexpected Error');
    }
  }
}
