import { getNodeText } from '../parser.js';
import type Parser from 'web-tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

export function findDocComment(node: SyntaxNode, source: string): string {
  const prev = node.previousSibling;
  if (prev && (prev.type === 'comment' || prev.type === 'block_comment')) {
    const text = getNodeText(prev, source);
    if (text.startsWith('/**') || text.startsWith('///')) {
      return text;
    }
  }
  const parent = node.parent;
  if (parent) {
    for (let i = 0; i < parent.namedChildCount; i++) {
      const child = parent.namedChild(i);
      if (child && (child.type === 'comment' || child.type === 'block_comment')) {
        if (child.endIndex > node.startIndex) continue;
        const gap = source.slice(child.endIndex, node.startIndex);
        if (!/^\s*$/.test(gap)) continue;
        const text = getNodeText(child, source);
        if (text.startsWith('/**') || text.startsWith('///')) {
          return text;
        }
      }
    }
  }
  return '';
}
