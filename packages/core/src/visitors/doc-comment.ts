import { getNodeText } from '../parser.js';
import type Parser from 'web-tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

export function findDocComment(node: SyntaxNode, source: string): string {
  let target: SyntaxNode = node;
  while (target.parent && target.parent.type === 'export_statement') {
    target = target.parent;
  }

  let current = target.previousSibling;
  let boundary = target;
  while (current) {
    const gap = source.slice(current.endIndex, boundary.startIndex);
    if (!/^\s*$/.test(gap)) break;

    if (current.type === 'comment' || current.type === 'block_comment') {
      const text = getNodeText(current, source);
      if (text.startsWith('/**') || text.startsWith('///')) {
        return text;
      }
    } else {
      break;
    }
    boundary = current;
    current = current.previousSibling;
  }
  return '';
}
