import * as vscode from 'vscode';
import { MarkEntry } from '../core/marks';
import { MARK_ICON_COLORS, isDrawableMark, markIconUri } from './markIcon';

/**
 * Draws marks in the gutter, one letter per marked line.
 *
 * A decoration type is created per letter and reused, because VS Code identifies
 * a decoration by its type: creating a fresh one on every keystroke would leak
 * and make old icons linger. They are built lazily, so a session that never uses
 * marks creates nothing.
 */
export class MarkDecorations {
  private readonly types = new Map<string, vscode.TextEditorDecorationType>();
  /** What is currently drawn, so an unchanged set of marks costs one comparison. */
  private rendered = '';

  public render(editor: vscode.TextEditor, marks: readonly MarkEntry[], enabled: boolean): void {
    const drawable = enabled ? marks.filter(mark => isDrawableMark(mark.name)) : [];
    const signature = `${editor.document.uri.toString()}|${drawable
      .map(mark => `${mark.name}:${mark.position.line}`)
      .join(',')}`;

    if (signature === this.rendered) return;
    this.rendered = signature;

    const lines = new Map<string, vscode.Range[]>();
    for (const mark of drawable) {
      const line = Math.min(mark.position.line, editor.document.lineCount - 1);
      const at = new vscode.Range(line, 0, line, 0);
      lines.set(mark.name, [...(lines.get(mark.name) ?? []), at]);
    }

    // Every known letter is assigned, including the ones with no ranges left:
    // that is what clears a mark the user has moved or a buffer they left.
    for (const [name, type] of this.types) {
      editor.setDecorations(type, lines.get(name) ?? []);
    }
    for (const [name, ranges] of lines) {
      if (this.types.has(name)) continue;
      const type = this.createType(name);
      this.types.set(name, type);
      editor.setDecorations(type, ranges);
    }
  }

  /** Forgets what was drawn, so the next render repaints from scratch. */
  public invalidate(): void {
    this.rendered = '';
  }

  private createType(name: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      light: { gutterIconPath: vscode.Uri.parse(markIconUri(name, MARK_ICON_COLORS.light)) },
      dark: { gutterIconPath: vscode.Uri.parse(markIconUri(name, MARK_ICON_COLORS.dark)) },
      gutterIconSize: 'contain'
    });
  }

  public dispose(): void {
    for (const type of this.types.values()) type.dispose();
    this.types.clear();
  }
}
