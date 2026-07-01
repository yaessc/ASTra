import type { CodeEntity } from '../types.js';
import type { EntityHandler } from './types.js';
import { getNodeText, getNodeRange } from '../parser.js';
import { findDocComment } from './doc-comment.js';
import type Parser from 'web-tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

function firstLine(node: SyntaxNode, source: string): string {
  return getNodeText(node, source).split('\n')[0].trim();
}

function namedEntity(type: CodeEntity['type']): EntityHandler {
  return (node, source, filePath, language) => {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    const name = getNodeText(nameNode, source);
    const range = getNodeRange(node);
    return {
      type,
      name,
      filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      signature: firstLine(node, source),
      code: getNodeText(node, source),
      docComment: findDocComment(node, source),
      language,
    };
  };
}

export const tsHandlers: Record<string, EntityHandler> = {
  function_declaration: namedEntity('function'),

  method_definition(node, source, filePath, language) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    const name = getNodeText(nameNode, source);
    if (name === 'constructor') return null;
    const range = getNodeRange(node);
    return {
      type: 'method',
      name,
      filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      signature: firstLine(node, source),
      code: getNodeText(node, source),
      docComment: findDocComment(node, source),
      language,
    };
  },

  class_declaration: namedEntity('class'),
  interface_declaration: namedEntity('interface'),
  type_alias_declaration: namedEntity('type'),
  enum_declaration: namedEntity('enum'),

  decorator(node, source, filePath, language) {
    const name = getNodeText(node, source).split(/[(\s]/)[0];
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
  },

  variable_declarator(node, source, filePath, language) {
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');
    if (!nameNode) return null;

    const name = getNodeText(nameNode, source);

    let docNode: SyntaxNode = node;
    let p = node.parent;
    while (p && (
      p.type === 'lexical_declaration' ||
      p.type === 'variable_declaration' ||
      p.type === 'export_statement'
    )) {
      docNode = p;
      p = p.parent;
    }
    const docComment = findDocComment(docNode, source);

    if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function')) {
      const range = getNodeRange(node);
      return {
        type: 'function',
        name,
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        signature: firstLine(node, source),
        code: getNodeText(valueNode, source),
        docComment,
        language,
      };
    }

    const range = getNodeRange(node);
    return {
      type: 'variable',
      name,
      filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      signature: firstLine(node, source),
      code: getNodeText(node, source),
      docComment,
      language,
    };
  },

  import_statement(node, source, filePath, language) {
    const sourceNode = node.childForFieldName('source');
    const name = sourceNode ? getNodeText(sourceNode, source) : '<anonymous>';
    const range = getNodeRange(node);
    return {
      type: 'import',
      name,
      filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      signature: firstLine(node, source),
      code: getNodeText(node, source),
      docComment: '',
      language,
    };
  },

  export_statement(node, source, filePath, language) {
    if (!node.childForFieldName('declaration')) {
      const sourceNode = node.childForFieldName('source');
      const name = sourceNode ? `* from ${getNodeText(sourceNode, source)}` : firstLine(node, source);
      const range = getNodeRange(node);
      return {
        type: 'export',
        name,
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        signature: firstLine(node, source),
        code: getNodeText(node, source),
        docComment: '',
        language,
      };
    }
    return null;
  },
};
