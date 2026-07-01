import type Parser from 'web-tree-sitter';
import { parseFile } from './parser.js';
import { getHandlers } from './visitors/index.js';
import type { CodeEntity, SupportedLanguage } from './types.js';

type SyntaxNode = Parser.SyntaxNode;

export function extractEntities(source: string, filePath: string, language: SupportedLanguage): CodeEntity[] {
  const { tree } = parseFile(source, language);
  try {
    const handlers = getHandlers(language);
    const entities: CodeEntity[] = [];

    function walk(n: SyntaxNode) {
      const handler = handlers[n.type];
      if (handler) {
        const result = handler(n, source, filePath, language);
        if (result) {
          if (Array.isArray(result)) entities.push(...result);
          else entities.push(result);
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) walk(child);
      }
    }

    walk(tree.rootNode);
    return entities;
  } finally {
    tree.delete();
  }
}
