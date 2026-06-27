import { resolve } from 'node:path';
import {
  loadConfig, scanFiles, initLanguages, extractEntities,
  chunkEntities, initEmbedder, indexChunks, setIndexedFile,
  getIndexedFile, removeIndexedChunks, deleteFileChunks,
} from '@scs/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cliProgress from 'cli-progress';

function getCacheDir(): string {
  return join(tmpdir(), 'scs-cache');
}

export async function indexCommand(dir: string = '.', options?: { watch?: boolean }): Promise<void> {
  const rootDir = resolve(dir || '.');
  const config = loadConfig(rootDir);

  intro(pico.cyan('scs index'));

  const s = spinner();

  s.start('Initializing languages...');
  await initLanguages();
  s.stop('Languages initialized');

  s.start('Initializing embedding model...');
  await initEmbedder(config);
  s.stop('Embedding model ready');

  s.start('Scanning files...');
  const { files } = scanFiles(rootDir, config);
  s.stop(`Found ${files.length} files`);

  if (files.length === 0) {
    note('No TypeScript/JavaScript files found. Check your scs.config.json include patterns.', 'Nothing to index');
    outro('Done');
    return;
  }

  const cacheDir = getCacheDir();

  const changedFiles = files.filter(f => {
    const cached = getIndexedFile(cacheDir, f.path);
    return !cached || cached.hash !== f.hash;
  });

  if (changedFiles.length === 0) {
    note('All files are up to date.', 'Index is current');
    outro('Done');
    return;
  }

  s.start(`Parsing ${changedFiles.length} files...`);

  // Phase 1: Parse all files and compute chunks upfront
  const allChunks: { file: typeof changedFiles[0]; chunks: any[] }[] = [];

  for (const file of changedFiles) {
    try {
      const entities = extractEntities(file.content, file.relativePath, file.language);
      const chunks = chunkEntities(entities, file.relativePath, file.content, file.language, {
        maxChunkSize: config.maxChunkSize,
      });
      allChunks.push({ file, chunks });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      note(`${file.relativePath}: ${msg}`, 'Warning');
    }
  }

  const totalChunks = allChunks.reduce((sum, { chunks }) => sum + chunks.length, 0);
  s.stop(`Parsed ${changedFiles.length} files (${totalChunks} chunks)`);

  // Phase 2 & 3: Embed and index with progress bar
  const progressBar = new cliProgress.SingleBar({
    format:
      `${pico.cyan('Indexing')} |{bar}| ` +
      `${pico.green('{percentage}%')} ` +
      `{value}/{total} chunks ` +
      `${pico.dim('| ETA: {eta}s | {speed} ch/s')}`,
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
  });

  progressBar.start(totalChunks, 0, { speed: '0' });

  let processedFiles = 0;
  let chunksDone = 0;
  const startTime = Date.now();

  for (const { file, chunks } of allChunks) {
    try {
      removeIndexedChunks(cacheDir, file.relativePath);
      await deleteFileChunks(file.relativePath, config);

      await indexChunks(chunks, config);

      setIndexedFile(cacheDir, {
        path: file.path,
        mtime: file.mtime,
        hash: file.hash,
      });

      processedFiles++;
      chunksDone += chunks.length;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? Math.round(chunksDone / elapsed) : 0;
      progressBar.update(chunksDone, { speed: String(speed) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      note(`${file.relativePath}: ${msg}`, 'Warning');
    }
  }

  progressBar.stop();

  outro(`Indexed ${processedFiles} files (${chunksDone} chunks). Run ${pico.cyan('scs query')} to search.`);
}
