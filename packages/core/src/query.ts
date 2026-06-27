import { QdrantClient } from '@qdrant/js-client-rest';
import type { ScsConfig, SearchResult, CodeChunk, CodeEntity } from './types.js';
import { embedText, formatCodeForEmbedding } from './embedder.js';

export async function searchCodebase(
  query: string,
  config: ScsConfig,
  limit: number = 10,
): Promise<SearchResult[]> {
  const client = new QdrantClient({ url: config.qdrantUrl });

  const queryVector = await embedText(query, config);

  const results = await client.search(config.collectionName, {
    vector: queryVector,
    limit,
    with_payload: true,
  });

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
