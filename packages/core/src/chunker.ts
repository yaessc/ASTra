import type { CodeEntity, CodeChunk, SupportedLanguage } from './types.js';

export interface ChunkOptions {
  maxChunkSize: number;
}

const MAX_BODY_LINES = 150;
const MAX_BODY_CHARS = 4000;
const LINES_PER_BODY_CHUNK = 100;
const MIN_META_LENGTH = 10;

export function chunkEntities(
  entities: CodeEntity[],
  filePath: string,
  fullSource: string,
  language: SupportedLanguage,
  _options: ChunkOptions,
): CodeChunk[] {
  if (entities.length === 0) {
    const lines = fullSource.split('\n');
    const chunk: CodeChunk = {
      id: `${filePath}:0-0:body`,
      filePath,
      startLine: 1,
      endLine: lines.length,
      content: fullSource.slice(0, 2000),
      entities: [],
      language,
      chunkType: 'body',
    };
    return [chunk];
  }

  entities.sort((a, b) => a.startLine - b.startLine);
  const chunks: CodeChunk[] = [];

  for (const entity of entities) {
    const metaContent = [entity.docComment, entity.signature]
      .filter(Boolean)
      .join('\n')
      .trim();

    if (metaContent.length >= MIN_META_LENGTH) {
      chunks.push({
        id: `${filePath}:${entity.startLine}-${entity.endLine}:meta`,
        filePath,
        startLine: entity.startLine,
        endLine: entity.endLine,
        content: metaContent,
        entities: [entity],
        language,
        chunkType: 'metadata',
      });
    }

    const bodyLines = entity.code.split('\n');
    const totalLines = bodyLines.length;

    if (totalLines <= MAX_BODY_LINES && entity.code.length <= MAX_BODY_CHARS) {
      chunks.push({
        id: `${filePath}:${entity.startLine}-${entity.endLine}:body`,
        filePath,
        startLine: entity.startLine,
        endLine: entity.endLine,
        content: entity.code,
        entities: [entity],
        language,
        chunkType: 'body',
      });
    } else {
      for (let offset = 0; offset < totalLines; offset += LINES_PER_BODY_CHUNK) {
        const chunkEnd = Math.min(offset + LINES_PER_BODY_CHUNK, totalLines);
        const chunkLines = bodyLines.slice(offset, chunkEnd);
        const chunkStartLine = entity.startLine + offset;
        const chunkEndLine = Math.min(chunkStartLine + LINES_PER_BODY_CHUNK - 1, entity.endLine);
        const seqIndex = Math.floor(offset / LINES_PER_BODY_CHUNK);

        chunks.push({
          id: `${filePath}:${entity.startLine}-${entity.endLine}:body:${seqIndex}`,
          filePath,
          startLine: chunkStartLine,
          endLine: chunkEndLine,
          content: chunkLines.join('\n').slice(0, MAX_BODY_CHARS),
          entities: [entity],
          language,
          chunkType: 'body',
        });
      }
    }
  }

  return chunks;
}

export function computeChunkId(
  filePath: string,
  startLine: number,
  endLine: number,
  chunkType?: 'metadata' | 'body',
  seqIndex?: number,
): string {
  let id = `${filePath}:${startLine}-${endLine}`;
  if (chunkType === 'metadata') {
    id += ':meta';
  } else if (chunkType === 'body') {
    id += seqIndex !== undefined ? `:body:${seqIndex}` : ':body';
  }
  return id;
}
