import * as vscode from 'vscode';
import { AiPanel, referenceRange } from '../core/aiPanels';
import { isVisual } from '../core/engine';
import { Mode } from '../core/types';
import { DocumentBuffer, toVsRange } from './buffer';
import { readCursor } from './apply';

/**
 * Sends the current line, or the selection, to one of the user's AI panels.
 *
 * The panels' own commands take no arguments: each one reads
 * `editor.selection` and builds a reference from it. So the work here is to put
 * the selection where the reference should point, run the command, and put the
 * selection back. In Visual mode there is already a selection and it is used as
 * it stands.
 */
export type SendOutcome =
  | { readonly kind: 'sent' }
  /** The caret is on a blank line, so there is nothing to point at. */
  | { readonly kind: 'nothing' }
  /**
   * The document has never been saved, so a reference to it points at nothing.
   *
   * Worth stopping here rather than letting the panel's command run. Claude Code
   * builds its mention from `asRelativePath(document.fileName)` without checking
   * whether the document has a path at all, so an untitled buffer yields
   * `@Untitled-1#1` — which looks like a reference and resolves to nothing.
   * Codex takes the other route and silently does nothing for a non-`file` URI.
   * Either way the keystroke appears to have worked and has not.
   */
  | { readonly kind: 'unsaved' }
  /** The command is not there — most likely the panel's extension is not installed. */
  | { readonly kind: 'missing'; readonly command: string; readonly reason: string };

export async function sendToAiPanel(
  editor: vscode.TextEditor,
  mode: Mode,
  panel: AiPanel
): Promise<SendOutcome> {
  if (editor.document.isUntitled) return { kind: 'unsaved' };

  const buffer = new DocumentBuffer(editor.document);
  const selection = editor.selection;
  const selected = isVisual(mode) && !selection.isEmpty
    ? { start: fromVs(selection.start), end: fromVs(selection.end) }
    : null;

  const range = referenceRange(buffer, readCursor(editor, mode), selected);
  if (!range) return { kind: 'nothing' };

  const previous = selection;
  const target = toVsRange(range);
  editor.selection = new vscode.Selection(target.start, target.end);

  try {
    await vscode.commands.executeCommand(panel.command);
  } catch (error) {
    return { kind: 'missing', command: panel.command, reason: String(error) };
  } finally {
    // Restored even when the command failed: a selection this extension put there
    // for one call must not be left behind as though the user had made it. The
    // panel has taken focus by now, so this only changes what is selected.
    editor.selection = previous;
  }

  return { kind: 'sent' };
}

function fromVs(position: vscode.Position): { line: number; character: number } {
  return { line: position.line, character: position.character };
}
