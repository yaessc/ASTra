import { resolve } from 'node:path';
import {
  loadConfig, scanFiles, initLanguages, extractEntities,
  chunkEntities, initEmbedder, indexChunks, setIndexedFile,
  getIndexedFile, getAllIndexedFilePaths,
  removeIndexedFile, removeIndexedChunks, deleteFileChunks,
  getCacheDir, closeCache, ConfigValidationError, QdrantConnectionError,
} from '@astra/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import cliProgress from 'cli-progress';
import { ProgressBarManager } from '../utils/progress.js';

export async function indexCommand(dir: string = '.'): Promise<void> {
  const rootDir = resolve(dir || '.');
  let config;

  try {
    config = loadConfig(rootDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('astra index'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix astra.config.json and re-run.');
      return;
    }
    throw err;
  }

  intro(pico.cyan('astra index'));

  const overallStart = Date.now();

  const s = spinner();

  try {
    s.start('Initializing languages...');
    await initLanguages();
    s.stop('Languages initialized');

    s.start('Initializing embedding model...');

    const modelBar = new ProgressBarManager();
    let lastFile = '';
    const DOWNLOAD_FMT = `${pico.cyan('Downloading')} ${pico.dim('{file}')} |{bar}| ${pico.green('{percentage}%')} {loadedMb}/{totalMb} MB`;

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

    s.stop('Embedding model ready');

    s.start('Scanning files...');
    const { files } = scanFiles(rootDir, config);
    s.stop(`Found ${files.length} files`);

    const cacheDir = getCacheDir(rootDir);
    const cachedPaths = getAllIndexedFilePaths(cacheDir);
    const scannedPaths = new Set(files.map(f => f.relativePath));
    const staleFiles = cachedPaths.filter(p => !scannedPaths.has(p));

    if (staleFiles.length > 0) {
      s.start(`Removing ${staleFiles.length} deleted files from index...`);
      for (const fp of staleFiles) {
        try {
          await deleteFileChunks(fp, config);
          removeIndexedFile(cacheDir, fp);
          removeIndexedChunks(cacheDir, fp);
        } catch {
          note(`Could not remove ${fp} from Qdrant. Will retry on next index.`, 'Warning');
        }
      }
      s.stop(`Removed ${staleFiles.length} deleted files`);
    }

    if (files.length === 0) {
      note('No TypeScript/JavaScript files found. Check your astra.config.json include patterns.', 'Nothing to index');
      outro('Done');
      return;
    }

    const changedFiles = files.filter(f => {
      const cached = getIndexedFile(cacheDir, f.relativePath);
      return !cached || cached.hash !== f.hash;
    });

    const cachedCount = files.length - changedFiles.length;

    if (changedFiles.length === 0) {
      const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
      note('All files are up to date.', 'Index is current');
      outro(`${pico.green('✓')} Everything up to date — ${cachedCount} files cached (checked in ${elapsed}s)`);
      return;
    }

    s.start(`Parsing ${changedFiles.length} files...`);

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

    const progressBar = new cliProgress.SingleBar({
      format:
        `${pico.cyan('Indexing')} |{bar}| ` +
        `${pico.green('{percentage}%')} ` +
        `{value}/{total} chunks ` +
        `${pico.dim('| ETA: {eta_formatted} | {speed} ch/s')}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    });

    progressBar.start(totalChunks, 0, { speed: '0', eta_formatted: '--' });

    let processedFiles = 0;
    let chunksDone = 0;
    let errorCount = 0;
    const startTime = Date.now();

    for (const { file, chunks } of allChunks) {
      try {
        await indexChunks(chunks, config, rootDir);
        setIndexedFile(cacheDir, {
          path: file.relativePath,
          mtime: file.mtime,
          hash: file.hash,
        });

        processedFiles++;
        chunksDone += chunks.length;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? Math.round(chunksDone / elapsed) : 0;
        const eta = totalChunks > chunksDone && speed > 0
          ? Math.round((totalChunks - chunksDone) / speed)
          : 0;
        const etaStr = eta > 0 ? `${eta}s` : '--';
        progressBar.update(chunksDone, { speed: String(speed), eta_formatted: etaStr });
      } catch (err) {
        errorCount++;
        if (err instanceof QdrantConnectionError) {
          progressBar.stop();
          note(err.message, 'Qdrant Error');
          outro('Indexing stopped. Fix the issue and re-run.');
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        note(`${file.relativePath}: ${msg}`, 'Warning');
      }
    }

    progressBar.stop();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    outro(
      `Indexed ${files.length} files in ${elapsed}s` +
      ` (${cachedCount} cached, ${processedFiles} indexed${errorCount > 0 ? `, ${errorCount} errors` : ''})` +
      `. Run ${pico.cyan('astra query')} to search.`
    );
  } finally {
    closeCache();
  }
}
