import { QdrantClient } from '@qdrant/js-client-rest';
import type { ScsConfig, CodeChunk, IndexStats } from './types.js';
import { embedBatch, formatCodeForEmbedding } from './embedder.js';
import { storeChunkQdrantId, removeIndexedChunks } from './cache.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function getCacheDir(): string {
  return join(tmpdir(), 'scs-cache');
}

function chunkToPayload(chunk: CodeChunk) {
  return {
    filePath: chunk.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    entityTypes: [...new Set(chunk.entities.map(e => e.type))],
    entityNames: chunk.entities.map(e => e.name),
    firstEntitySignature: chunk.entities[0]?.signature || '',
    code: chunk.content.slice(0, 4000),
    language: chunk.language,
  };
}

export async function ensureCollection(config: ScsConfig): Promise<QdrantClient> {
  const client = new QdrantClient({ url: config.qdrantUrl });

  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === config.collectionName);

  if (!exists) {
    await client.createCollection(config.collectionName, {
      vectors: {
        size: 384,
        distance: 'Cosine',
      },
    });
  }

  return client;
}

export async function indexChunks(chunks: CodeChunk[], config: ScsConfig): Promise<void> {
  const client = await ensureCollection(config);
  const cacheDir = getCacheDir();

  const texts = chunks.map(c => formatCodeForEmbedding(c));
  const embeddings = await embedBatch(texts, config);

  const points = chunks.map((chunk, i) => ({
    id: chunkToId(chunk),
    vector: embeddings[i],
    payload: chunkToPayload(chunk),
  }));

  // Remove old chunks for these files
  const filePaths = [...new Set(chunks.map(c => c.filePath))];
  for (const fp of filePaths) {
    try {
      await client.delete(config.collectionName, {
        wait: true,
        filter: {
          must: [{ key: 'filePath', match: { value: fp } }],
        },
      });
    } catch {}
    removeIndexedChunks(cacheDir, fp);
  }

  // Upsert new chunks
  const batchSize = 100;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await client.upsert(config.collectionName, {
      wait: true,
      points: batch,
    });
  }

  // Store mapping
  for (const chunk of chunks) {
    storeChunkQdrantId(cacheDir, chunk.id, chunk.filePath, chunk.startLine, chunk.endLine, String(chunkToId(chunk)));
  }
}

export async function deleteFileChunks(filePath: string, config: ScsConfig): Promise<void> {
  const client = new QdrantClient({ url: config.qdrantUrl });
  try {
    await client.delete(config.collectionName, {
      wait: true,
      filter: {
        must: [{ key: 'filePath', match: { value: filePath } }],
      },
    });
  } catch {}
}

export async function getIndexStats(config: ScsConfig): Promise<IndexStats> {
  const client = new QdrantClient({ url: config.qdrantUrl });

  try {
    const info = await client.getCollection(config.collectionName);
    const count = info.points_count ?? 0;

    return {
      totalFiles: 0,
      totalChunks: count,
      lastIndexed: null,
      collectionSize: count,
    };
  } catch {
    return {
      totalFiles: 0,
      totalChunks: 0,
      lastIndexed: null,
      collectionSize: 0,
    };
  }
}

export async function resetCollection(config: ScsConfig): Promise<void> {
  const client = new QdrantClient({ url: config.qdrantUrl });
  try {
    await client.deleteCollection(config.collectionName);
  } catch {}
}

function chunkToId(chunk: CodeChunk): number {
  let hash = 5381;
  const str = chunk.id;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
