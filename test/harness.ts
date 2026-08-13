import { Action } from '../src/core/actions';
import { LinesBuffer } from '../src/core/buffer';
import { clampCursor, firstNonBlank } from '../src/core/cursor';
import { VimEngine, VimState, createState } from '../src/core/engine';
import { Mode, Position, Range, pos } from '../src/core/types';

/**
 * Drives the engine exactly the way the VS Code adapter does — apply edits, then
 * the mode, then the cursor — but against a plain string. Every behavioural test
 * in this project goes through `run`, so if the harness and the adapter agree on
 * this order, the tests describe what the real editor will do.
 */

export interface Session {
  readonly text: string;
  readonly cursor: Position;
  readonly mode: Mode;
  /** Column of the cursor rendered as `line:character`, handy in assertions. */
  readonly at: string;
}

export interface RunOptions {
  readonly cursor?: Position;
  readonly eol?: string;
  readonly mode?: Mode;
}

interface Editor {
  text: string;
  eol: string;
  cursor: Position;
  anchor: Position | null;
  state: VimState;
}

export function run(initial: string, keys: string, options: RunOptions = {}): Session {
  const engine = new VimEngine();
  const cursor = options.cursor ?? pos(0, 0);
  const editor: Editor = {
    text: initial,
    eol: options.eol ?? '\n',
    cursor,
    anchor: null,
    state: createState(options.mode ?? 'normal', cursor)
  };

  for (const key of tokenize(keys)) {
    const buffer = new LinesBuffer(editor.text, editor.eol);

    if (key === '<Esc>') {
      apply(editor, engine.escape(editor.state, buffer, editor.cursor));
      continue;
    }

    const result = engine.handleKey(editor.state, key, buffer, editor.cursor);
    if (result.handled) {
      apply(editor, result);
      continue;
    }
    // Insert mode: the adapter would hand this to VS Code's own `type`.
    typeLiterally(editor, key);
  }

  return {
    text: editor.text,
    cursor: editor.cursor,
    mode: editor.state.mode,
    at: `${editor.cursor.line}:${editor.cursor.character}`
  };
}

/** `<Esc>` is the only named key the harness needs; everything else is one character. */
function tokenize(keys: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === '<') {
      const close = keys.indexOf('>', i);
      if (close !== -1) {
        tokens.push(keys.slice(i, close + 1));
        i = close;
        continue;
      }
    }
    tokens.push(keys[i]!);
  }
  return tokens;
}

function apply(editor: Editor, result: { state: VimState; actions: readonly Action[] }): void {
  for (const action of result.actions) {
    if (action.type === 'edit') replaceRange(editor, action.range, action.text);
  }

  editor.state = result.state;

  for (const action of result.actions) {
    if (action.type === 'setCursor') {
      editor.anchor = null;
      editor.cursor = resolveCursor(editor, action.position, action.toFirstNonBlank);
    } else if (action.type === 'setSelection') {
      editor.anchor = action.anchor;
      editor.cursor = resolveCursor(editor, action.active, false);
    }
  }
}

function resolveCursor(editor: Editor, position: Position, toFirstNonBlank: boolean): Position {
  const buffer = new LinesBuffer(editor.text, editor.eol);
  const clamped = clampCursor(buffer, position, editor.state.mode);
  if (!toFirstNonBlank) return clamped;
  return pos(clamped.line, firstNonBlank(buffer, clamped.line));
}

function typeLiterally(editor: Editor, key: string): void {
  replaceRange(editor, { start: editor.cursor, end: editor.cursor }, key);
  editor.cursor = pos(editor.cursor.line, editor.cursor.character + key.length);
}

function replaceRange(editor: Editor, range: Range, text: string): void {
  const start = offsetOf(editor, range.start);
  const end = offsetOf(editor, range.end);
  editor.text = editor.text.slice(0, start) + text + editor.text.slice(end);
}

function offsetOf(editor: Editor, position: Position): number {
  const lines = editor.text.split(editor.eol);
  let offset = 0;
  for (let line = 0; line < position.line && line < lines.length; line++) {
    offset += lines[line]!.length + editor.eol.length;
  }
  const current = lines[Math.min(position.line, lines.length - 1)] ?? '';
  return offset + Math.min(position.character, current.length);
}
