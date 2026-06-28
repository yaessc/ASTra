import type { AstraConfig, CodeChunk } from './types.js';

let extractor: any = null;

export async function initEmbedder(
  config: AstraConfig,
  onProgress?: (progress: any) => void,
): Promise<void> {
  if (extractor) return;
  const { pipeline } = await import('@xenova/transformers');
  extractor = await pipeline('feature-extraction', config.modelId, {
    progress_callback: onProgress,
  });
}

export async function embedText(text: string, config: AstraConfig): Promise<number[]> {
  if (!extractor) await initEmbedder(config);
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data as Float32Array);
}

export async function embedBatch(
  texts: string[],
  config: AstraConfig,
  onProgress?: (loaded: number, total: number) => void,
): Promise<number[][]> {
  if (!extractor) await initEmbedder(config);

  const results: number[][] = [];
  const batchSize = 16;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const outputs = await Promise.all(
      batch.map(t => extractor(t, { pooling: 'mean', normalize: true })),
    );
    for (const output of outputs) {
      results.push(Array.from(output.data as Float32Array));
    }
    if (onProgress) {
      onProgress(Math.min(i + batchSize, texts.length), texts.length);
    }
  }

  return results;
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
    return parts.join('\n') + '\n\n' + chunk.content.slice(0, 3000);
  }

  return chunk.content.slice(0, 3000);
}
