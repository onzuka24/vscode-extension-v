import * as vscode from 'vscode';
import { Action } from '../core/actions';
import { clampCursor, firstNonBlank } from '../core/cursor';
import { isVisual } from '../core/engine';
import { Mode, Position, comparePositions, pos } from '../core/types';
import { DocumentBuffer, toVsPosition, toVsRange } from './buffer';

/**
 * Carries out what the engine described. The order below is the contract stated
 * in `core/actions.ts` and mirrored by the test harness: edits, then the mode,
 * then the caret — so cursor positions are interpreted against the edited
 * document and clamped under the mode the command ends in.
 */
export async function applyActions(
  editor: vscode.TextEditor,
  actions: readonly Action[],
  onModeChange: (mode: Mode) => void,
  currentMode: Mode
): Promise<void> {
  const edits = actions.filter(isEdit);
  if (edits.length > 0) {
    await editor.edit(builder => {
      for (const action of edits) builder.replace(toVsRange(action.range), action.text);
    });
  }

  for (const action of actions) {
    if (action.type === 'executeCommand') {
      await vscode.commands.executeCommand(action.command);
    } else if (action.type === 'indent') {
      await applyIndent(editor, action);
    }
  }

  let mode = currentMode;
  for (const action of actions) {
    if (action.type === 'setMode') {
      mode = action.mode;
      onModeChange(mode);
    }
  }

  const buffer = new DocumentBuffer(editor.document);
  for (const action of actions) {
    if (action.type === 'setCursor') {
      let position = clampCursor(buffer, action.position, mode);
      if (action.toFirstNonBlank) {
        position = pos(position.line, firstNonBlank(buffer, position.line));
      }
      const vsPosition = toVsPosition(position);
      editor.selection = new vscode.Selection(vsPosition, vsPosition);
    } else if (action.type === 'setSelection') {
      editor.selection = buildSelection(buffer, action.anchor, action.active, action.linewise);
    }
  }

  if (actions.some(action => action.type === 'reveal')) {
    editor.revealRange(new vscode.Range(editor.selection.active, editor.selection.active));
  }
}

function isEdit(action: Action): action is Extract<Action, { type: 'edit' }> {
  return action.type === 'edit';
}

/**
 * `>` and `<` are handed to VS Code so that the step width, tabs versus spaces
 * and the language's own settings decide how far the lines move — none of which
 * the core can know. The commands work on the selection, so the lines are
 * selected first; the caret that follows in `setCursor` replaces that selection,
 * which is also what makes Visual `>` drop the selection the way Vim does.
 */
async function applyIndent(
  editor: vscode.TextEditor,
  action: Extract<Action, { type: 'indent' }>
): Promise<void> {
  const last = Math.min(action.endLine, editor.document.lineCount - 1);
  const first = Math.min(action.startLine, last);
  editor.selection = new vscode.Selection(
    new vscode.Position(first, 0),
    new vscode.Position(last, editor.document.lineAt(last).text.length)
  );

  const command = action.direction === 'in' ? 'editor.action.indentLines' : 'editor.action.outdentLines';
  for (let level = 0; level < action.levels; level++) {
    await vscode.commands.executeCommand(command);
  }
}

/**
 * Vim's Visual selection includes the character under the active end, whereas a
 * VS Code selection stops in front of it. Rendering therefore extends the leading
 * end by one; `readCursor` performs the inverse when handing a position back to
 * the engine.
 */
function buildSelection(
  buffer: DocumentBuffer,
  anchor: Position,
  active: Position,
  linewise: boolean
): vscode.Selection {
  if (linewise) {
    const first = Math.min(anchor.line, active.line);
    const last = Math.max(anchor.line, active.line);
    const top = new vscode.Position(first, 0);
    const bottom = new vscode.Position(last, buffer.lineAt(last).length);
    return anchor.line <= active.line ? new vscode.Selection(top, bottom) : new vscode.Selection(bottom, top);
  }

  const forwards = comparePositions(anchor, active) <= 0;
  const from = forwards ? anchor : extendByOne(buffer, anchor);
  const to = forwards ? extendByOne(buffer, active) : active;
  return new vscode.Selection(toVsPosition(from), toVsPosition(to));
}

function extendByOne(buffer: DocumentBuffer, position: Position): Position {
  const limit = buffer.lineAt(position.line).length;
  return pos(position.line, Math.min(position.character + 1, limit));
}

/**
 * The caret position as Vim understands it. In Visual mode VS Code's active end
 * sits one past the selected character, so it is pulled back before the engine
 * ever sees it.
 */
export function readCursor(editor: vscode.TextEditor, mode: Mode): Position {
  const buffer = new DocumentBuffer(editor.document);
  const selection = editor.selection;
  const active = pos(selection.active.line, selection.active.character);

  if (isVisual(mode) && !selection.isEmpty && selection.active.isAfter(selection.anchor)) {
    return clampCursor(buffer, pos(active.line, active.character - 1), mode);
  }
  return clampCursor(buffer, active, mode);
}
