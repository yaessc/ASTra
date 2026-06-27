import { writeDefaultConfig } from '@scs/core';
import { intro, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import { resolve } from 'node:path';

export function initCommand(dir: string = '.'): void {
  const targetDir = resolve(dir);
  intro(pico.cyan('scs init'));
  writeDefaultConfig(targetDir);
  note(`Created scs.config.json in ${targetDir}`, 'Done');
  outro('Edit scs.config.json to customize paths and settings.');
}
