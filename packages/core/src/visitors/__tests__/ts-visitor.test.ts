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
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.name).toBe('greet');
    expect(entity?.type).toBe('function');
  });

  it('export_statement with declaration child returns null', () => {
    const source = 'export class Foo {}';
    const node = firstNodeOfType(source, 'export_statement');
    const entity = tsHandlers.export_statement(node, source, 'a.ts', 'typescript') as any;
    expect(entity).toBeNull();
  });

  it('decorator extracts name from call_expression', () => {
    const source = `@Controller('auth')\nclass AuthController {}`;
    const node = firstNodeOfType(source, 'decorator');
    const entity = tsHandlers.decorator(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.name).toBe('@Controller');
  });

  it('arrow function with preceding doc comment extracts docComment', () => {
    const source = `/** Greet a user by name */\nconst greet = (name: string) => name;`;
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.docComment).toBe('/** Greet a user by name */');
  });

  it('export const with preceding doc comment extracts docComment', () => {
    const source = `/** Application configuration */\nexport const APP_CONFIG = { port: 3000 };`;
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.docComment).toBe('/** Application configuration */');
  });

  it('export class with preceding doc comment extracts docComment', () => {
    const source = `/** User model */\nexport class User {}`;
    const node = firstNodeOfType(source, 'class_declaration');
    const entity = tsHandlers.class_declaration(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.docComment).toBe('/** User model */');
  });

  it('export function with preceding doc comment extracts docComment', () => {
    const source = `/** Greet a user */\nexport function greet(name: string) {}`;
    const node = firstNodeOfType(source, 'function_declaration');
    const entity = tsHandlers.function_declaration(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.docComment).toBe('/** Greet a user */');
  });

  it('export interface with preceding doc comment extracts docComment', () => {
    const source = `/** API response */\nexport interface ApiResponse {}`;
    const node = firstNodeOfType(source, 'interface_declaration');
    const entity = tsHandlers.interface_declaration(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.docComment).toBe('/** API response */');
  });

  describe('destructuring declarations', () => {
    it('object destructuring emits one entity per binding', () => {
      const source = 'const { query, limit } = options;';
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      expect(Array.isArray(entities)).toBe(true);
      const arr = entities as any[];
      expect(arr).toHaveLength(2);
      expect(arr[0].name).toBe('query');
      expect(arr[0].type).toBe('variable');
      expect(arr[1].name).toBe('limit');
      expect(arr[1].type).toBe('variable');
    });

    it('array destructuring emits one entity per binding', () => {
      const source = 'const [a, b] = arr;';
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      const arr = entities as any[];
      expect(arr).toHaveLength(2);
      expect(arr[0].name).toBe('a');
      expect(arr[1].name).toBe('b');
    });

    it('nested destructuring emits only leaf bindings', () => {
      const source = 'const { a: { b } } = obj;';
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      const arr = entities as any[];
      expect(arr).toHaveLength(1);
      expect(arr[0].name).toBe('b');
    });

    it('destructuring with defaults emits bound names', () => {
      const source = 'const { a = 1 } = obj;';
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      const arr = entities as any[];
      expect(arr).toHaveLength(1);
      expect(arr[0].name).toBe('a');
    });

    it('rest pattern extracts rest identifier', () => {
      const source = 'const [a, ...rest] = arr;';
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      const arr = entities as any[];
      expect(arr).toHaveLength(2);
      expect(arr[0].name).toBe('a');
      expect(arr[1].name).toBe('rest');
    });

    it('empty pattern emits no entities', () => {
      const source = 'const {} = obj;';
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      expect(entities).toBeNull();
    });

    it('destructuring with doc comment propagates to all bindings', () => {
      const source = `/** Query options */\nconst { query, limit } = opts;`;
      const node = firstNodeOfType(source, 'variable_declarator');
      const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
      const arr = entities as any[];
      expect(arr).toHaveLength(2);
      expect(arr[0].docComment).toBe('/** Query options */');
      expect(arr[1].docComment).toBe('/** Query options */');
    });
  });
});
