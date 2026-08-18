import { Action } from '../src/core/actions';
import { LinesBuffer } from '../src/core/buffer';
import { clampCursor, firstNonBlank } from '../src/core/cursor';
import { VimEngine, VimState, createState, describePending } from '../src/core/engine';
import { DEFAULT_LEADER } from '../src/core/keys';
import { RemapConfiguration, RemapTable } from '../src/core/remap';
import { SearchStyle } from '../src/core/search';
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
  /** Cursor rendered as `line:character`, handy in assertions. */
  readonly at: string;
  /** VS Code commands the engine asked for, in order. */
  readonly commands: readonly string[];
  /** Indent requests the engine made, in order. */
  readonly indents: readonly IndentRequest[];
  /** Messages the engine asked the editor to show, in order. */
  readonly messages: readonly string[];
  /** Find-widget requests, under the `editorFind` search style. */
  readonly finds: readonly FindRequest[];
  /** Half-typed sequence still being held, as the status bar would render it. */
  readonly pending: string;
}

/**
 * What `>` and `<` asked for.
 *
 * The text is deliberately left untouched. How far a line moves is VS Code's
 * decision — the step width, tabs versus spaces and the language's settings all
 * live there — so a harness that shifted the string by a number of its own
 * choosing would be describing something the editor never does. Recording the
 * request keeps the tests about what the core actually decides: which lines, in
 * which direction, how many steps.
 */
export interface FindRequest {
  readonly request: 'open' | 'next' | 'previous';
  readonly count: number;
  readonly seed?: Range;
}

export interface IndentRequest {
  readonly startLine: number;
  readonly endLine: number;
  readonly direction: 'in' | 'out';
  readonly levels: number;
}

export interface RunOptions {
  readonly cursor?: Position;
  /** Which search to exercise. Defaults to the extension's own. */
  readonly search?: SearchStyle;
  readonly eol?: string;
  readonly mode?: Mode;
  readonly remaps?: RemapConfiguration;
}

interface Editor {
  text: string;
  eol: string;
  cursor: Position;
  anchor: Position | null;
  state: VimState;
  commands: string[];
  indents: IndentRequest[];
  messages: string[];
  finds: FindRequest[];
}

export function run(initial: string, keys: string, options: RunOptions = {}): Session {
  const engine = new VimEngine();
  if (options.search) engine.setSearchStyle(options.search);
  let leader = DEFAULT_LEADER;
  if (options.remaps) {
    const { table, problems } = RemapTable.from(options.remaps);
    if (problems.length > 0) throw new Error(`invalid remaps in test: ${problems.join(' / ')}`);
    engine.setRemaps(table);
    leader = table.leader;
  }

  const cursor = options.cursor ?? pos(0, 0);
  const editor: Editor = {
    text: initial,
    eol: options.eol ?? '\n',
    cursor,
    anchor: null,
    state: createState(options.mode ?? 'normal', cursor),
    commands: [],
    indents: [],
    messages: [],
    finds: []
  };

  for (const key of tokenize(keys)) {
    feed(engine, editor, key, false);
  }

  return {
    text: editor.text,
    cursor: editor.cursor,
    mode: editor.state.mode,
    at: `${editor.cursor.line}:${editor.cursor.character}`,
    commands: editor.commands,
    indents: editor.indents,
    messages: editor.messages,
    finds: editor.finds,
    pending: describePending(editor.state, leader)
  };
}

/**
 * Feeds one key, then any keys a remap expanded to. The expansion is replayed
 * through `handleLiteralKey` with the buffer re-read each time, exactly as the
 * VS Code adapter does — `ddp` must see the document as it stands after the
 * delete, and going through the literal path is what keeps remaps non-recursive.
 */
function feed(engine: VimEngine, editor: Editor, key: string, literal: boolean): void {
  const buffer = new LinesBuffer(editor.text, editor.eol);
  const result = literal
    ? engine.handleLiteralKey(editor.state, key, buffer, editor.cursor)
    : engine.handleKey(editor.state, key, buffer, editor.cursor);

  if (result.handled) {
    apply(editor, result);
  } else {
    // Insert mode: the adapter would hand this to VS Code's own `type`.
    typeLiterally(editor, key);
  }

  for (const replayed of result.replay ?? []) {
    feed(engine, editor, replayed, true);
  }
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
    else if (action.type === 'executeCommand') editor.commands.push(action.command);
    else if (action.type === 'indent') {
      const { startLine, endLine, direction, levels } = action;
      editor.indents.push({ startLine, endLine, direction, levels });
    } else if (action.type === 'notify') editor.messages.push(action.message);
    else if (action.type === 'find') {
      const { request, count, seed } = action;
      editor.finds.push(seed === undefined ? { request, count } : { request, count, seed });
    }
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
