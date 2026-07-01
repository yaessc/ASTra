import type { CodeEntity, SupportedLanguage } from '../types.js';
import type Parser from 'web-tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

export type EntityHandler = (
  node: SyntaxNode,
  source: string,
  filePath: string,
  language: SupportedLanguage,
) => CodeEntity | CodeEntity[] | null;
