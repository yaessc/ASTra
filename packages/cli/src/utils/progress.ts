import cliProgress from 'cli-progress';

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
