#!/usr/bin/env node
import pico from 'picocolors';
import { Command } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';
import { queryCommand } from './commands/query.js';
import { statusCommand } from './commands/status.js';
import { resetCommand } from './commands/reset.js';
import { verifyCommand } from './commands/verify.js';

const program = new Command();

program
  .name('astra')
  .description('ASTra — semantic code search, powered by AST parsing and vector embeddings')
  .version(pkg.version);

program
  .command('init')
  .description('Create an ASTra configuration file')
  .argument('[path]', 'Directory for config', '.')
  .action(initCommand);

program
  .command('index')
  .description('Index a codebase for semantic search')
  .argument('[path]', 'Directory to index', '.')
  .action(indexCommand);

program
  .command('query')
  .description('Search with natural language queries')
  .argument('[query]', 'Natural language query (omit for interactive mode)')
  .option('-n, --limit <number>', 'Number of results', '10')
  .option('-m, --mode <type>', 'Search mode: vector | keyword | hybrid', 'hybrid')
  .option('-C, --dir <path>', 'Project root directory', '.')
  .action(queryCommand);

program
  .command('status')
  .description('Show index statistics')
  .option('-C, --dir <path>', 'Project root directory', '.')
  .action(statusCommand);

program
  .command('reset')
  .description('Clear the index and re-index from scratch')
  .option('-C, --dir <path>', 'Project root directory', '.')
  .action(resetCommand);

program
  .command('verify')
  .description('Verify index integrity between cache and Qdrant')
  .option('--fix', 'Repair discrepancies found')
  .option('-C, --dir <path>', 'Project root directory', '.')
  .action(verifyCommand);

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n  ${pico.red('Error:')} ${message}\n`);
  process.exit(1);
});
