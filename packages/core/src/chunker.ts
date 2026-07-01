import type { CodeEntity, CodeChunk, SupportedLanguage } from './types.js';

export interface ChunkOptions {
  maxChunkSize: number;
}

const MAX_BODY_LINES = 150;
const MAX_BODY_CHARS = 4000;
const LINES_PER_BODY_CHUNK = 100;
const MIN_META_LENGTH = 10;

function truncateAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const end = text.lastIndexOf('\n', maxChars);
  return end > 0 ? text.slice(0, end) : text.slice(0, maxChars);
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
    const chunks: CodeChunk[] = [];
    const chunkSize = options.maxChunkSize;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize, lines.length);
      chunks.push({
        id: `${filePath}:${i + 1}-${chunkEnd}:body`,
        filePath,
        startLine: i + 1,
        endLine: chunkEnd,
        content: lines.slice(i, chunkEnd).join('\n'),
        entities: [],
        language,
        chunkType: 'body',
      });
    }
    return chunks;
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
        id: `${filePath}:${entity.startLine}-${entity.endLine}:${entity.name}:meta`,
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
        id: `${filePath}:${entity.startLine}-${entity.endLine}:${entity.name}:body`,
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
          id: `${filePath}:${entity.startLine}-${entity.endLine}:${entity.name}:body:${seqIndex}`,
          filePath,
          startLine: chunkStartLine,
          endLine: chunkEndLine,
          content: truncateAtLineBoundary(chunkLines.join('\n'), MAX_BODY_CHARS),
          entities: [entity],
          language,
          chunkType: 'body',
        });
      }
    }
  }

  const covered = new Set<number>();
  for (const entity of entities) {
    for (let l = entity.startLine; l <= entity.endLine; l++) {
      covered.add(l);
    }
  }

  const lineList = fullSource.split('\n');
  const rawRanges: { start: number; end: number }[] = [];
  let rangeStart: number | null = null;
  for (let l = 1; l <= lineList.length; l++) {
    if (!covered.has(l)) {
      if (rangeStart === null) rangeStart = l;
    } else {
      if (rangeStart !== null) {
        rawRanges.push({ start: rangeStart, end: l - 1 });
        rangeStart = null;
      }
    }
  }
  if (rangeStart !== null) {
    rawRanges.push({ start: rangeStart, end: lineList.length });
  }

  const chunkSize = options.maxChunkSize;
  for (const { start, end } of rawRanges) {
    for (let i = start; i <= end; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize - 1, end);
      const content = lineList.slice(i - 1, chunkEnd).join('\n');
      if (content.trim().length === 0) continue;
      chunks.push({
        id: `${filePath}:${i}-${chunkEnd}:body`,
        filePath,
        startLine: i,
        endLine: chunkEnd,
        content,
        entities: [],
        language,
        chunkType: 'body',
      });
    }
  }

  return chunks;
}

export function computeChunkId(
  filePath: string,
  startLine: number,
  endLine: number,
  name?: string,
  chunkType?: 'metadata' | 'body',
  seqIndex?: number,
): string {
  let id = `${filePath}:${startLine}-${endLine}`;
  if (name) id += `:${name}`;
  if (chunkType === 'metadata') {
    id += ':meta';
  } else if (chunkType === 'body') {
    id += seqIndex !== undefined ? `:body:${seqIndex}` : ':body';
  }
  return id;
}
