import type { AstraConfig, SearchResult, QdrantCodeChunkPayload, SupportedLanguage } from './types.js';
import { embedText } from './embedder.js';
import { createClient, safeQdrantCall } from './qdrant.js';

export type SearchMode = 'vector' | 'keyword' | 'hybrid';

function toQdrantPayload(payload: Record<string, unknown> | null | undefined): QdrantCodeChunkPayload {
  return {
    filePath: String(payload?.filePath ?? ''),
    startLine: Number(payload?.startLine ?? 0),
    endLine: Number(payload?.endLine ?? 0),
    entityTypes: Array.isArray(payload?.entityTypes) ? payload.entityTypes as string[] : [],
    entityNames: Array.isArray(payload?.entityNames) ? payload.entityNames as string[] : [],
    firstEntitySignature: String(payload?.firstEntitySignature ?? ''),
    entitiesJson: String(payload?.entitiesJson ?? '[]'),
    code: String(payload?.code ?? ''),
    language: String(payload?.language ?? 'typescript'),
    chunkType: String(payload?.chunkType ?? 'body'),
  };
}

function mapResult(r: {
  id: string | number;
  payload?: Record<string, unknown> | null;
  score?: number;
}): SearchResult {
  const p = toQdrantPayload(r.payload);
  return {
    chunkId: String(r.id),
    filePath: p.filePath,
    startLine: p.startLine,
    endLine: p.endLine,
    score: r.score ?? 0,
    code: p.code,
    entities: JSON.parse(p.entitiesJson),
    language: p.language as SupportedLanguage,
    chunkType: p.chunkType as 'metadata' | 'body',
  };
}

export async function searchCodebase(
  query: string,
  config: AstraConfig,
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

  return results.map(mapResult);
}

async function keywordSearch(
  query: string,
  config: AstraConfig,
  limit: number,
): Promise<SearchResult[]> {
  const client = createClient(config);

  const response = await safeQdrantCall(async () => {
    return await client.query(config.collectionName, {
      query: { text: query, model: 'qdrant/bm25' },
      limit,
      with_payload: true,
    });
  }, config);

  return response.points.map(mapResult);
}

export function rrfMerge(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  limit: number,
  k: number = 60,
): SearchResult[] {
  const scores = new Map<string, { result: SearchResult; rrfScore: number }>();

  for (const list of [vectorResults, keywordResults]) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank];
      const boost = r.chunkType === 'metadata' ? 1.2 : 1.0;
      const contribution = boost / (k + rank);

      const existing = scores.get(r.chunkId);
      if (existing) {
        existing.rrfScore += contribution;
      } else {
        scores.set(r.chunkId, { result: r, rrfScore: contribution });
      }
    }
  }

  const maxScore = Math.max(...[...scores.values()].map(v => v.rrfScore), 1e-10);

  return [...scores.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(entry => ({
      ...entry.result,
      score: entry.rrfScore / maxScore,
    }));
}

export async function searchHybrid(
  query: string,
  config: AstraConfig,
  limit: number = 10,
  options?: { mode?: SearchMode },
): Promise<SearchResult[]> {
  const mode = options?.mode || 'hybrid';

  switch (mode) {
    case 'vector':
      return searchCodebase(query, config, limit);
    case 'keyword':
      return keywordSearch(query, config, limit);
    case 'hybrid':
    default: {
      const [vector, keyword] = await Promise.all([
        searchCodebase(query, config, limit * 2),
        keywordSearch(query, config, limit * 2),
      ]);
      return rrfMerge(vector, keyword, limit);
    }
  }
}
