import * as vscode from 'vscode';
import { fullWidthSpaceOffsets } from '../core/fullWidthSpace';

/**
 * Outlines full-width spaces in every visible editor.
 *
 * This is independent of modal editing: a stray U+3000 is just as invisible in
 * Insert mode, or with Vim mode switched off.
 */
export class FullWidthSpaceDecorations {
  private readonly type = vscode.window.createTextEditorDecorationType({
    border: '1px dashed',
    borderColor: new vscode.ThemeColor('editorWarning.foreground'),
    borderRadius: '2px',
    // Typing next to a space must not stretch the outline over the new text.
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });

  public render(editors: readonly vscode.TextEditor[], enabled: boolean): void {
    for (const editor of editors) this.renderOne(editor, enabled);
  }

  public renderOne(editor: vscode.TextEditor, enabled: boolean): void {
    if (!enabled) {
      editor.setDecorations(this.type, []);
      return;
    }
    const document = editor.document;
    const ranges = fullWidthSpaceOffsets(document.getText()).map(offset => {
      const start = document.positionAt(offset);
      return new vscode.Range(start, start.translate(0, 1));
    });
    editor.setDecorations(this.type, ranges);
  }

  public dispose(): void {
    this.type.dispose();
  }
}
