export type Mode = 'normal' | 'insert';
export type ModeListener = (mode: Mode) => void;

/** Keeps mode transitions independent from the VS Code API. */
export class ModeController {
  private currentMode: Mode;
  private readonly listeners = new Set<ModeListener>();

  public constructor(initialMode: Mode = 'normal') {
    this.currentMode = initialMode;
  }

  public get mode(): Mode {
    return this.currentMode;
  }

  public setMode(nextMode: Mode): void {
    if (nextMode === this.currentMode) return;
    this.currentMode = nextMode;
    for (const listener of this.listeners) listener(nextMode);
  }

  public onDidChange(listener: ModeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
