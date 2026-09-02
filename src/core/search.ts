import { TextBuffer, clampLine } from './buffer';
import { charAt, classOf } from './scan';
import { Position, pos } from './types';

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
 *
 * `/` and `?` always come here rather than to VS Code's find widget. Only a
 * search the engine runs itself can be a motion, which is what makes `d/foo`
 * and `v/foo` work; a widget that swallows the keystrokes cannot combine with an
 * operator. VS Code's own find stays reachable on its own keys.
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
 * The search walks outward from the cursor and stops at the match it was asked
 * for, rather than collecting every match in the document and indexing into the
 * list. Collecting was simpler — wrapping, counts and backward search all became
 * list arithmetic — but it made every `n` cost a scan of the whole file: 6ms on a
 * hundred thousand lines, against a 16ms frame. Walking outward makes the common
 * case, where the next match is nearby, too fast to measure (#70).
 *
 * A count larger than the number of matches still has to wrap round, and that is
 * the one case that cannot know its answer early: it needs the total. So a full
 * lap is allowed to establish the total, after which the remaining steps are
 * taken modulo it. That lap only happens when the count exceeds the matches,
 * which is `100n` on a file with three of them.
 */
export function findMatch(
  buffer: TextBuffer,
  from: Position,
  search: SearchState,
  count: number
): Position | null {
  const expression = compilePattern(search.pattern);
  if (!expression) return null;

  const wanted = Math.max(1, count);
  let remaining = wanted;
  let seen = 0;

  for (let lap = 0; lap < 2; lap++) {
    for (const match of matchesFrom(buffer, from, search.direction, expression)) {
      seen++;
      remaining--;
      if (remaining === 0) return match;
    }

    // Nothing anywhere in the document, so a second lap would find nothing too.
    if (seen === 0) return null;

    // One lap has counted them all. Vim's counts wrap, so the rest is modular.
    remaining = ((wanted - 1) % seen) + 1;
  }

  return null;
}

/**
 * Every match, in the order the search would meet them: outward from the cursor
 * in its direction, then round the end of the document and back to the cursor.
 *
 * A match starting exactly under the cursor is behind us going forward and ahead
 * of us going backward — either way the cursor moves rather than staying put.
 *
 * Written as one loop rather than a generator per line delegated to with
 * `yield*`. That reads better but costs: on a hundred thousand lines with no
 * match, where every line has to be looked at, the delegation alone took 4ms
 * against 1.6ms for the same work in one loop.
 */
function* matchesFrom(
  buffer: TextBuffer,
  from: Position,
  direction: SearchDirection,
  expression: RegExp
): Generator<Position> {
  const lineCount = buffer.lineCount;
  const start = clampLine(buffer, from.line);
  const forward = direction === 'forward';

  // One step per line, plus one: the starting line is visited at both ends of the
  // lap, first for the matches past the cursor and last for the ones the wrap
  // brought us back round to.
  for (let step = 0; step <= lineCount; step++) {
    const line = forward
      ? (start + step) % lineCount
      : (((start - step) % lineCount) + lineCount) % lineCount;

    const beforeWrap = step === 0;
    const afterWrap = step === lineCount;
    const text = buffer.lineAt(line);
    expression.lastIndex = 0;

    if (forward) {
      for (;;) {
        const match = expression.exec(text);
        if (!match) break;
        const index = match.index;
        // A pattern such as `x*` can match the empty string; without this the
        // loop would never advance. It has to happen before any `continue`.
        if (index === expression.lastIndex) expression.lastIndex++;

        if (beforeWrap && index <= from.character) continue;
        if (afterWrap && index > from.character) continue;
        yield pos(line, index);
      }
      continue;
    }

    // Backward reads the line right to left, so its matches have to be in hand
    // before any can be given out. One line's worth, not the document's.
    const indices: number[] = [];
    for (;;) {
      const match = expression.exec(text);
      if (!match) break;
      indices.push(match.index);
      if (match.index === expression.lastIndex) expression.lastIndex++;
    }
    for (let i = indices.length - 1; i >= 0; i--) {
      const index = indices[i]!;
      if (beforeWrap && index >= from.character) continue;
      if (afterWrap && index < from.character) continue;
      yield pos(line, index);
    }
  }
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
