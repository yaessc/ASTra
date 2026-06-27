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

export function findParent(node: Parser.SyntaxNode | null, type: string): Parser.SyntaxNode | null {
  let current = node?.parent ?? null;
  while (current) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return null;
}
