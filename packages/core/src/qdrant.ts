import { QdrantClient } from '@qdrant/js-client-rest';
import type { AstraConfig } from './types.js';
import { wrapQdrantError, QdrantConnectionError } from './errors.js';

export function createClient(config: AstraConfig): QdrantClient {
  try {
    return new QdrantClient({ url: config.qdrantUrl });
  } catch (err) {
    throw wrapQdrantError(err, config.qdrantUrl);
  }
}

export async function safeQdrantCall<T>(fn: () => Promise<T>, config: AstraConfig): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof QdrantConnectionError) throw err;
    throw wrapQdrantError(err, config.qdrantUrl);
  }
}
