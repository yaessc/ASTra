import { describe, it, expect, beforeAll } from 'vitest';
import { initLanguages, getParser } from '../languages.js';

beforeAll(async () => {
  await initLanguages();
});

describe('initLanguages', () => {
  it('creates distinct parsers for typescript, tsx, and javascript', () => {
    expect(getParser('typescript')).toBeDefined();
    expect(getParser('tsx')).toBeDefined();
    expect(getParser('javascript')).toBeDefined();

    expect(getParser('javascript')).not.toBe(getParser('tsx'));
    expect(getParser('javascript')).not.toBe(getParser('typescript'));
    expect(getParser('tsx')).not.toBe(getParser('typescript'));
  });

  it('parses plain JavaScript without treating < as JSX', () => {
    const js = getParser('javascript');
    const source = 'const x = a < b && c > d;';
    const tree = js.parse(source);
    const root = tree.rootNode;
    expect(root.type).toBe('program');
    const decl = root.namedChild(0);
    expect(decl?.type).toBe('lexical_declaration');
    tree.delete();
  });

  it('parses .jsx files with JSX expressions (tsx parser)', () => {
    const tsx = getParser('tsx');
    const source = 'const el = <div>hello</div>;';
    const tree = tsx.parse(source);
    expect(tree.rootNode.type).toBe('program');
    tree.delete();
  });

  it('parses TypeScript type annotations (typescript parser)', () => {
    const ts = getParser('typescript');
    const source = 'const x: string = "hello";';
    const tree = ts.parse(source);
    expect(tree.rootNode.type).toBe('program');
    tree.delete();
  });

  it('idempotent — repeated init does not reload parsers', async () => {
    const p1 = getParser('javascript');
    await initLanguages();
    const p2 = getParser('javascript');
    expect(p1).toBe(p2);
  });
});
