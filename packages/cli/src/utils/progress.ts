import cliProgress from 'cli-progress';
import pico from 'picocolors';
import type { ModelLoadProgress, AstraConfig } from '@astra/core';

export class ProgressBarManager {
  private bar: cliProgress.SingleBar | null = null;
  private _isRunning = false;

  get isRunning(): boolean {
    return this._isRunning;
  }

  start(
    format: string,
    total: number,
    startValue: number,
    payload?: Record<string, string | number>,
  ): void {
    this.stop();
    this.bar = new cliProgress.SingleBar({
      format,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
      clearOnComplete: true,
    });
    this.bar.start(total, startValue, payload);
    this._isRunning = true;
  }

  update(value: number, payload?: Record<string, string | number>): void {
    if (this.bar && this._isRunning) {
      this.bar.update(value, payload);
    } else {
      console.warn('ProgressBarManager: update() called before start()');
    }
  }

  stop(): void {
    if (this.bar && this._isRunning) {
      this.bar.stop();
    }
    this.bar = null;
    this._isRunning = false;
  }
}

export async function initModelWithProgress(
  config: AstraConfig,
  initFn: (config: AstraConfig, onProgress: (progress: ModelLoadProgress) => void) => Promise<void>,
): Promise<void> {
  const modelBar = new ProgressBarManager();
  let lastFile = '';
  const DOWNLOAD_FMT = `${pico.cyan('Downloading')} ${pico.dim('{file}')} |{bar}| ${pico.green('{percentage}%')} {loadedMb}/{totalMb} MB`;

  try {
    await initFn(config, (progress: ModelLoadProgress) => {
      if (progress.status === 'initiate') {
        lastFile = progress.file || '';
        if (!modelBar.isRunning) {
          modelBar.start(DOWNLOAD_FMT, 100, 0, { file: lastFile, loadedMb: '0.0', totalMb: '0.0' });
        }
      }
      if (progress.status === 'progress' && modelBar.isRunning) {
        const totalMb = ((progress.total ?? 0) / 1024 / 1024).toFixed(1);
        const loadedMb = ((progress.loaded ?? 0) / 1024 / 1024).toFixed(1);
        modelBar.update(progress.progress ?? 0, { file: lastFile, loadedMb, totalMb });
      }
      if (progress.status === 'done' || progress.status === 'ready') {
        modelBar.stop();
      }
    });
  } finally {
    modelBar.stop();
  }
}
