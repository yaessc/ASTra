import type { CodeEntity, CodeChunk, SupportedLanguage } from './types.js';

export interface ChunkOptions {
  maxChunkSize: number;
}

export function chunkEntities(
  entities: CodeEntity[],
  filePath: string,
  fullSource: string,
  language: SupportedLanguage,
  options: ChunkOptions,
): CodeChunk[] {
  if (entities.length === 0) {
    const lines = fullSource.split('\n');
    const chunk: CodeChunk = {
      id: `${filePath}:1-${lines.length}`,
      filePath,
      startLine: 1,
      endLine: lines.length,
      content: fullSource.slice(0, 2000),
      entities: [],
      language,
    };
    return [chunk];
  }

  entities.sort((a, b) => a.startLine - b.startLine);

  const chunks: CodeChunk[] = [];
  let currentGroup: CodeEntity[] = [];

  function flush() {
    if (currentGroup.length === 0) return;
    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];
    const content = currentGroup.map(e => e.code).join('\n\n');

    chunks.push({
      id: `${filePath}:${first.startLine}-${last.endLine}`,
      filePath,
      startLine: first.startLine,
      endLine: last.endLine,
      content,
      entities: [...currentGroup],
      language,
    });
    currentGroup = [];
  }

  for (const entity of entities) {
    if (currentGroup.length > 0) {
      const last = currentGroup[currentGroup.length - 1];
      const gapLines = entity.startLine - last.endLine;
      if (gapLines > 5 || currentGroup.length >= options.maxChunkSize) {
        flush();
      }
    }
    currentGroup.push(entity);
  }
  flush();

  return chunks;
}

export function computeChunkId(filePath: string, startLine: number, endLine: number): string {
  return `${filePath}:${startLine}-${endLine}`;
}
