import { TextBuffer, lastLine } from './buffer';
import { charAt, classOf } from './scan';
import { Position, comparePositions, pos } from './types';

/**
 * Searching, as `/` `?` `n` `N` `*` `#` use it.
 *
 * The pattern is a JavaScript regular expression, not a Vim one. Vim's dialect
 * differs in enough small ways (`\v`, `\<`, `\{-}`) that half-translating it
 * would be worse than not translating it at all: a pattern that quietly matches
 * something else is harder to notice than one that is rejected. What the two
 * dialects share — literal text, character classes, `.` `*` `+` `?` — covers
 * what searching in an editor is mostly used for.
 *
 * Searches wrap around the buffer, as Vim's default `wrapscan` does.
 */

export type SearchDirection = 'forward' | 'backward';

export interface SearchState {
  readonly pattern: string;
  readonly direction: SearchDirection;
}

/** Null for a pattern JavaScript cannot compile, so the caller can report it. */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'g');
  } catch {
    return null;
  }
}

/**
 * The `count`-th match from `from`, exclusive of the cursor position itself.
 *
 * Every match in the buffer is collected before picking one. A buffer held in
 * memory is small enough for that to be irrelevant to the eye, and it makes
 * wrapping, counts and backward search the same three lines of list arithmetic
 * rather than three separate scanning loops.
 */
export function findMatch(
  buffer: TextBuffer,
  from: Position,
  search: SearchState,
  count: number
): Position | null {
  const expression = compilePattern(search.pattern);
  if (!expression) return null;

  const matches = allMatches(buffer, expression);
  if (matches.length === 0) return null;

  // Where the cursor sits among the matches, so that the step below is relative
  // to it. A match starting exactly under the cursor counts as behind us going
  // forward and as ahead of us going backward — either way the cursor moves.
  const after = firstIndexWhere(matches, match => comparePositions(match, from) > 0);
  const atOrAfter = firstIndexWhere(matches, match => comparePositions(match, from) >= 0);

  const steps = Math.max(1, count);
  const index = search.direction === 'forward' ? after + steps - 1 : atOrAfter - steps;

  // The remainder wraps, which is what makes a search from the last match land
  // on the first one.
  const wrapped = ((index % matches.length) + matches.length) % matches.length;
  return matches[wrapped] ?? null;
}

function allMatches(buffer: TextBuffer, expression: RegExp): Position[] {
  const found: Position[] = [];

  for (let line = 0; line <= lastLine(buffer); line++) {
    const text = buffer.lineAt(line);
    expression.lastIndex = 0;

    for (;;) {
      const match = expression.exec(text);
      if (!match) break;
      found.push(pos(line, match.index));
      // A pattern such as `x*` can match the empty string; without this the loop
      // would never advance.
      if (match.index === expression.lastIndex) expression.lastIndex++;
    }
  }

  return found;
}

/** Index of the first match satisfying `predicate`, or one past the end. */
function firstIndexWhere(matches: readonly Position[], predicate: (match: Position) => boolean): number {
  const index = matches.findIndex(predicate);
  return index === -1 ? matches.length : index;
}

export interface WordSearch {
  readonly pattern: string;
  /** Where the word begins. `*` searches from there, not from the caret. */
  readonly start: Position;
}

/**
 * The word `*` and `#` should look for, as a pattern anchored to word boundaries
 * the way Vim's `\<word\>` is. Vim takes the word under the cursor, or the next
 * one on the line when the cursor sits on whitespace — and in the second case it
 * moves to that word first, so the search starts there rather than at the caret.
 */
export function wordSearchAt(buffer: TextBuffer, from: Position): WordSearch | null {
  const text = buffer.lineAt(from.line);
  let index = from.character;

  while (index < text.length && classOf(charAt(buffer, pos(from.line, index))) === 'blank') index++;
  if (index >= text.length) return null;

  const wordClass = classOf(text[index]!);
  let start = index;
  while (start > 0 && classOf(text[start - 1]!) === wordClass) start--;
  let end = index;
  while (end < text.length && classOf(text[end]!) === wordClass) end++;

  const word = text.slice(start, end);
  if (word === '') return null;

  // Only a word of word characters can carry `\b`; a run of punctuation such as
  // `->` has no word boundary to anchor to.
  const pattern = wordClass === 'word' ? `\\b${escape(word)}\\b` : escape(word);
  return { pattern, start: pos(from.line, start) };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
