import { TextBuffer, clampLine, lineLength } from './buffer';
import { Mode, Position, pos } from './types';

/**
 * Vim puts the cursor *on* a character, so in Normal mode it can never sit past
 * the last one; VS Code puts the cursor *between* characters and happily lets it
 * rest after the final character of a line. Every difference in how `$`, `x` and
 * `p` behave traces back to that mismatch, so the rule lives here alone and every
 * motion routes through it rather than re-deriving it.
 */
export function clampCursor(buffer: TextBuffer, position: Position, mode: Mode): Position {
  const line = clampLine(buffer, position.line);
  const limit = maxColumn(buffer, line, mode);
  return pos(line, Math.min(Math.max(position.character, 0), limit));
}

/**
 * Where a caret that something else moved has landed, and where the mode says it
 * belongs.
 *
 * A click, an arrow key or a jump to a definition moves the caret without going
 * through this extension, and VS Code will leave it after the last character of a
 * line. Commands are unaffected — every one of them reads the caret back through
 * `clampCursor` first — so what goes wrong is only what is drawn. That still
 * matters: a caret shown after the last character while `i` inserts before it is
 * a caret that lies about what the next keystroke will do.
 */
export interface ExternalCaret {
  /** Where VS Code left it. */
  readonly active: Position;
  /** Where `clampCursor` puts it, which is where the mode has already been applied. */
  readonly clamped: Position;
  /** How many carets there are. More than one means a VS Code feature owns them. */
  readonly caretCount: number;
  /** Whether anything is selected. */
  readonly hasSelection: boolean;
}

/**
 * Whether the caret should be pulled back to `clamped`.
 *
 * The mode is deliberately absent: it is already spent on `clamped`. In Insert
 * mode `clampCursor` allows the column after the last character, so an Insert
 * caret resting there is equal to its clamped position and this returns false
 * without needing to know the mode. A guard for it would look like the rule and
 * decide nothing.
 *
 * The refusal that does decide something is the second one. A caret that is one
 * of several, or that has something selected, belongs to something else — a drag,
 * a find match, a rename, `Cmd+D` — and writing a single collapsed caret over it
 * would take away work this extension never did. Vim's `mouse=a`, which turns a
 * drag into Visual mode, is a separate decision; until it is made, a drag is left
 * exactly as VS Code made it.
 */
export function shouldPullCaretBack(caret: ExternalCaret): boolean {
  if (caret.caretCount > 1 || caret.hasSelection) return false;
  return caret.active.line !== caret.clamped.line || caret.active.character !== caret.clamped.character;
}

/** Highest column the cursor may occupy on `line` in the given mode. */
export function maxColumn(buffer: TextBuffer, line: number, mode: Mode): number {
  const length = lineLength(buffer, line);
  return mode === 'insert' ? length : Math.max(0, length - 1);
}

/** Column of the first non-whitespace character, or 0 for a blank line. */
export function firstNonBlank(buffer: TextBuffer, line: number): number {
  const text = buffer.lineAt(line);
  const index = text.search(/\S/);
  return index === -1 ? 0 : index;
}

/** Leading whitespace of `line`, used to indent lines opened with `o` and `O`. */
export function indentOf(buffer: TextBuffer, line: number): string {
  const text = buffer.lineAt(line);
  return text.slice(0, firstNonBlank(buffer, line));
}
