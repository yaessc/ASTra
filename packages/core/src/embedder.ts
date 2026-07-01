import type { AstraConfig, CodeChunk } from './types.js';

interface FeatureExtractor {
  (text: string | string[], options?: { pooling?: string; normalize?: boolean }): Promise<{ data: Float32Array; dims?: number[] }>;
}

let extractor: FeatureExtractor | null = null;
let loadedModelId: string | null = null;

export async function initEmbedder(
  config: AstraConfig,
  onProgress?: (progress: any) => void,
): Promise<void> {
  if (extractor && loadedModelId === config.modelId) return;
  const { pipeline } = await import('@huggingface/transformers');
  extractor = await pipeline('feature-extraction', config.modelId, {
    progress_callback: onProgress,
  }) as unknown as FeatureExtractor;
  loadedModelId = config.modelId;
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
    const texts = batchChunks.map(c => formatCodeForEmbedding(c));
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

function truncateLines(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const end = text.lastIndexOf('\n', maxChars);
  return end > 0 ? text.slice(0, end) : text.slice(0, maxChars);
}

export function formatCodeForEmbedding(chunk: CodeChunk): string {
  if (chunk.chunkType === 'metadata') {
    return chunk.content;
  }

  const parts: string[] = [];

  for (const entity of chunk.entities) {
    parts.push(`[${entity.type}] ${entity.signature}`);
  }

  if (parts.length > 0) {
    return parts.join('\n') + '\n\n' + truncateLines(chunk.content, 3000);
  }

  return truncateLines(chunk.content, 3000);
}
