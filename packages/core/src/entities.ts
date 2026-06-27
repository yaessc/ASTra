import Parser from 'web-tree-sitter';
import type { CodeEntity, SupportedLanguage } from './types.js';

type SyntaxNode = Parser.SyntaxNode;
import { parseFile, getNodeText, getNodeRange } from './parser.js';

function findDocComment(node: SyntaxNode, source: string): string {
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
      if (child && child.endIndex === node.startIndex && (child.type === 'comment' || child.type === 'block_comment')) {
        const text = getNodeText(child, source);
        if (text.startsWith('/**') || text.startsWith('///')) {
          return text;
        }
      }
    }
  }
  return '';
}

function extractFunction(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, source);
  const range = getNodeRange(node);
  const signature = getNodeText(node, source).split('\n')[0].trim();
  const docComment = findDocComment(node, source);

  return {
    type: 'function',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature,
    code: getNodeText(node, source),
    docComment,
    language,
  };
}

function extractMethod(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, source);
  const range = getNodeRange(node);
  const signature = getNodeText(node, source).split('\n')[0].trim();
  const docComment = findDocComment(node, source);

  return {
    type: 'method',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature,
    code: getNodeText(node, source),
    docComment,
    language,
  };
}

function extractClass(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, source);
  const range = getNodeRange(node);
  const signature = getNodeText(node, source).split('\n')[0].trim();
  const docComment = findDocComment(node, source);

  return {
    type: 'class',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature,
    code: getNodeText(node, source),
    docComment,
    language,
  };
}

function extractInterface(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, source);
  const range = getNodeRange(node);
  const signature = getNodeText(node, source).split('\n')[0].trim();
  const docComment = findDocComment(node, source);

  return {
    type: 'interface',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature,
    code: getNodeText(node, source),
    docComment,
    language,
  };
}

function extractTypeAlias(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, source);
  const range = getNodeRange(node);
  const signature = getNodeText(node, source).split('\n')[0].trim();

  return {
    type: 'type',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature,
    code: getNodeText(node, source),
    docComment: '',
    language,
  };
}

function extractEnum(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, source);
  const range = getNodeRange(node);

  return {
    type: 'enum',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature: getNodeText(node, source).split('\n')[0].trim(),
    code: getNodeText(node, source),
    docComment: '',
    language,
  };
}

function extractDecorator(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity | null {
  const name = getNodeText(node, source).split(/\s/)[0];
  const range = getNodeRange(node);

  return {
    type: 'decorator',
    name,
    filePath,
    startLine: range.startLine,
    endLine: range.endLine,
    signature: getNodeText(node, source).trim(),
    code: getNodeText(node, source),
    docComment: '',
    language,
  };
}

function collectEntities(node: SyntaxNode, source: string, filePath: string, language: SupportedLanguage): CodeEntity[] {
  const entities: CodeEntity[] = [];

  function walk(n: SyntaxNode) {
    const type = n.type;

    if (type === 'function_declaration' || type === 'arrow_function') {
      const e = extractFunction(n, source, filePath, language);
      if (e) entities.push(e);
    } else if (type === 'method_definition') {
      const e = extractMethod(n, source, filePath, language);
      if (e && e.name !== 'constructor') entities.push(e);
    } else if (type === 'class_declaration') {
      const e = extractClass(n, source, filePath, language);
      if (e) entities.push(e);
    } else if (type === 'interface_declaration') {
      const e = extractInterface(n, source, filePath, language);
      if (e) entities.push(e);
    } else if (type === 'type_alias_declaration') {
      const e = extractTypeAlias(n, source, filePath, language);
      if (e) entities.push(e);
    } else if (type === 'enum_declaration') {
      const e = extractEnum(n, source, filePath, language);
      if (e) entities.push(e);
    } else if (type === 'decorator') {
      const e = extractDecorator(n, source, filePath, language);
      if (e) entities.push(e);
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i);
      if (child) walk(child);
    }
  }

  walk(node);
  return entities;
}

export function extractEntities(source: string, filePath: string, language: SupportedLanguage): CodeEntity[] {
  const { tree } = parseFile(source, language);
  return collectEntities(tree.rootNode, source, filePath, language);
}
