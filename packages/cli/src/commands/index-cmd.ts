import { resolve } from 'node:path';
import {
  scanFiles, readFileWithHash, initLanguages, extractEntities,
  chunkEntities, initEmbedder, ensureCollection, indexChunks, setIndexedFile, setIndexedFiles,
  getIndexedFile, getAllIndexedFilePaths,
  removeIndexedFilesBatch, removeIndexedChunksBatch, deleteFileChunksBatch,
  getCacheDir, closeCache, wasCacheReset, QdrantConnectionError,
  type ScannedFile, type IndexedFile, type CodeChunk,
} from '@astra/core';
import { intro, spinner, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import cliProgress from 'cli-progress';
import { initModelWithProgress } from '../utils/progress.js';
import { loadConfigOrExit } from '../utils/config.js';

export async function indexCommand(dir: string = '.'): Promise<void> {
  const rootDir = resolve(dir || '.');
  const config = loadConfigOrExit(rootDir, 'index');
  if (!config) return;

  intro(pico.cyan('astra index'));

  let interrupted = false;
  let progressBar!: cliProgress.SingleBar;

  function onInterrupt(signal: 'SIGINT' | 'SIGTERM') {
    if (interrupted) return;
    interrupted = true;
    const exitCode = signal === 'SIGINT' ? 130 : 143;
    progressBar?.stop();
    try { s?.stop(''); } catch { /* spinner may not be started */ }
    closeCache();
    outro(`Indexing interrupted (${signal}). Re-run to continue.`);
    process.exit(exitCode);
  }

  const onSigInt = () => onInterrupt('SIGINT');
  const onSigTerm = () => onInterrupt('SIGTERM');
  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  const overallStart = Date.now();

  const s = spinner();

  try {
    s.start('Initializing languages...');
    await initLanguages();
    s.stop('Languages initialized');

    s.start('Initializing embedding model...');
    await initModelWithProgress(config, initEmbedder);
    s.stop('Embedding model ready');

    s.start('Scanning files...');
    const { files, warnings } = scanFiles(rootDir, config);
    s.stop(`Found ${files.length} files`);

    for (const w of warnings) {
      note(w, 'Warning');
    }

    const cacheDir = getCacheDir(rootDir);
    const cachedPaths = getAllIndexedFilePaths(cacheDir);

    if (wasCacheReset(cacheDir)) {
      note('Cache schema was upgraded. All files will be re-indexed.', 'Cache Reset');
    }

    const scannedPaths = new Set(files.map(f => f.relativePath));
    const staleFiles = cachedPaths.filter(p => !scannedPaths.has(p));

    if (staleFiles.length > 0) {
      s.start(`Removing ${staleFiles.length} deleted files from index...`);
      try {
        await deleteFileChunksBatch(staleFiles, config);
        removeIndexedFilesBatch(cacheDir, staleFiles);
        removeIndexedChunksBatch(cacheDir, staleFiles);
        s.stop(`Removed ${staleFiles.length} deleted files`);
      } catch {
        s.stop('Warning');
        note(`Could not remove ${staleFiles.length} files from Qdrant. Will retry on next index.`, 'Warning');
      }
    }

    if (files.length === 0) {
      note('No TypeScript/JavaScript files found. Check your astra.config.json include patterns.', 'Nothing to index');
      outro('Done');
      return;
    }

    type EnrichedFile = ScannedFile & { content: string; hash: string };
    const changedFiles: EnrichedFile[] = [];

    for (const f of files) {
      const cached = getIndexedFile(cacheDir, f.relativePath);
      if (cached && cached.mtime === f.mtime) continue;
      let content: string, hash: string;
      try {
        ({ content, hash } = readFileWithHash(f.path));
      } catch {
        note(`Could not read ${f.relativePath}: file may have been deleted or permissions changed. Skipping.`, 'Warning');
        continue;
      }
      if (cached && cached.hash === hash) {
        setIndexedFile(cacheDir, { path: f.relativePath, mtime: f.mtime, hash });
        continue;
      }
      changedFiles.push({ ...f, content, hash });
    }

    const cachedCount = files.length - changedFiles.length;

    if (changedFiles.length === 0) {
      const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
      note('All files are up to date.', 'Index is current');
      outro(`${pico.green('✓')} Everything up to date — ${cachedCount} files cached (checked in ${elapsed}s)`);
      return;
    }

    s.start(`Parsing ${changedFiles.length} files...`);

    const allChunks: { file: EnrichedFile; chunks: CodeChunk[] }[] = [];

    for (const file of changedFiles) {
      try {
        const entities = extractEntities(file.content, file.relativePath, file.language);
        const chunks = chunkEntities(entities, file.relativePath, file.content, file.language, {
          maxChunkSize: config.maxChunkSize,
          maxBodyLines: config.maxBodyLines,
          maxBodyChars: config.maxBodyChars,
          linesPerBodyChunk: config.linesPerBodyChunk,
          chunkOverlap: config.chunkOverlap,
        });
        allChunks.push({ file, chunks });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        note(`${file.relativePath}: ${msg}`, 'Warning');
      }
    }

    const totalChunks = allChunks.reduce((sum, { chunks }) => sum + chunks.length, 0);
    s.stop(`Parsed ${changedFiles.length} files (${totalChunks} chunks)`);

    progressBar = new cliProgress.SingleBar({
      format:
        `${pico.cyan('Indexing')} |{bar}| ` +
        `${pico.green('{percentage}%')} ` +
        `{value}/{total} chunks ` +
        `${pico.dim('| ETA: {eta_formatted} | {speed} ch/s')}`,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    });

    const qdrantClient = await ensureCollection(config, (msg) => {
      note(msg, 'Warning');
    });

    progressBar.start(totalChunks, 0, { speed: '0', eta_formatted: '--' });

    const startTime = Date.now();

    const allFileChunks = allChunks.flatMap(({ chunks }) => chunks);

    try {
      await indexChunks(allFileChunks, config, rootDir, qdrantClient, (indexedCount) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? Math.round(indexedCount / elapsed) : 0;
        const eta = totalChunks > indexedCount && speed > 0
          ? Math.round((totalChunks - indexedCount) / speed)
          : 0;
        const etaStr = eta > 0 ? `${eta}s` : '--';
        progressBar.update(indexedCount, { speed: String(speed), eta_formatted: etaStr });
      });

      const indexedFiles: IndexedFile[] = allChunks.map(({ file }) => ({
        path: file.relativePath,
        mtime: file.mtime,
        hash: file.hash,
      }));
      setIndexedFiles(cacheDir, indexedFiles);
    } catch (err) {
      progressBar.stop();
      if (err instanceof QdrantConnectionError) {
        note(err.message, 'Qdrant Error');
        outro('Indexing stopped. Fix the issue and re-run.');
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      note(`Indexing failed: ${msg}`, 'Warning');
      outro('Indexing failed. Check warnings above.');
      return;
    }

    progressBar.update(totalChunks, { speed: '0', eta_formatted: '--' });
    progressBar.stop();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    outro(
      `Indexed ${files.length} files in ${elapsed}s` +
      ` (${cachedCount} cached, ${allChunks.length} indexed)` +
      `. Run ${pico.cyan('astra query')} to search.`
    );
  } catch (err) {
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note(err instanceof Error ? err.message : String(err), 'Error');
    }
    outro('Indexing failed to start.');
    return;
  } finally {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
    if (!interrupted) closeCache();
  }
}
