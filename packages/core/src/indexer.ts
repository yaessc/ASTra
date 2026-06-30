import { QdrantClient } from '@qdrant/js-client-rest';
import type { AstraConfig, CodeChunk, IndexStats } from './types.js';
import { embedBatch, formatCodeForEmbedding } from './embedder.js';
import { getCacheDir, storeChunkQdrantId, removeIndexedChunks } from './cache.js';
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
        vectors: { size: 384, distance: 'Cosine' },
      });
    }
  }, config);

  await safeQdrantCall(async () => {
    await client.createPayloadIndex(config.collectionName, {
      field_name: 'firstEntitySignature',
      field_schema: 'text',
    });
  }, config).catch(() => {});

  return client;
}

export async function indexChunks(chunks: CodeChunk[], config: AstraConfig, rootDir: string): Promise<void> {
  const client = await ensureCollection(config);
  const cacheDir = getCacheDir(rootDir);

  const texts = chunks.map(c => formatCodeForEmbedding(c));
  const embeddings = await embedBatch(texts, config);

  const points = chunks.map((chunk, i) => ({
    id: chunkIdToUUID(chunk.id),
    vector: embeddings[i],
    payload: chunkToPayload(chunk),
  }));

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

  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await safeQdrantCall(async () => {
      await client.upsert(config.collectionName, {
        wait: true,
        points: batch,
      });
    }, config);
  }

  for (const chunk of chunks) {
    storeChunkQdrantId(cacheDir, chunk.id, chunk.filePath, chunk.startLine, chunk.endLine, chunkIdToUUID(chunk.id));
  }
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
    if (err instanceof QdrantConnectionError) throw err;
  }
}

export async function getIndexStats(config: AstraConfig): Promise<IndexStats> {
  const client = createClient(config);

  try {
    const info = await safeQdrantCall(async () => {
      return await client.getCollection(config.collectionName);
    }, config);
    const count = info.points_count ?? 0;

    return {
      totalFiles: 0,
      totalChunks: count,
      lastIndexed: null,
      collectionSize: count,
    };
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
    return {
      totalFiles: 0,
      totalChunks: 0,
      lastIndexed: null,
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
