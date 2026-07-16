import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { intro, note, outro, text, multiselect, confirm, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { AstraConfigSchema } from '@astra/core';

interface InitAnswers {
  directories: string[];
  extensions: string[];
  excludeStandard: boolean;
  extraExcludes: string[];
}

function generateConfig(answers: InitAnswers): string {
  const extMap: Record<string, string> = {
    '.ts': '*.ts',
    '.tsx': '*.tsx',
    '.js': '*.js',
    '.jsx': '*.jsx',
  };

  const globSuffixes = answers.extensions.map(e => extMap[e] || `*${e}`);

  const include: string[] = [];
  if (answers.directories.length === 0 || (answers.directories.length === 1 && answers.directories[0] === '.')) {
    include.push(...globSuffixes.map(s => `**/${s}`));
  } else {
    for (const dir of answers.directories) {
      for (const suffix of globSuffixes) {
        include.push(`${dir}/**/${suffix}`);
      }
    }
  }

  const exclude: string[] = [];
  if (answers.excludeStandard) {
    exclude.push(
      '**/node_modules/**', '**/dist/**', '**/build/**',
      '**/*.test.ts', '**/*.spec.ts', '**/*.d.ts',
    );
  }
  exclude.push(...answers.extraExcludes);

  const defaults = AstraConfigSchema.parse({});
  const config = { ...defaults, include, exclude };

  return JSON.stringify(config, null, 2);
}

function printBanner(): void {
  console.log('');
  console.log(`         ${pico.dim('.')}    ${pico.yellow('*')}    ${pico.dim('.')}    ${pico.yellow('*')}    ${pico.dim('.')}`);
  console.log(`              ${pico.dim('+')}         ${pico.dim('+')}`);
  console.log(`       ${pico.yellow('*')}  ${pico.dim('+')}  ${pico.bold(pico.cyan('A S T R A'))}  ${pico.dim('+')}  ${pico.yellow('*')}`);
  console.log(`              ${pico.dim('+')}         ${pico.dim('+')}`);
  console.log(`         ${pico.yellow('*')}    ${pico.dim('.')}    ${pico.yellow('*')}    ${pico.dim('.')}    ${pico.yellow('*')}`);
  console.log('');
}

export async function initCommand(dir: string = '.'): Promise<void> {
  const targetDir = resolve(dir);
  printBanner();
  intro(pico.cyan('astra init'));

  const configPath = join(targetDir, 'astra.config.json');
  if (existsSync(configPath)) {
    const overwrite = await confirm({
      message: `astra.config.json already exists in ${targetDir}. Overwrite?`,
    });
    if (isCancel(overwrite) || !overwrite) {
      outro('Cancelled');
      return;
    }
  }

  const dirsRaw = await text({
    message: 'Which directories contain your source code? (comma-separated)',
    placeholder: 'src, packages, server, client, common',
    defaultValue: 'src',
    validate: (v) => v.trim().length > 0 ? undefined : 'At least one directory is required',
  });

  if (isCancel(dirsRaw)) { outro('Cancelled'); return; }

  const directories = dirsRaw.split(',').map(d => d.trim()).filter(Boolean);

  const extResult = await multiselect({
    message: 'What file extensions do you want to index?',
    options: [
      { value: '.ts', label: 'TypeScript (.ts)', hint: 'recommended' },
      { value: '.tsx', label: 'TypeScript React (.tsx)' },
      { value: '.js', label: 'JavaScript (.js)' },
      { value: '.jsx', label: 'JavaScript React (.jsx)' },
    ],
    required: true,
  });

  if (isCancel(extResult)) { outro('Cancelled'); return; }
  const extensions = extResult as string[];

  const excludeStdResult = await confirm({
    message: 'Exclude standard directories and test files (node_modules, dist, build, *.test.*, *.spec.*, *.d.*)?',
    initialValue: true,
  });

  if (isCancel(excludeStdResult)) { outro('Cancelled'); return; }
  const excludeStandard = excludeStdResult as boolean;

  const extraRaw = await text({
    message: 'Extra exclude patterns? (comma-separated, or leave empty)',
    placeholder: '**/*.test.ts, **/*.generated.ts, **/__tests__/**',
    defaultValue: '',
  });

  if (isCancel(extraRaw)) { outro('Cancelled'); return; }

  const extraExcludes = extraRaw
    ? extraRaw.split(',').map(p => p.trim()).filter(Boolean)
    : [];

  const answers: InitAnswers = { directories, extensions, excludeStandard, extraExcludes };
  const json = generateConfig(answers);

  writeFileSync(configPath, json, 'utf-8');
  note(`Created ${configPath}`, 'Done');
  outro('Run `astra index` to start indexing your codebase.');
}
