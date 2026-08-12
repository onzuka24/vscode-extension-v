import * as vscode from 'vscode';
import { Mode } from '../core/types';

const LABELS: Readonly<Record<Mode, string>> = {
  normal: '$(circle-large-outline) NORMAL',
  insert: '$(edit) INSERT',
  visual: '$(selection) VISUAL',
  'visual-line': '$(selection) V-LINE'
};

export class ModeStatusBar {
  private readonly item: vscode.StatusBarItem;

  public constructor() {
    this.item = vscode.window.createStatusBarItem('vimLike.mode', vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Vim Like Mode';
    this.item.tooltip = 'Current Vim Like mode — click to toggle Vim mode';
    this.item.command = 'vimLike.toggleEnabled';
  }

  public update(mode: Mode, options: { visible: boolean; enabled: boolean }): void {
    this.item.text = options.enabled ? LABELS[mode] : '$(circle-slash) VIM OFF';
    this.item.backgroundColor =
      options.enabled && mode === 'normal' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;

    if (options.visible) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  public dispose(): void {
    this.item.dispose();
  }
}
