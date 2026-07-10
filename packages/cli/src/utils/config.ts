import { loadConfig, ConfigValidationError } from '@astra/core';
import { intro, note, outro } from '@clack/prompts';
import pico from 'picocolors';
import type { AstraConfig } from '@astra/core';

export function loadConfigOrExit(rootDir: string, commandName: string): AstraConfig | undefined {
  try {
    return loadConfig(rootDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan(`astra ${commandName}`));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix astra.config.json and re-run.');
      return undefined;
    }
    throw err;
  }
}
