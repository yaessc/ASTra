import { describe, it, expect } from 'vitest';
import { findDocComment } from '../visitors/doc-comment.js';

type MockNode = {
  type: string;
  startIndex: number;
  endIndex: number;
  previousSibling: MockNode | null;
  nextSibling: MockNode | null;
  parent: MockNode | null;
};

function mock(
  type: string,
  startIndex: number,
  endIndex: number,
  extras?: Partial<Pick<MockNode, 'previousSibling' | 'nextSibling' | 'parent'>>,
): MockNode {
  return { type, startIndex, endIndex, previousSibling: null, nextSibling: null, parent: null, ...extras };
}

describe('findDocComment', () => {
  it('returns JSDoc directly before the declaration', () => {
    const jsdoc = '/** Does foo */';
    const decl = 'export function foo() {}';
    const source = `${jsdoc}\n${decl}`;
    const target = mock('export_statement', jsdoc.length + 1, source.length);
    const comment = mock('comment', 0, jsdoc.length, { nextSibling: target });
    target.previousSibling = comment;
    expect(findDocComment(target, source)).toBe(jsdoc);
  });

  it('finds JSDoc through a // comment between JSDoc and declaration', () => {
    const jsdoc = '/** Does foo */';
    const mid = '// some note';
    const decl = 'export function foo() {}';
    const source = `${jsdoc}\n${mid}\n${decl}`;
    const target = mock('export_statement', jsdoc.length + mid.length + 2, source.length);
    const midComment = mock('comment', jsdoc.length + 1, jsdoc.length + mid.length + 1, { nextSibling: target });
    const jsdocComment = mock('comment', 0, jsdoc.length, { nextSibling: midComment });
    target.previousSibling = midComment;
    midComment.previousSibling = jsdocComment;
    expect(findDocComment(target, source)).toBe(jsdoc);
  });

  it('finds JSDoc through multiple intervening comment types', () => {
    const jsdoc = '/** Does foo */';
    const block = '/* regular */';
    const line = '// note';
    const decl = 'export function foo() {}';
    const source = `${jsdoc}\n${block}\n${line}\n${decl}`;
    const target = mock('export_statement', jsdoc.length + block.length + line.length + 3, source.length);
    const lineC = mock('comment', jsdoc.length + block.length + 2, jsdoc.length + block.length + line.length + 2, { nextSibling: target });
    const blockC = mock('block_comment', jsdoc.length + 1, jsdoc.length + block.length + 1, { nextSibling: lineC });
    const jsdocC = mock('comment', 0, jsdoc.length, { nextSibling: blockC });
    target.previousSibling = lineC;
    lineC.previousSibling = blockC;
    blockC.previousSibling = jsdocC;
    expect(findDocComment(target, source)).toBe(jsdoc);
  });

  it('returns empty when non-comment code sits between JSDoc and declaration', () => {
    const jsdoc = '/** A */';
    const code = 'const x = 1';
    const decl = 'export function foo() {}';
    const source = `${jsdoc}\n${code}\n${decl}`;
    const target = mock('export_statement', jsdoc.length + code.length + 2, source.length);
    const stmt = mock('lexical_declaration', jsdoc.length + 1, jsdoc.length + code.length + 1, { nextSibling: target });
    target.previousSibling = stmt;
    expect(findDocComment(target, source)).toBe('');
  });

  it('returns empty when no JSDoc is present', () => {
    const text = '// regular comment';
    const decl = 'function foo() {}';
    const source = `${text}\n${decl}`;
    const target = mock('function_declaration', text.length + 1, source.length);
    const comment = mock('comment', 0, text.length, { nextSibling: target });
    target.previousSibling = comment;
    expect(findDocComment(target, source)).toBe('');
  });

  it('returns /// comment before declaration', () => {
    const text = '/// doc';
    const decl = 'function foo() {}';
    const source = `${text}\n${decl}`;
    const target = mock('function_declaration', text.length + 1, source.length);
    const comment = mock('comment', 0, text.length, { nextSibling: target });
    target.previousSibling = comment;
    expect(findDocComment(target, source)).toBe(text);
  });

  it('walks up past export_statement parent to find JSDoc', () => {
    const jsdoc = '/** Does foo */';
    const decl = 'export function foo() {}';
    const source = `${jsdoc}\n${decl}`;
    const fn = mock('function_declaration', jsdoc.length + 1, source.length);
    const exportStmt = mock('export_statement', jsdoc.length + 1, source.length, { parent: null });
    fn.parent = exportStmt;
    const comment = mock('comment', 0, jsdoc.length, { nextSibling: exportStmt });
    exportStmt.previousSibling = comment;
    expect(findDocComment(fn, source)).toBe(jsdoc);
  });

  it('returns empty when node has no previous siblings', () => {
    const source = 'function foo() {}';
    const fn = mock('function_declaration', 0, source.length);
    expect(findDocComment(fn, source)).toBe('');
  });

  it('stops at non-comment sibling between JSDoc and declaration', () => {
    // Without the else-break in the fix, this would walk past the
    // non-comment sibling and find the JSDoc.
    const comment = '/* unrelated */';
    const code = 'let y = 2';
    const decl = 'function foo() {}';
    const source = `${comment}\n${code}\n${decl}`;
    const target = mock('function_declaration', comment.length + code.length + 2, source.length);
    const stmt = mock('lexical_declaration', comment.length + 1, comment.length + code.length + 1, { nextSibling: target });
    const blockC = mock('block_comment', 0, comment.length, { nextSibling: stmt });
    target.previousSibling = stmt;
    stmt.previousSibling = blockC;
    expect(findDocComment(target, source)).toBe('');
  });
});
