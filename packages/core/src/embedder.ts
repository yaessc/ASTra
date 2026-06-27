import type { ScsConfig } from './types.js';

let pipelineFn: ((modelId: string) => any) | null = null;

export async function initEmbedder(config: ScsConfig): Promise<void> {
  const transformers = await import('@xenova/transformers');
  pipelineFn = (modelId: string) => transformers.pipeline('feature-extraction', modelId);
}

export async function embedText(text: string, config: ScsConfig): Promise<number[]> {
  if (!pipelineFn) await initEmbedder(config);

  const extractor = await pipelineFn!(config.modelId);
  const result = await extractor(text, { pooling: 'mean', normalize: true });

  return Array.from(result.data as Float32Array);
}

export async function embedBatch(texts: string[], config: ScsConfig): Promise<number[][]> {
  if (!pipelineFn) await initEmbedder(config);

  const extractor = await pipelineFn!(config.modelId);

  const results: number[][] = [];
  const batchSize = 16;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const outputs = await Promise.all(
      batch.map(t => extractor(t, { pooling: 'mean', normalize: true }))
    );
    for (const output of outputs) {
      results.push(Array.from(output.data as Float32Array));
    }
  }

  return results;
}

export function formatCodeForEmbedding(chunk: { content: string; filePath: string; entities: { type: string; name: string; signature: string }[] }): string {
  const parts: string[] = [];

  for (const entity of chunk.entities) {
    parts.push(`[${entity.type}] ${entity.signature}`);
  }

  if (parts.length > 0) {
    return parts.join('\n') + '\n\n' + chunk.content.slice(0, 3000);
  }

  return chunk.content.slice(0, 3000);
}
