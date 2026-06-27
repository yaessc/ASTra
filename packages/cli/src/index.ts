#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { indexCommand } from './commands/index-cmd.js';
import { queryCommand } from './commands/query.js';
import { statusCommand } from './commands/status.js';
import { resetCommand } from './commands/reset.js';

const program = new Command();

program
  .name('scs')
  .description('Semantic Code Search — natural language search for your codebase')
  .version('0.1.0');

program
  .command('init')
  .description('Create a default scs.config.json in the specified directory')
  .argument('[path]', 'Directory for config', '.')
  .action(initCommand);

program
  .command('index')
  .description('Index a codebase for semantic search')
  .argument('[path]', 'Directory to index', '.')
  .option('-w, --watch', 'Watch for file changes and re-index')
  .action(indexCommand);

program
  .command('query')
  .description('Search the indexed codebase with a natural language query')
  .argument('[query]', 'Natural language query (omit for interactive mode)')
  .option('-n, --limit <number>', 'Number of results', '10')
  .action(queryCommand);

program
  .command('status')
  .description('Show index statistics')
  .action(statusCommand);

program
  .command('reset')
  .description('Clear the index and re-index from scratch')
  .action(resetCommand);

program.parse();
