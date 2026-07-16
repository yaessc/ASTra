import type { AstraConfig, CodeEntity, SearchResult, QdrantCodeChunkPayload, SupportedLanguage } from './types.js';
import { ENTITY_TYPES } from './types.js';
import { embedText } from './embedder.js';
import { createClient, safeQdrantCall } from './qdrant.js';
import { z } from 'zod';

export type SearchMode = 'vector' | 'keyword' | 'hybrid';

const EntityPayloadItemSchema = z.object({
  type: z.enum(ENTITY_TYPES).catch('function'),
  name: z.string(),
  filePath: z.string().default(''),
  startLine: z.number().default(0),
  endLine: z.number().default(0),
  signature: z.string().default(''),
  docComment: z.string().default(''),
  language: z.enum(['typescript', 'javascript', 'tsx']).default('typescript'),
});

const QdrantPayloadSchema = z.object({
  filePath: z.string().catch(''),
  startLine: z.number().catch(0),
  endLine: z.number().catch(0),
  entityTypes: z.array(z.string()).catch([]),
  entityNames: z.array(z.string()).catch([]),
  firstEntitySignature: z.string().catch(''),
  entities: z.array(EntityPayloadItemSchema).catch([]),
  entitiesJson: z.string().optional().catch(undefined),
  code: z.string().catch(''),
  language: z.string().catch('typescript'),
  chunkType: z.string().catch('body'),
});

export function toQdrantPayload(payload: Record<string, unknown> | null | undefined): QdrantCodeChunkPayload {
  return QdrantPayloadSchema.parse(payload ?? {}) as QdrantCodeChunkPayload;
}

function parseLegacyEntities(json: string): CodeEntity[] {
  try {
    const raw = JSON.parse(json) as Array<Record<string, unknown>>;
    return raw.map(e => ({ ...EntityPayloadItemSchema.parse(e), code: '' }));
  } catch {
    return [];
  }
}

export function mapResult(r: {
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
    // Prefer native entities array (current schema). Fall back to
    // entitiesJson for points indexed before the migration (pre-v4).
    entities: p.entities.length > 0
      ? p.entities.map(e => ({ ...e, code: '' }))
      : p.entitiesJson
        ? parseLegacyEntities(p.entitiesJson)
        : [],
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

  const response = await safeQdrantCall(async () => {
    return await client.query(config.collectionName, {
      query: queryVector,
      using: "dense",
      limit,
      with_payload: true,
    });
  }, config);

  return response.points.map(mapResult);
}

export async function keywordSearch(
  query: string,
  config: AstraConfig,
  limit: number,
): Promise<SearchResult[]> {
  const client = createClient(config);

  const response = await safeQdrantCall(async () => {
    return await client.query(config.collectionName, {
      query: { text: query, model: 'qdrant/bm25' },
      using: "bm25",
      limit,
      with_payload: true,
    });
  }, config);

  return response.points.map(mapResult);
}

const METADATA_BOOST = 1.2;

export function rrfMerge(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  limit: number,
  k: number = 60,
): SearchResult[] {
  if (k < 1) k = 1;
  const scores = new Map<string, { result: SearchResult; rrfScore: number }>();

  for (const list of [vectorResults, keywordResults]) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank];
      const boost = r.chunkType === 'metadata' ? METADATA_BOOST : 1.0;
      const contribution = boost / (k + rank);

      const existing = scores.get(r.chunkId);
      if (existing) {
        existing.rrfScore += contribution;
      } else {
        scores.set(r.chunkId, { result: r, rrfScore: contribution });
      }
    }
  }

  const listCount = (vectorResults.length > 0 ? 1 : 0) + (keywordResults.length > 0 ? 1 : 0);
  if (listCount === 0) return [];
  const maxRrf = listCount / k;

  return [...scores.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(entry => ({
      ...entry.result,
      score: Math.min(entry.rrfScore / maxRrf, 1.0),
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
