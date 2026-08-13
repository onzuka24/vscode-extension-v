import { TextBuffer, lastLine, lineLength } from './buffer';
import { Position, pos } from './types';

/**
 * Character-level traversal of a buffer. The line break is addressable as a real
 * position (the column just past the last character), which is what lets word
 * motions and bracket matching walk across lines without special-casing them.
 */

export const NEWLINE = '\n';

const KEYWORD = /[\p{L}\p{N}_]/u;

export type CharClass = 'blank' | 'word' | 'punct';

export function charAt(buffer: TextBuffer, position: Position): string {
  if (position.line < 0 || position.line >= buffer.lineCount) return '';
  const text = buffer.lineAt(position.line);
  return position.character >= text.length ? NEWLINE : text[position.character]!;
}

/** `big` selects Vim's WORD class, where everything non-blank counts as one word. */
export function classOf(char: string, big = false): CharClass {
  if (char === '' || char === NEWLINE || /\s/.test(char)) return 'blank';
  if (big) return 'word';
  return KEYWORD.test(char) ? 'word' : 'punct';
}

export function nextPosition(buffer: TextBuffer, position: Position): Position | null {
  if (position.character < lineLength(buffer, position.line)) {
    return pos(position.line, position.character + 1);
  }
  if (position.line < lastLine(buffer)) return pos(position.line + 1, 0);
  return null;
}

export function previousPosition(buffer: TextBuffer, position: Position): Position | null {
  if (position.character > 0) return pos(position.line, position.character - 1);
  if (position.line > 0) return pos(position.line - 1, lineLength(buffer, position.line - 1));
  return null;
}

export function isEmptyLine(buffer: TextBuffer, position: Position): boolean {
  return position.character === 0 && lineLength(buffer, position.line) === 0;
}
