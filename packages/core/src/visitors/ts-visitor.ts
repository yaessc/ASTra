import type { CodeEntity } from '../types.js';
import type { EntityHandler } from './types.js';
import { getNodeText, getNodeRange } from '../parser.js';
import { findDocComment } from './doc-comment.js';
import type Parser from 'web-tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

function getSignature(node: SyntaxNode, source: string): string {
  const body = node.childForFieldName('body');
  if (body) {
    return source.slice(node.startIndex, body.startIndex).trim();
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child && (
      child.type === 'class_body' ||
      child.type === 'interface_body' ||
      child.type === 'enum_body' ||
      child.type === 'object_type'
    )) {
      return source.slice(node.startIndex, child.startIndex).trim();
    }
  }

  if (node.type === 'variable_declarator') {
    const value = node.childForFieldName('value');
    if (value) {
      const valueBody = value.childForFieldName('body');
      if (valueBody) {
        return source.slice(node.startIndex, valueBody.startIndex).trim();
      }
    }
  }

  return getNodeText(node, source).trim();
}

function isTopLevel(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === 'program') return true;
    if (
      current.type === 'function_declaration' ||
      current.type === 'method_definition' ||
      current.type === 'arrow_function' ||
      current.type === 'function' ||
      current.type === 'for_statement' ||
      current.type === 'for_in_statement' ||
      current.type === 'for_of_statement' ||
      current.type === 'while_statement' ||
      current.type === 'do_statement' ||
      current.type === 'if_statement' ||
      current.type === 'switch_statement' ||
      current.type === 'try_statement' ||
      current.type === 'catch_clause' ||
      current.type === 'with_statement' ||
      current.type === 'class_body'
    ) return false;
    current = current.parent;
  }
  return true;
}

function extractPatternBindings(patternNode: SyntaxNode, source: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < patternNode.namedChildCount; i++) {
    const child = patternNode.namedChild(i);
    if (!child) continue;
    const t = child.type;
    if (t === 'shorthand_property_identifier_pattern' || t === 'identifier') {
      names.push(getNodeText(child, source));
    } else if (t === 'pair_pattern') {
      const value = child.childForFieldName('value');
      if (value?.type === 'identifier') {
        names.push(getNodeText(value, source));
      } else if (value && (value.type === 'object_pattern' || value.type === 'array_pattern')) {
        names.push(...extractPatternBindings(value, source));
      } else if (value && value.type === 'assignment_pattern') {
        const left = value.childForFieldName('left');
        if (left?.type === 'identifier' || left?.type === 'shorthand_property_identifier_pattern') {
          names.push(getNodeText(left, source));
        } else if (left && (left.type === 'object_pattern' || left.type === 'array_pattern')) {
          names.push(...extractPatternBindings(left, source));
        }
      }
    } else if (t === 'object_assignment_pattern' || t === 'assignment_pattern') {
      const left = child.childForFieldName('left');
      if (left?.type === 'shorthand_property_identifier_pattern' || left?.type === 'identifier') {
        names.push(getNodeText(left, source));
      } else if (left && (left.type === 'object_pattern' || left.type === 'array_pattern')) {
        names.push(...extractPatternBindings(left, source));
      }
    } else if (t === 'rest_pattern') {
      const inner = child.namedChild(0);
      if (inner?.type === 'identifier' || inner?.type === 'shorthand_property_identifier_pattern') {
        names.push(getNodeText(inner, source));
      } else if (inner && (inner.type === 'object_pattern' || inner.type === 'array_pattern')) {
        names.push(...extractPatternBindings(inner, source));
      }
    } else if (t === 'object_pattern' || t === 'array_pattern') {
      names.push(...extractPatternBindings(child, source));
    }
  }
  return names;
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
      signature: getSignature(node, source),
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
      signature: getSignature(node, source),
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
    if (!isTopLevel(node)) return null;

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

    if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
      const bindings = extractPatternBindings(nameNode, source);
      if (bindings.length === 0) return null;
      const isFunc = valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function');
      const entityType: CodeEntity['type'] = isFunc ? 'function' : 'variable';
      const range = getNodeRange(node);
      return bindings.map(name => ({
        type: entityType,
        name,
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        signature: getSignature(node, source),
        code: isFunc && valueNode ? getNodeText(valueNode, source) : getNodeText(node, source),
        docComment,
        language,
      }));
    }

    const name = getNodeText(nameNode, source);

    if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function')) {
      const range = getNodeRange(node);
      return {
        type: 'function',
        name,
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        signature: getSignature(node, source),
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
      signature: getSignature(node, source),
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
      signature: getSignature(node, source),
      code: getNodeText(node, source),
      docComment: '',
      language,
    };
  },

  export_statement(node, source, filePath, language) {
    if (!node.childForFieldName('declaration')) {
      const sourceNode = node.childForFieldName('source');
      const name = sourceNode ? `* from ${getNodeText(sourceNode, source)}` : getSignature(node, source);
      const range = getNodeRange(node);
      return {
        type: 'export',
        name,
        filePath,
        startLine: range.startLine,
        endLine: range.endLine,
        signature: getSignature(node, source),
        code: getNodeText(node, source),
        docComment: '',
        language,
      };
    }
    return null;
  },
};
