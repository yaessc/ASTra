import { QdrantClient } from '@qdrant/js-client-rest';
import type { AstraConfig, CodeChunk, IndexStats, IndexVerificationReport, FileIntegrityEntry } from './types.js';
import { embedBatch, getEmbeddingDimension } from './embedder.js';
import { getCacheDir, storeChunkQdrantIds, removeIndexedChunksBatch, removeIndexedFilesBatch, getChunkQdrantIdsByFilePaths, getAllIndexedFilePaths, getLastIndexedMtime, getChunkCount, getAllChunkByFilePath, removeIndexedFile, removeIndexedChunks } from './cache.js';
import { QdrantConnectionError, isQdrantNotFoundError } from './errors.js';
import { createClient, safeQdrantCall } from './qdrant.js';
import { createHash } from 'node:crypto';

function chunkToPayload(chunk: CodeChunk, maxBodyChars: number) {
  const entities = chunk.entities.map(({ code: _code, ...rest }) => rest);
  return {
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    entityTypes: [...new Set(chunk.entities.map(e => e.type))],
    entityNames: chunk.entities.map(e => e.name),
    firstEntitySignature: chunk.entities[0]?.signature || '',
    entities,
    // entitiesJson intentionally omitted — legacy pre-v4 field.
    // Old Qdrant points still carry it; the read path in query.ts
    // falls back to it when the native array is empty.
    code: chunk.content.slice(0, maxBodyChars),
    language: chunk.language,
    chunkType: chunk.chunkType,
  };
}

export async function ensureCollection(
  config: AstraConfig,
  onWarning?: (message: string) => void,
): Promise<QdrantClient> {
  const client = createClient(config);
  const vectorSize = await getEmbeddingDimension(config);

  await safeQdrantCall(async () => {
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === config.collectionName);
    if (!exists) {
      await client.createCollection(config.collectionName, {
        vectors: { "dense": { size: vectorSize, distance: 'Cosine' } },
        sparse_vectors: { "bm25": { modifier: "idf" } },
      });
    } else {
      const info = await client.getCollection(config.collectionName);
      if (!info.config?.params?.sparse_vectors?.["bm25"]) {
        throw new Error(
          `Collection "${config.collectionName}" was created with an older schema. ` +
          `Run "astra reset && astra index" to migrate to the new schema.`
        );
      }
      const vectors = info.config?.params?.vectors;
      const existingSize = vectors && 'dense' in vectors ? (vectors as Record<string, { size: number }>).dense.size : undefined;
      if (existingSize && existingSize !== vectorSize) {
        throw new Error(
          `Collection "${config.collectionName}" was created with vector size ${existingSize} ` +
          `but model "${config.modelId}" outputs ${vectorSize} dimensions. ` +
          `Run "astra reset && astra index" to rebuild.`
        );
      }
    }
  }, config);

  try {
    await safeQdrantCall(async () => {
      await client.createPayloadIndex(config.collectionName, {
        field_name: 'filePath',
        field_schema: 'keyword',
        wait: true,
      });
    }, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarning?.(`Could not create payload index (non-fatal): ${msg}`);
  }

  return client;
}

export async function indexChunks(
  chunks: CodeChunk[],
  config: AstraConfig,
  rootDir: string,
  client?: QdrantClient,
  onProgress?: (indexedCount: number) => void,
  onWarning?: (message: string) => void,
): Promise<void> {
  const qdrantClient = client ?? await ensureCollection(config, onWarning);
  const cacheDir = getCacheDir(rootDir);

  const filePaths = [...new Set(chunks.map(c => c.filePath))];

  // Phase 0: Remove indexed_files entries early so crash leads to re-index
  if (filePaths.length > 0) {
    removeIndexedFilesBatch(cacheDir, filePaths);
  }

  // Phase 1: Capture old Qdrant IDs before any mutations
  const oldQdrantIds = getChunkQdrantIdsByFilePaths(cacheDir, filePaths);

  // Phase 2: Upsert new points (overwrites matching deterministic IDs)
  let upsertBatch: {
    id: string;
    vector: { "dense": number[]; "bm25": { text: string; model: string } };
    payload: Record<string, unknown>;
  }[] = [];
  const qdrantMappings: { chunk: CodeChunk; qdrantId: string }[] = [];
  let indexedCount = 0;

  for await (const { chunk, embedding } of embedBatch(chunks, config)) {
    indexedCount++;
    onProgress?.(indexedCount);
    const qdrantId = chunkIdToUUID(chunk.id);
    qdrantMappings.push({ chunk, qdrantId });

    upsertBatch.push({
      id: qdrantId,
      vector: {
        "dense": embedding,
        "bm25": { text: chunk.content, model: "qdrant/bm25" },
      },
      payload: chunkToPayload(chunk, config.maxBodyChars),
    });

    if (upsertBatch.length >= 100) {
      await safeQdrantCall(async () => {
        await qdrantClient.upsert(config.collectionName, {
          wait: true,
          points: upsertBatch,
        });
      }, config);
      upsertBatch = [];
    }
  }

  if (upsertBatch.length > 0) {
    await safeQdrantCall(async () => {
      await qdrantClient.upsert(config.collectionName, {
        wait: true,
        points: upsertBatch,
      });
    }, config);
  }

  // Phase 3: Delete stale old Qdrant points not in the new set
  const newQdrantIds = new Set(qdrantMappings.map(m => m.qdrantId));
  const staleQdrantIds = oldQdrantIds.filter(id => !newQdrantIds.has(id));

  if (staleQdrantIds.length > 0) {
    await safeQdrantCall(async () => {
      await qdrantClient.delete(config.collectionName, {
        wait: true,
        points: staleQdrantIds,
      });
    }, config);
  }

  // Phase 4: Update cache — remove old entries, store new ones
  if (filePaths.length > 0) {
    removeIndexedChunksBatch(cacheDir, filePaths);
  }
  storeChunkQdrantIds(cacheDir, qdrantMappings.map(({ chunk, qdrantId }) => ({
    chunkId: chunk.id,
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    qdrantId,
  })));
}

export async function deleteFileChunks(filePath: string, config: AstraConfig): Promise<void> {
  const client = createClient(config);
  try {
    await safeQdrantCall(async () => {
      await client.delete(config.collectionName, {
        wait: true,
        filter: {
          must: [{ key: 'filePath', match: { value: filePath } }],
        },
      });
    }, config);
  } catch (err) {
    if (err instanceof QdrantConnectionError && isQdrantNotFoundError(err)) return;
    throw err;
  }
}

export async function deleteFileChunksBatch(filePaths: string[], config: AstraConfig): Promise<void> {
  if (filePaths.length === 0) return;
  const client = createClient(config);
  try {
    await safeQdrantCall(async () => {
      await client.delete(config.collectionName, {
        wait: true,
        filter: {
          must: [{ key: 'filePath', match: { any: filePaths } }],
        },
      });
    }, config);
  } catch (err) {
    if (err instanceof QdrantConnectionError && isQdrantNotFoundError(err)) return;
    throw err;
  }
}

export async function getIndexStats(config: AstraConfig, rootDir?: string): Promise<IndexStats> {
  const client = createClient(config);

  let totalFiles = 0;
  let cacheChunkCount = 0;
  let lastIndexed: string | null = null;

  if (rootDir) {
    const cacheDir = getCacheDir(rootDir);
    totalFiles = getAllIndexedFilePaths(cacheDir).length;
    cacheChunkCount = getChunkCount(cacheDir);
    const lastMtime = getLastIndexedMtime(cacheDir);
    if (lastMtime) lastIndexed = new Date(lastMtime).toISOString();
  }

  try {
    const info = await safeQdrantCall(async () => {
      return await client.getCollection(config.collectionName);
    }, config);
    const count = info.points_count ?? 0;
    const vectors = info.config?.params?.vectors;
    const vectorSize = vectors && 'dense' in vectors
      ? (vectors as Record<string, { size: number }>).dense.size
      : null;

    return {
      totalFiles,
      totalChunks: count,
      lastIndexed,
      collectionSize: count,
      vectorSize,
      ...(rootDir ? { cacheChunkCount } : {}),
    };
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
    return {
      totalFiles,
      totalChunks: 0,
      lastIndexed,
      collectionSize: 0,
      vectorSize: null,
      ...(rootDir ? { cacheChunkCount } : {}),
    };
  }
}

async function scrollAllQdrantPoints(config: AstraConfig): Promise<Map<string, number>> {
  const client = createClient(config);
  const fileCountMap = new Map<string, number>();
  let offset: unknown = undefined;
  do {
    const result = await safeQdrantCall(async () => {
      return await client.scroll(config.collectionName, {
        limit: 1000,
        offset: offset as (string | number | undefined),
        with_payload: { include: ['filePath'] },
        with_vector: false,
      });
    }, config);
    for (const point of result.points) {
      const fp = (point.payload as Record<string, unknown> | undefined)?.filePath;
      if (typeof fp === 'string') {
        fileCountMap.set(fp, (fileCountMap.get(fp) ?? 0) + 1);
      }
    }
    offset = result.next_page_offset;
  } while (offset != null);
  return fileCountMap;
}

export async function verifyIndexIntegrity(config: AstraConfig, rootDir: string): Promise<IndexVerificationReport> {
  const cacheDir = getCacheDir(rootDir);
  const cachePaths = new Set(getAllIndexedFilePaths(cacheDir));
  const cacheChunks = getAllChunkByFilePath(cacheDir);

  const qdrantCounts = await scrollAllQdrantPoints(config);

  const allPaths = new Set<string>([...cachePaths, ...qdrantCounts.keys()]);
  const details: FileIntegrityEntry[] = [];
  let ok = 0, missingFromQdrant = 0, orphanedInQdrant = 0, mismatched = 0;

  for (const filePath of allPaths) {
    const cacheCount = cacheChunks.get(filePath)?.length ?? 0;
    const qdrantCount = qdrantCounts.get(filePath) ?? 0;
    const inCache = cachePaths.has(filePath);

    let status: FileIntegrityEntry['status'];
    if (inCache && qdrantCount === 0) {
      if (cacheCount > 0) {
        status = 'missing';
        missingFromQdrant++;
      } else {
        status = 'ok';
        ok++;
      }
    } else if (!inCache && qdrantCount > 0) {
      status = 'orphaned';
      orphanedInQdrant++;
    } else if (inCache && cacheCount !== qdrantCount) {
      status = 'mismatch';
      mismatched++;
    } else {
      status = 'ok';
      ok++;
    }
    details.push({ filePath, cacheChunkCount: cacheCount, qdrantChunkCount: qdrantCount, status });
  }

  return { ok, missingFromQdrant, orphanedInQdrant, mismatched, details };
}

export async function repairIndex(config: AstraConfig, rootDir: string): Promise<IndexVerificationReport> {
  const report = await verifyIndexIntegrity(config, rootDir);

  const orphanedPaths = report.details.filter(d => d.status === 'orphaned').map(d => d.filePath);
  const missingPaths = report.details.filter(d => d.status === 'missing').map(d => d.filePath);
  const mismatchedPaths = report.details.filter(d => d.status === 'mismatch').map(d => d.filePath);

  const cacheDir = getCacheDir(rootDir);

  if (orphanedPaths.length > 0) {
    await deleteFileChunksBatch(orphanedPaths, config);
  }

  if (mismatchedPaths.length > 0) {
    await deleteFileChunksBatch(mismatchedPaths, config);
  }

  const removeFromCache = [...missingPaths, ...mismatchedPaths];
  for (const fp of removeFromCache) {
    removeIndexedFile(cacheDir, fp);
    removeIndexedChunks(cacheDir, fp);
  }

  return verifyIndexIntegrity(config, rootDir);
}

export async function resetCollection(config: AstraConfig): Promise<void> {
  const client = createClient(config);
  try {
    await safeQdrantCall(async () => {
      await client.deleteCollection(config.collectionName);
    }, config);
  } catch (err) {
    if (err instanceof QdrantConnectionError && isQdrantNotFoundError(err)) return;
    throw err;
  }
}

function chunkIdToUUID(chunkId: string): string {
  const hex = createHash('sha256').update(chunkId).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${(parseInt(hex[16], 16) & 0x03 | 0x08).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
