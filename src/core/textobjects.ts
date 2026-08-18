import { TextBuffer } from './buffer';
import { charAt, classOf, nextPosition, previousPosition } from './scan';
import { Position, Range, pos, positionsEqual } from './types';

/**
 * Text objects such as `iw` and `a(`. They always produce a characterwise range,
 * so operators consume them through exactly the same path as a motion target.
 */

const PAIRS: Readonly<Record<string, readonly [string, string]>> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
  '<': ['<', '>'],
  '>': ['<', '>']
};

const QUOTES = new Set(['"', "'", '`']);

export function isTextObjectKey(key: string): boolean {
  return key === 'w' || key === 'W' || key in PAIRS || QUOTES.has(key);
}

/** `spec` is a two-character sequence such as `iw` or `a"`. */
export function resolveTextObject(buffer: TextBuffer, cursor: Position, spec: string): Range | null {
  const around = spec[0] === 'a';
  const key = spec[1];
  if (key === undefined) return null;

  if (key === 'w' || key === 'W') return wordObject(buffer, cursor, key === 'W', around);
  if (QUOTES.has(key)) return quoteObject(buffer, cursor, key, around);

  const pair = PAIRS[key];
  return pair ? bracketObject(buffer, cursor, pair[0], pair[1], around) : null;
}

function wordObject(buffer: TextBuffer, cursor: Position, big: boolean, around: boolean): Range | null {
  const text = buffer.lineAt(cursor.line);
  if (text.length === 0) return { start: pos(cursor.line, 0), end: pos(cursor.line, 0) };

  const index = Math.min(cursor.character, text.length - 1);
  const runClass = classOf(text[index]!, big);

  let start = index;
  let end = index;
  while (start > 0 && classOf(text[start - 1]!, big) === runClass) start--;
  while (end + 1 < text.length && classOf(text[end + 1]!, big) === runClass) end++;

  if (around) {
    // `aw` takes the trailing whitespace, falling back to the leading run when
    // the word ends the line — the same rule Vim uses.
    let extended = end;
    while (extended + 1 < text.length && classOf(text[extended + 1]!, big) === 'blank') extended++;
    if (extended === end) {
      while (start > 0 && classOf(text[start - 1]!, big) === 'blank') start--;
    } else {
      end = extended;
    }
  }

  return { start: pos(cursor.line, start), end: pos(cursor.line, end + 1) };
}

function bracketObject(
  buffer: TextBuffer,
  cursor: Position,
  open: string,
  close: string,
  around: boolean
): Range | null {
  const start = scanForUnmatched(buffer, cursor, open, close, 'backward');
  const end = scanForUnmatched(buffer, cursor, open, close, 'forward');
  if (!start || !end) return null;

  if (around) {
    return { start, end: pos(end.line, end.character + 1) };
  }
  return { start: pos(start.line, start.character + 1), end };
}

/**
 * Walks outward to the unmatched bracket in one direction. The cursor's own
 * character is exempt from the depth count so that sitting on either bracket of
 * a pair still selects that pair.
 */
/**
 * The bracket `%` pairs with: the first of `()`, `[]` or `{}` at or after the
 * cursor on its line, matched to its partner. Vim's default `matchpairs` is these
 * three; `<>` is deliberately absent, since `a < b` would pair with anything.
 */
export function matchingBracket(buffer: TextBuffer, from: Position): Position | null {
  const text = buffer.lineAt(from.line);

  for (let index = from.character; index < text.length; index++) {
    const bracket = MATCHED_PAIRS[text[index]!];
    if (!bracket) continue;

    // Scanning from the bracket itself works because `scanForUnmatched` ignores
    // the character it starts on: what it then finds is the unmatched partner.
    const at = pos(from.line, index);
    return scanForUnmatched(buffer, at, bracket.open, bracket.close, bracket.direction);
  }

  return null;
}

interface BracketSpec {
  readonly open: string;
  readonly close: string;
  readonly direction: 'forward' | 'backward';
}

const MATCHED_PAIRS: Readonly<Record<string, BracketSpec>> = {
  '(': { open: '(', close: ')', direction: 'forward' },
  ')': { open: '(', close: ')', direction: 'backward' },
  '[': { open: '[', close: ']', direction: 'forward' },
  ']': { open: '[', close: ']', direction: 'backward' },
  '{': { open: '{', close: '}', direction: 'forward' },
  '}': { open: '{', close: '}', direction: 'backward' }
};

function scanForUnmatched(
  buffer: TextBuffer,
  from: Position,
  open: string,
  close: string,
  direction: 'forward' | 'backward'
): Position | null {
  const wanted = direction === 'forward' ? close : open;
  const other = direction === 'forward' ? open : close;
  const step = direction === 'forward' ? nextPosition : previousPosition;

  let depth = 0;
  let current: Position | null = from;
  while (current) {
    const char = charAt(buffer, current);
    if (char === wanted) {
      if (depth === 0) return current;
      depth--;
    } else if (char === other && !positionsEqual(current, from)) {
      depth++;
    }
    current = step(buffer, current);
  }
  return null;
}

function quoteObject(buffer: TextBuffer, cursor: Position, quote: string, around: boolean): Range | null {
  const text = buffer.lineAt(cursor.line);
  const marks: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === quote && text[i - 1] !== '\\') marks.push(i);
  }

  for (let i = 0; i + 1 < marks.length; i += 2) {
    const open = marks[i]!;
    const close = marks[i + 1]!;
    if (cursor.character <= close) {
      return around
        ? { start: pos(cursor.line, open), end: pos(cursor.line, close + 1) }
        : { start: pos(cursor.line, open + 1), end: pos(cursor.line, close) };
    }
  }
  return null;
}
