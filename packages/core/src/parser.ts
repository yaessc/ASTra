import Parser from 'web-tree-sitter';
import { getParser } from './languages.js';
import type { SupportedLanguage } from './types.js';

export interface ParseResult {
  tree: Parser.Tree;
  language: SupportedLanguage;
  source: string;
}

export function parseFile(source: string, language: SupportedLanguage): ParseResult {
  const parser = getParser(language);
  const tree = parser.parse(source);
  return { tree, language, source };
}

export function getNodeText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function getNodeRange(node: Parser.SyntaxNode): { startLine: number; endLine: number } {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}

export function truncateAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const end = text.lastIndexOf('\n', maxChars);
  return end > 0 ? text.slice(0, end) : text.slice(0, maxChars);
}
