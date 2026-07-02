import {
  loadConfig, verifyIndexIntegrity, repairIndex,
  ConfigValidationError, QdrantConnectionError,
  type IndexVerificationReport,
} from '@astra/core';
import { intro, spinner, note, outro, confirm, isCancel } from '@clack/prompts';
import pico from 'picocolors';
import { resolve } from 'node:path';

function formatReport(report: IndexVerificationReport): string {
  const lines: string[] = [];
  if (report.ok > 0) lines.push(`  ${pico.green('✓')} OK:                    ${pico.green(String(report.ok))}`);
  if (report.missingFromQdrant > 0) lines.push(`  ${pico.yellow('⚠')} Missing from Qdrant: ${pico.yellow(String(report.missingFromQdrant))} (will be re-indexed)`);
  if (report.orphanedInQdrant > 0) lines.push(`  ${pico.yellow('⚠')} Orphaned in Qdrant:   ${pico.yellow(String(report.orphanedInQdrant))} (will be cleaned up)`);
  if (report.mismatched > 0) lines.push(`  ${pico.red('✗')} Count mismatch:       ${pico.red(String(report.mismatched))}`);
  if (report.ok === 0 && report.missingFromQdrant === 0 && report.orphanedInQdrant === 0 && report.mismatched === 0) {
    lines.push(`  ${pico.dim('No indexed files found.')}`);
  }
  return lines.join('\n');
}

export async function verifyCommand(options?: { dir?: string; fix?: boolean }): Promise<void> {
  const rootDir = resolve(options?.dir || '.');
  let config;

  try {
    config = loadConfig(rootDir);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      intro(pico.cyan('astra verify'));
      for (const issue of err.issues) {
        note(issue.message, 'Config Error');
      }
      outro('Fix astra.config.json and re-run.');
      return;
    }
    throw err;
  }

  intro(pico.cyan('astra verify'));

  const s = spinner();
  s.start('Verifying index integrity...');

  try {
    const report = await verifyIndexIntegrity(config, rootDir);
    s.stop('Verification complete');

    console.log('');
    console.log(formatReport(report));
    console.log('');

    const totalIssues = report.missingFromQdrant + report.orphanedInQdrant + report.mismatched;

    if (totalIssues === 0) {
      note('Cache and Qdrant are in sync.', 'Integrity OK');
      outro('Done');
      return;
    }

    if (!options?.fix) {
      note(`Run ${pico.cyan('astra verify --fix')} to repair ${totalIssues} issue(s).`, 'Repair available');
      outro('Done');
      return;
    }

    const proceed = await confirm({
      message: `Repair ${totalIssues} issue(s)? This will delete orphaned Qdrant points and flag missing files for re-index.`,
    });

    if (isCancel(proceed) || !proceed) {
      outro('Cancelled');
      return;
    }

    s.start('Repairing...');
    await repairIndex(config, rootDir);
    s.stop('Repair complete');
    note('Run `astra index` to re-index files that were missing from Qdrant.', 'Next Step');
  } catch (err) {
    s.stop('Verification failed');
    if (err instanceof QdrantConnectionError) {
      note(err.message, 'Qdrant Error');
    } else {
      note(err instanceof Error ? err.message : String(err), 'Error');
    }
  }

  outro('Done');
}
