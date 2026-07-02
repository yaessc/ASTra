import type { CodeEntity, CodeChunk, SupportedLanguage } from './types.js';
import { truncateAtLineBoundary } from './parser.js';

export interface ChunkOptions {
  maxChunkSize: number;
  maxBodyLines: number;
  maxBodyChars: number;
  linesPerBodyChunk: number;
  chunkOverlap: number;
}

const MIN_META_LENGTH = 10;

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
      const content = lines.slice(i, chunkEnd).join('\n');
      if (content.trim().length === 0) continue;
      chunks.push({
        id: `${filePath}:${i + 1}-${chunkEnd}:body`,
        filePath,
        startLine: i + 1,
        endLine: chunkEnd,
        content,
        entities: [],
        language,
        chunkType: 'body',
      });
    }
    return chunks;
  }

  const sorted = [...entities].sort((a, b) => a.startLine - b.startLine);
  const chunks: CodeChunk[] = [];

  for (const entity of sorted) {
    const metaContent = [entity.docComment, entity.signature]
      .filter(Boolean)
      .join('\n')
      .trim();

    if (metaContent.length >= MIN_META_LENGTH) {
      chunks.push({
        id: `${filePath}:${entity.startLine}-${entity.endLine}:${entity.name}:${entity.type}:meta`,
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

    if (totalLines <= options.maxBodyLines && entity.code.length <= options.maxBodyChars) {
      chunks.push({
        id: `${filePath}:${entity.startLine}-${entity.endLine}:${entity.name}:${entity.type}:body`,
        filePath,
        startLine: entity.startLine,
        endLine: entity.endLine,
        content: entity.code,
        entities: [entity],
        language,
        chunkType: 'body',
      });
    } else {
      const chunkSize = options.linesPerBodyChunk;
      const overlap = options.chunkOverlap;
      const step = Math.max(1, chunkSize - overlap);
      let seqIndex = 0;
      for (let offset = 0; offset < totalLines; offset += step) {
        const chunkEnd = Math.min(offset + chunkSize, totalLines);
        const chunkLines = bodyLines.slice(offset, chunkEnd);
        const chunkStartLine = entity.startLine + offset;
        const chunkEndLine = Math.min(chunkStartLine + chunkSize - 1, entity.endLine);

        chunks.push({
          id: `${filePath}:${entity.startLine}-${entity.endLine}:${entity.name}:${entity.type}:body:${seqIndex}`,
          filePath,
          startLine: chunkStartLine,
          endLine: chunkEndLine,
          content: truncateAtLineBoundary(chunkLines.join('\n'), options.maxBodyChars),
          entities: [entity],
          language,
          chunkType: 'body',
        });
        seqIndex++;
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
