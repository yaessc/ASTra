import { describe, it, expect, beforeAll } from 'vitest';
import { initLanguages } from '../languages.js';
import { extractEntities } from '../entities.js';

beforeAll(async () => {
  await initLanguages();
});

describe('export extraction', () => {
  it('export const arrow function -> function entity, not export', () => {
    const source = `export const getUser = (id: string) => {\n  return id;\n};`;
    const entities = extractEntities(source, 'test.ts', 'typescript');
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('function');
    expect(entities[0].name).toBe('getUser');
  });

  it('export class -> class entity, not export', () => {
    const source = `export class Foo {\n  bar() {}\n}`;
    const entities = extractEntities(source, 'test.ts', 'typescript');
    expect(entities).toHaveLength(2);
    expect(entities.every(e => e.type !== 'export')).toBe(true);
    expect(entities.filter(e => e.type === 'class')[0].name).toBe('Foo');
  });

  it('export function -> function entity, not export', () => {
    const source = `export function greet() { return "hi"; }`;
    const entities = extractEntities(source, 'test.ts', 'typescript');
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('function');
  });

  it('barrel re-export -> export entity', () => {
    const source = `export { foo, bar } from './helpers';`;
    const entities = extractEntities(source, 'test.ts', 'typescript');
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('export');
  });

  it('star export -> export entity', () => {
    const source = `export * from './types';`;
    const entities = extractEntities(source, 'test.ts', 'typescript');
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('export');
  });

  it('named re-export without source -> export entity', () => {
    const source = `export { foo, bar };`;
    const entities = extractEntities(source, 'test.ts', 'typescript');
    expect(entities).toHaveLength(1);
    expect(entities[0].type).toBe('export');
  });
});
