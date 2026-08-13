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
