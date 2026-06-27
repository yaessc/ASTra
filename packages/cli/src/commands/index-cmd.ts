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

  // Filter only changed files
  const changedFiles = files.filter(f => {
    const cached = getIndexedFile(cacheDir, f.path);
    return !cached || cached.hash !== f.hash;
  });

  if (changedFiles.length === 0) {
    note('All files are up to date.', 'Index is current');
    outro('Done');
    return;
  }

  s.start(`Processing ${changedFiles.length} changed files...`);

  let totalChunks = 0;
  let processedFiles = 0;

  for (const file of changedFiles) {
    try {
      const entities = extractEntities(file.content, file.relativePath, file.language);
      const chunks = chunkEntities(entities, file.relativePath, file.content, file.language, {
        maxChunkSize: config.maxChunkSize,
      });

      // Remove old chunks
      removeIndexedChunks(cacheDir, file.relativePath);
      await deleteFileChunks(file.relativePath, config);

      // Index new chunks
      await indexChunks(chunks, config);

      setIndexedFile(cacheDir, {
        path: file.path,
        mtime: file.mtime,
        hash: file.hash,
      });

      totalChunks += chunks.length;
      processedFiles++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      note(`${file.relativePath}: ${msg}`, 'Warning');
    }
  }

  s.stop(`Indexed ${processedFiles} files (${totalChunks} chunks)`);

  outro('Codebase indexed. Run `scs query` to search.');
}
