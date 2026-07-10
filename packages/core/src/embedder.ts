import { ModelLoadError } from './errors.js';
import type { AstraConfig, CodeChunk } from './types.js';
import { truncateAtLineBoundary } from './parser.js';

interface FeatureExtractor {
  (text: string | string[], options?: { pooling?: string; normalize?: boolean }): Promise<{ data: Float32Array; dims?: number[] }>;
}

export interface ModelLoadProgress {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  name?: string;
}

const KNOWN_DIMENSIONS: Record<string, number> = {
  'Xenova/all-MiniLM-L6-v2': 384,
  'Xenova/all-mpnet-base-v2': 768,
  'Xenova/bge-small-en-v1.5': 384,
  'Xenova/bge-base-en-v1.5': 768,
  'Xenova/bge-large-en-v1.5': 1024,
  'Xenova/multilingual-e5-small': 384,
  'Xenova/multilingual-e5-base': 768,
  'Xenova/multilingual-e5-large': 1024,
  'Xenova/gte-small': 384,
  'Xenova/gte-base': 768,
};

let extractor: FeatureExtractor | null = null;
let loadedModelId: string | null = null;
const dimensionCache = new Map<string, number>();

export async function initEmbedder(
  config: AstraConfig,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<void> {
  if (extractor && loadedModelId === config.modelId) return;
  dimensionCache.delete(config.modelId);
  try {
    const { pipeline } = await import('@huggingface/transformers');
    extractor = await pipeline('feature-extraction', config.modelId, {
      progress_callback: onProgress,
    }) as unknown as FeatureExtractor;
    loadedModelId = config.modelId;
  } catch (err) {
    throw new ModelLoadError(`Failed to load embedding model "${config.modelId}"`, err);
  }
}

export async function getEmbeddingDimension(config: AstraConfig): Promise<number> {
  const cached = dimensionCache.get(config.modelId);
  if (cached !== undefined) return cached;

  const known = KNOWN_DIMENSIONS[config.modelId];
  if (known !== undefined) {
    dimensionCache.set(config.modelId, known);
    return known;
  }

  if (!extractor) await initEmbedder(config);
  const result = await extractor!('test', { pooling: 'mean', normalize: true });
  const dims = result.dims;
  const dimension = dims ? dims[dims.length - 1] : 384;
  dimensionCache.set(config.modelId, dimension);
  return dimension;
}

export async function embedText(text: string, config: AstraConfig): Promise<number[]> {
  if (!extractor) await initEmbedder(config);
  const result = await extractor!(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data as Float32Array);
}

export async function* embedBatch(
  chunks: CodeChunk[],
  config: AstraConfig,
): AsyncGenerator<{ chunk: CodeChunk; embedding: number[] }> {
  if (!extractor) await initEmbedder(config);

  const batchSize = 16;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batchChunks = chunks.slice(i, i + batchSize);
    const texts = batchChunks.map(c => formatCodeForEmbedding(c, config));
    const output = await extractor!(texts, { pooling: 'mean', normalize: true });
    const dims = output.dims;
    const embeddingDim = dims ? dims[dims.length - 1] : 384;

    for (let j = 0; j < batchChunks.length; j++) {
      const start = j * embeddingDim;
      const embedding = Array.from(output.data.slice(start, start + embeddingDim));
      yield { chunk: batchChunks[j], embedding };
    }
  }
}

export function formatCodeForEmbedding(chunk: CodeChunk, config: AstraConfig): string {
  if (chunk.chunkType === 'metadata') {
    return chunk.content;
  }

  const parts: string[] = [];

  for (const entity of chunk.entities) {
    parts.push(`[${entity.type}] ${entity.signature}`);
  }

  const maxChars = config.maxBodyChars;

  if (parts.length > 0) {
    return parts.join('\n') + '\n\n' + truncateAtLineBoundary(chunk.content, maxChars);
  }

  return truncateAtLineBoundary(chunk.content, maxChars);
}
