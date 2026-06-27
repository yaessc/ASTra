import Parser from 'web-tree-sitter';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { SupportedLanguage } from './types.js';

const parsers = new Map<SupportedLanguage, Parser>();
let initialized = false;

const require = createRequire(import.meta.url);

export async function initLanguages(): Promise<void> {
  if (initialized) return;

  await Parser.init();

  const tsGrammarPath = require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
  const tsxGrammarPath = require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm');
  const jsGrammarPath = require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm');

  const [tsLang, tsxLang, jsLang] = await Promise.all([
    Parser.Language.load(tsGrammarPath),
    Parser.Language.load(tsxGrammarPath),
    Parser.Language.load(jsGrammarPath),
  ]);

  const tsParser = new Parser();
  tsParser.setLanguage(tsLang);
  parsers.set('typescript', tsParser);

  const tsxParser = new Parser();
  tsxParser.setLanguage(tsxLang);
  parsers.set('tsx', tsxParser);

  const jsParser = new Parser();
  jsParser.setLanguage(jsLang);
  parsers.set('javascript', jsParser);

  initialized = true;
}

export function getParser(language: SupportedLanguage): Parser {
  const parser = parsers.get(language);
  if (!parser) throw new Error(`Parser for ${language} not initialized`);
  return parser;
}
