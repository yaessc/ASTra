import { QdrantClient } from '@qdrant/js-client-rest';
import type { AstraConfig, CodeChunk, IndexStats } from './types.js';
import { embedBatch } from './embedder.js';
import { getCacheDir, storeChunkQdrantIds, removeIndexedChunks, getAllIndexedFilePaths, getLastIndexedMtime } from './cache.js';
import { QdrantConnectionError } from './errors.js';
import { createClient, safeQdrantCall } from './qdrant.js';
import { createHash } from 'node:crypto';

function chunkToPayload(chunk: CodeChunk) {
  return {
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    entityTypes: [...new Set(chunk.entities.map(e => e.type))],
    entityNames: chunk.entities.map(e => e.name),
    firstEntitySignature: chunk.entities[0]?.signature || '',
    entitiesJson: JSON.stringify(chunk.entities),
    code: chunk.content.slice(0, 4000),
    language: chunk.language,
    chunkType: chunk.chunkType,
  };
}

export async function ensureCollection(config: AstraConfig): Promise<QdrantClient> {
  const client = createClient(config);

  await safeQdrantCall(async () => {
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === config.collectionName);
    if (!exists) {
      await client.createCollection(config.collectionName, {
        vectors: { "dense": { size: 384, distance: 'Cosine' } },
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
    }
  }, config);

  await safeQdrantCall(async () => {
    await client.createPayloadIndex(config.collectionName, {
      field_name: 'firstEntitySignature',
      field_schema: 'text',
    });
  }, config).catch(() => {});

  await safeQdrantCall(async () => {
    await client.createPayloadIndex(config.collectionName, {
      field_name: 'code',
      field_schema: { type: 'text', tokenizer: 'word' },
    });
  }, config).catch(() => {});

  return client;
}

export async function indexChunks(chunks: CodeChunk[], config: AstraConfig, rootDir: string): Promise<void> {
  const client = await ensureCollection(config);
  const cacheDir = getCacheDir(rootDir);

  const filePaths = [...new Set(chunks.map(c => c.filePath))];
  for (const fp of filePaths) {
    await safeQdrantCall(async () => {
      await client.delete(config.collectionName, {
        wait: true,
        filter: {
          must: [{ key: 'filePath', match: { value: fp } }],
        },
      });
    }, config);
    removeIndexedChunks(cacheDir, fp);
  }

  let upsertBatch: {
    id: string;
    vector: { "dense": number[]; "bm25": { text: string; model: string } };
    payload: Record<string, unknown>;
  }[] = [];
  const qdrantMappings: { chunk: CodeChunk; qdrantId: string }[] = [];

  for await (const { chunk, embedding } of embedBatch(chunks, config)) {
    const qdrantId = chunkIdToUUID(chunk.id);
    qdrantMappings.push({ chunk, qdrantId });

    upsertBatch.push({
      id: qdrantId,
      vector: {
        "dense": embedding,
        "bm25": { text: chunk.content, model: "qdrant/bm25" },
      },
      payload: chunkToPayload(chunk),
    });

    if (upsertBatch.length >= 100) {
      await safeQdrantCall(async () => {
        await client.upsert(config.collectionName, {
          wait: true,
          points: upsertBatch,
        });
      }, config);
      upsertBatch = [];
    }
  }

  if (upsertBatch.length > 0) {
    await safeQdrantCall(async () => {
      await client.upsert(config.collectionName, {
        wait: true,
        points: upsertBatch,
      });
    }, config);
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
    if (err instanceof QdrantConnectionError) {
      if (err.message.toLowerCase().includes('not found')) return;
      throw err;
    }
  }
}

export async function getIndexStats(config: AstraConfig, rootDir?: string): Promise<IndexStats> {
  const client = createClient(config);

  let totalFiles = 0;
  let lastIndexed: string | null = null;

  if (rootDir) {
    const cacheDir = getCacheDir(rootDir);
    totalFiles = getAllIndexedFilePaths(cacheDir).length;
    const lastMtime = getLastIndexedMtime(cacheDir);
    if (lastMtime) lastIndexed = new Date(lastMtime).toISOString();
  }

  try {
    const info = await safeQdrantCall(async () => {
      return await client.getCollection(config.collectionName);
    }, config);
    const count = info.points_count ?? 0;

    return {
      totalFiles,
      totalChunks: count,
      lastIndexed,
      collectionSize: count,
    };
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
    return {
      totalFiles,
      totalChunks: 0,
      lastIndexed,
      collectionSize: 0,
    };
  }
}

export async function resetCollection(config: AstraConfig): Promise<void> {
  const client = createClient(config);
  try {
    await safeQdrantCall(async () => {
      await client.deleteCollection(config.collectionName);
    }, config);
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
  }
}

function chunkIdToUUID(chunkId: string): string {
  const hex = createHash('sha256').update(chunkId).digest('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12),
    hex.slice(12, 16), hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
