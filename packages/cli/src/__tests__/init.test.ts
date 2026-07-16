import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  mockText, mockMultiselect, mockConfirm, mockIsCancel,
  mockIntro, mockNote, mockOutro,
} = vi.hoisted(() => ({
  mockText: vi.fn(),
  mockMultiselect: vi.fn(),
  mockConfirm: vi.fn(),
  mockIsCancel: vi.fn(() => false),
  mockIntro: vi.fn(),
  mockNote: vi.fn(),
  mockOutro: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  intro: mockIntro,
  note: mockNote,
  outro: mockOutro,
  text: mockText,
  multiselect: mockMultiselect,
  confirm: mockConfirm,
  isCancel: mockIsCancel,
}));

vi.mock('picocolors', () => ({
  default: {
    cyan: (s: string) => s, yellow: (s: string) => s, green: (s: string) => s,
    red: (s: string) => s, dim: (s: string) => s, bold: (s: string) => s,
  },
}));

import { initCommand } from '../commands/init.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'init-test-'));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('initCommand', () => {
  it('writes config file with user-provided answers', async () => {
    mkdirSync(join(testDir, 'src'));
    mkdirSync(join(testDir, 'lib'));
    mockText.mockResolvedValueOnce('src, lib').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts', '.tsx']);
    mockConfirm.mockResolvedValueOnce(true);

    await initCommand(testDir);

    const configPath = join(testDir, 'astra.config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.include).toContain('src/**/*.ts');
    expect(config.include).toContain('lib/**/*.tsx');
    expect(config.exclude).toContain('**/node_modules/**');
  });

  it('prompts for overwrite when config already exists', async () => {
    writeFileSync(join(testDir, 'astra.config.json'), JSON.stringify({ include: ['old/**/*.ts'], exclude: [] }), 'utf-8');
    mockIsCancel.mockReturnValueOnce(true);

    await initCommand(testDir);

    expect(mockOutro).toHaveBeenCalledWith('Cancelled');
  });

  it('handles single-directory input (.)', async () => {
    mockText.mockResolvedValueOnce('.').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts']);
    mockConfirm.mockResolvedValueOnce(false);

    await initCommand(testDir);

    const config = JSON.parse(readFileSync(join(testDir, 'astra.config.json'), 'utf-8'));
    expect(config.include).toEqual(['**/*.ts']);
  });

  it('handles extra exclude patterns', async () => {
    mkdirSync(join(testDir, 'src'));
    mockText.mockResolvedValueOnce('src').mockResolvedValueOnce('**/*.test.ts, **/__tests__/**');
    mockMultiselect.mockResolvedValueOnce(['.ts']);
    mockConfirm.mockResolvedValueOnce(true);

    await initCommand(testDir);

    const config = JSON.parse(readFileSync(join(testDir, 'astra.config.json'), 'utf-8'));
    expect(config.exclude).toContain('**/*.test.ts');
    expect(config.exclude).toContain('**/__tests__/**');
  });

  it('warns when a referenced directory does not exist', async () => {
    mkdirSync(join(testDir, 'src'));
    mockText.mockResolvedValueOnce('src, nonexistent').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts']);
    mockConfirm.mockResolvedValueOnce(true);

    await initCommand(testDir);

    expect(mockNote).toHaveBeenCalledWith(
      expect.stringContaining('nonexistent'),
      expect.stringContaining('Spelling Warning'),
    );
  });
});

describe('generateConfig', () => {
  it('generates include patterns for multiple directories and extensions', async () => {
    mkdirSync(join(testDir, 'src'));
    mkdirSync(join(testDir, 'lib'));
    mockText.mockResolvedValueOnce('src, lib').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts', '.tsx']);
    mockConfirm.mockResolvedValueOnce(true);

    await initCommand(testDir);

    const config = JSON.parse(readFileSync(join(testDir, 'astra.config.json'), 'utf-8'));
    expect(config.include).toContain('src/**/*.ts');
    expect(config.include).toContain('lib/**/*.ts');
    expect(config.include).toContain('src/**/*.tsx');
  });

  it('includes standard excludes when excludeStandard is true', async () => {
    mkdirSync(join(testDir, 'src'));
    mockText.mockResolvedValueOnce('src').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts']);
    mockConfirm.mockResolvedValueOnce(true);

    await initCommand(testDir);

    const config = JSON.parse(readFileSync(join(testDir, 'astra.config.json'), 'utf-8'));
    expect(config.exclude).toContain('**/node_modules/**');
    expect(config.exclude).toContain('**/dist/**');
    expect(config.exclude).toContain('**/build/**');
  });

  it('omits standard excludes when excludeStandard is false', async () => {
    mkdirSync(join(testDir, 'src'));
    mockText.mockResolvedValueOnce('src').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts']);
    mockConfirm.mockResolvedValueOnce(false);

    await initCommand(testDir);

    const config = JSON.parse(readFileSync(join(testDir, 'astra.config.json'), 'utf-8'));
    expect(config.exclude).not.toContain('**/node_modules/**');
  });

  it('generated config passes loadConfig validation', async () => {
    mkdirSync(join(testDir, 'src'));
    mockText.mockResolvedValueOnce('src').mockResolvedValueOnce('');
    mockMultiselect.mockResolvedValueOnce(['.ts']);
    mockConfirm.mockResolvedValueOnce(true);

    await initCommand(testDir);

    const { loadConfig } = await import('@astra/core');
    expect(() => loadConfig(testDir)).not.toThrow();
  });
});
