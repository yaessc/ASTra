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

describe('multi-line signatures', () => {
  it('function signature spans full declaration header with newlines preserved', () => {
    const source = 'function foo(\n  a: string,\n  b: number\n): Promise<Result> {\n  return x;\n}';
    const node = firstNodeOfType(source, 'function_declaration');
    const entity = tsHandlers.function_declaration(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.signature).toBe('function foo(\n  a: string,\n  b: number\n): Promise<Result>');
  });

  it('class signature includes heritage clauses', () => {
    const source = 'class Foo extends Bar implements Baz { prop: string; }';
    const node = firstNodeOfType(source, 'class_declaration');
    const entity = tsHandlers.class_declaration(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.signature).toBe('class Foo extends Bar implements Baz');
  });

  it('arrow function assignment signature omits body', () => {
    const source = 'const fn = (a: string, b: number): void => { return; };';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.signature).toBe('fn = (a: string, b: number): void =>');
  });

  it('multiline import preserves full text via fallback path', () => {
    const source = 'import {\n  foo,\n  bar,\n} from "./module";';
    const node = firstNodeOfType(source, 'import_statement');
    const entity = tsHandlers.import_statement(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.signature).toBe(source);
  });
});

describe('destructuring with rename and default', () => {
  it('renamed destructuring with default extracts binding name', () => {
    const source = 'const { a: b = 1 } = obj;';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    const arr = entities as any[];
    expect(arr).toHaveLength(1);
    expect(arr[0].name).toBe('b');
  });

  it('renamed nested destructuring with default extracts inner bindings', () => {
    const source = 'const { a: { b } = {} } = obj;';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    const arr = entities as any[];
    expect(arr).toHaveLength(1);
    expect(arr[0].name).toBe('b');
  });

  it('renamed array destructuring with default extracts all bindings', () => {
    const source = 'const { a: [b, c] = [] } = obj;';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entities = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    const arr = entities as any[];
    expect(arr).toHaveLength(2);
    expect(arr[0].name).toBe('b');
    expect(arr[1].name).toBe('c');
  });
});

describe('scope filtering for variables', () => {
  it('module-level const variable is indexed', () => {
    const source = 'const x = 1;';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    expect(entity).not.toBeNull();
    expect(entity.type).toBe('variable');
    expect(entity.name).toBe('x');
  });

  it('const inside function body is skipped', () => {
    const source = 'function f() { const x = 1; }';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
    expect(entity).toBeNull();
  });

  it('for loop variable is skipped', () => {
    const source = 'for (let i = 0; i < n; i++) {}';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript');
    expect(entity).toBeNull();
  });

  it('module-level arrow function assignment is still indexed as function', () => {
    const source = 'const fn = () => { return 1; };';
    const node = firstNodeOfType(source, 'variable_declarator');
    const entity = tsHandlers.variable_declarator(node, source, 'a.ts', 'typescript') as any;
    expect(entity).not.toBeNull();
    expect(entity.type).toBe('function');
    expect(entity.name).toBe('fn');
  });

  it('class field is indexed with type field', () => {
    const source = 'class Foo { bar = 1; }';
    const node = firstNodeOfType(source, 'public_field_definition');
    const entity = tsHandlers.public_field_definition(node, source, 'a.ts', 'typescript') as any;
    expect(entity?.type).toBe('field');
    expect(entity?.name).toBe('bar');
    expect(entity?.signature).toBe('bar = 1');
  });
});
