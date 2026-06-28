import { beforeAll, describe, it, expect } from 'vitest';
import { initLanguages } from '../../languages.js';
import { parseFile } from '../../parser.js';
import { tsHandlers } from '../ts-visitor.js';

beforeAll(async () => {
  await initLanguages();
});

function firstNodeOfType(source: string, type: string) {
  const { tree } = parseFile(source, 'typescript');
  const results: any[] = [];
  function walk(n: any) {
    if (n.type === type) results.push(n);
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (c) walk(c);
    }
  }
  walk(tree.rootNode);
  return results[0] ?? null;
}

describe('ts-visitor handlers', () => {
  it('variable_declarator with arrow function body emits function entity', () => {
    const source = 'const greet = (name: string) => name;';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
    expect(entity?.name).toBe('greet');
    expect(entity?.type).toBe('function');
  });

  it('export_statement with declaration child returns null', () => {
    const source = 'export class Foo {}';
    const node = firstNodeOfType(source, 'export_statement');
    const entity = tsHandlers.export_statement(node, source, 'a.ts', 'typescript');
    expect(entity).toBeNull();
  });

  it('decorator extracts name from call_expression', () => {
    const source = `@Controller('auth')\nclass AuthController {}`;
    const node = firstNodeOfType(source, 'decorator');
    const entity = tsHandlers.decorator(node, source, 'a.ts', 'typescript');
    expect(entity?.name).toBe('@Controller');
  });
});
