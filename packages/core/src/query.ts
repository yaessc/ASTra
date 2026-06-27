import { QdrantClient } from '@qdrant/js-client-rest';
import type { ScsConfig, SearchResult } from './types.js';
import { embedText } from './embedder.js';
import { wrapQdrantError, QdrantConnectionError } from './errors.js';

function createClient(config: ScsConfig): QdrantClient {
  try {
    return new QdrantClient({ url: config.qdrantUrl });
  } catch (err) {
    throw wrapQdrantError(err, config.qdrantUrl);
  }
}

async function safeQdrantCall<T>(fn: () => Promise<T>, config: ScsConfig): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
    throw wrapQdrantError(err, config.qdrantUrl);
  }
}

export async function searchCodebase(
  query: string,
  config: ScsConfig,
  limit: number = 10,
): Promise<SearchResult[]> {
  const client = createClient(config);

  const queryVector = await embedText(query, config);

  const results = await safeQdrantCall(async () => {
    return await client.search(config.collectionName, {
      vector: queryVector,
      limit,
      with_payload: true,
    });
  }, config);

  return results.map(r => ({
    chunkId: String(r.id),
    filePath: (r.payload as any)?.filePath || '',
    startLine: (r.payload as any)?.startLine || 0,
    endLine: (r.payload as any)?.endLine || 0,
    score: r.score ?? 0,
    code: (r.payload as any)?.code || '',
    entities: [],
    language: (r.payload as any)?.language || 'typescript',
  }));
}
