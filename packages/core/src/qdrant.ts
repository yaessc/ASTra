import { QdrantClient } from '@qdrant/js-client-rest';
import type { AstraConfig } from './types.js';
import { wrapQdrantError, QdrantConnectionError } from './errors.js';

const clientCache = new Map<string, QdrantClient>();

export function createClient(config: AstraConfig): QdrantClient {
  const existing = clientCache.get(config.qdrantUrl);
  if (existing) return existing;
  try {
    const client = new QdrantClient({ url: config.qdrantUrl });
    clientCache.set(config.qdrantUrl, client);
    return client;
  } catch (err) {
    throw wrapQdrantError(err, config.qdrantUrl);
  }
}

export function clearClientCache(): void {
  clientCache.clear();
}

export async function safeQdrantCall<T>(fn: () => Promise<T>, config: AstraConfig): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
    throw wrapQdrantError(err, config.qdrantUrl);
  }
}
