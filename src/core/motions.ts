import { TextBuffer, clampLine, clampPosition, lastLine, lineLength } from './buffer';
import { firstNonBlank, maxColumn } from './cursor';
import { charAt, classOf, isEmptyLine, nextPosition, previousPosition } from './scan';
import { MarkReader } from './marks';
import { SearchState, findMatch } from './search';
import { matchingBracket } from './textobjects';
import { Mode, Position, pos, positionsEqual } from './types';

/**
 * Whether the character the motion lands on belongs to the operated range.
 *
 * The difference between `dw` (stops before the next word) and `de` (eats the
 * final character of this one) is entirely this flag. Declaring it on the motion
 * instead of branching inside each operator keeps the cost of the feature matrix
 * at `operators + motions` rather than `operators x motions`.
 */
export type MotionKind = 'exclusive' | 'inclusive' | 'linewise';

/** How a motion affects the column that `j` and `k` try to return to. */
export type DesiredColumnBehavior = 'keep' | 'eol' | 'reset';

export interface MotionContext {
  readonly buffer: TextBuffer;
  readonly from: Position;
  readonly count: number;
  /** False when the count was defaulted to 1, which `gg` and `G` need to know. */
  readonly hasCount: boolean;
  readonly mode: Mode;
  readonly desiredColumn: number;
  /** Operators may address the column past the last character; plain motions may not. */
  readonly forOperator: boolean;
  readonly argument: string | undefined;
  /**
   * The search to repeat, which `n` `N` `*` `#` are. It is passed in rather than
   * held here because it outlives a single keystroke: the engine owns it, and
   * motions stay pure functions of their context.
   */
  readonly search: SearchState | null;
  /** Marks for the current buffer, for the same reason the search state is here. */
  readonly marks: MarkReader | null;
}

export interface Motion {
  readonly kind: MotionKind;
  /** `f`, `t`, `F` and `T` consume one further keystroke. */
  readonly needsArgument?: boolean;
  readonly desiredColumn?: DesiredColumnBehavior;
  /** `w`/`W`: as an operator target, stop at the end of the previous line. */
  readonly stopsAtLineEndForOperator?: boolean;
  /** Motion to substitute under `c`, so that `cw` behaves like `ce` on a non-blank. */
  readonly changeActsAs?: string;
  /**
   * Whether this counts as a jump. Before one runs, the caret's position is
   * stored so that `` `` `` and `''` can return to it — Vim's rule that a big
   * movement leaves a breadcrumb, while `h` or `j` do not.
   */
  readonly isJump?: boolean;
  /** Null means the motion cannot move, which aborts any pending operator. */
  exec(context: MotionContext): Position | null;
}

/** `n` repeats the last search, `N` repeats it the other way round. */
function repeatSearch(context: MotionContext, reverse: boolean): Position | null {
  const { search } = context;
  if (!search) return null;

  const direction = reverse ? flip(search.direction) : search.direction;
  return findMatch(context.buffer, context.from, { pattern: search.pattern, direction }, context.count);
}

function flip(direction: SearchState['direction']): SearchState['direction'] {
  return direction === 'forward' ? 'backward' : 'forward';
}

/** Motions that need a previous search, so the engine can say why nothing moved. */
export const SEARCH_MOTIONS: ReadonlySet<string> = new Set(['n', 'N', '*', '#']);

/** `*` and `#` search for the word under the cursor rather than a typed pattern. */
export const WORD_SEARCH_MOTIONS: Readonly<Record<string, SearchState['direction']>> = {
  '*': 'forward',
  '#': 'backward'
};

/** Start of the next word. Vim treats an empty line as a word of its own. */
function wordForward(buffer: TextBuffer, from: Position, big: boolean): Position {
  let current = from;
  const startClass = classOf(charAt(buffer, current), big);

  if (startClass !== 'blank') {
    for (;;) {
      const next = nextPosition(buffer, current);
      if (!next) return current;
      current = next;
      if (classOf(charAt(buffer, current), big) !== startClass) break;
    }
  }

  while (classOf(charAt(buffer, current), big) === 'blank') {
    if (isEmptyLine(buffer, current) && !positionsEqual(current, from)) return current;
    const next = nextPosition(buffer, current);
    if (!next) return current;
    current = next;
  }
  return current;
}

/** Start of the previous word. */
function wordBackward(buffer: TextBuffer, from: Position, big: boolean): Position {
  let current = previousPosition(buffer, from);
  if (!current) return from;

  while (classOf(charAt(buffer, current), big) === 'blank') {
    if (isEmptyLine(buffer, current)) return current;
    const previous = previousPosition(buffer, current);
    if (!previous) return current;
    current = previous;
  }

  const runClass = classOf(charAt(buffer, current), big);
  for (;;) {
    const previous = previousPosition(buffer, current);
    if (!previous) return current;
    if (classOf(charAt(buffer, previous), big) !== runClass) return current;
    current = previous;
  }
}

/** Last character of the current or next word. */
function wordEndForward(buffer: TextBuffer, from: Position, big: boolean): Position {
  let current = nextPosition(buffer, from);
  if (!current) return from;

  while (classOf(charAt(buffer, current), big) === 'blank') {
    const next = nextPosition(buffer, current);
    if (!next) return current;
    current = next;
  }

  const runClass = classOf(charAt(buffer, current), big);
  for (;;) {
    const next = nextPosition(buffer, current);
    if (!next) return current;
    if (classOf(charAt(buffer, next), big) !== runClass) return current;
    current = next;
  }
}

/** `f` and `t` search within the current line only, as in Vim. */
function findInLine(
  buffer: TextBuffer,
  from: Position,
  target: string,
  count: number,
  direction: 'forward' | 'backward',
  till: boolean
): Position | null {
  const text = buffer.lineAt(from.line);
  let index = from.character;
  for (let i = 0; i < count; i++) {
    index = direction === 'forward' ? text.indexOf(target, index + 1) : text.lastIndexOf(target, index - 1);
    if (index === -1) return null;
  }
  const column = till ? (direction === 'forward' ? index - 1 : index + 1) : index;
  if (column === from.character) return null;
  return pos(from.line, column);
}

/** `{` and `}` treat blank lines as paragraph boundaries. */
function paragraph(buffer: TextBuffer, from: Position, count: number, direction: 1 | -1): Position | null {
  let line = from.line;
  for (let i = 0; i < count; i++) {
    line += direction;
    while (line > 0 && line < lastLine(buffer) && lineLength(buffer, line) !== 0) {
      line += direction;
    }
    line = clampLine(buffer, line);
  }
  return line === from.line ? null : pos(line, 0);
}

function columnLimit(buffer: TextBuffer, line: number, context: MotionContext): number {
  return maxColumn(buffer, line, context.forOperator ? 'insert' : context.mode);
}

function verticalMove(context: MotionContext, delta: number): Position | null {
  const { buffer, from, desiredColumn } = context;
  const line = clampLine(buffer, from.line + delta);
  if (line === from.line) return null;
  const column = Math.min(desiredColumn, columnLimit(buffer, line, context));
  return pos(line, Math.max(0, column));
}

function repeated(count: number, step: (position: Position) => Position): (from: Position) => Position {
  return from => {
    let current = from;
    for (let i = 0; i < count; i++) current = step(current);
    return current;
  };
}

export const MOTIONS: Readonly<Record<string, Motion>> = {
  h: {
    kind: 'exclusive',
    exec: ({ from, count }) => (from.character === 0 ? null : pos(from.line, Math.max(0, from.character - count)))
  },
  l: {
    kind: 'exclusive',
    exec: context => {
      const { buffer, from, count } = context;
      const limit = columnLimit(buffer, from.line, context);
      if (from.character >= limit) return null;
      return pos(from.line, Math.min(from.character + count, limit));
    }
  },
  j: { kind: 'linewise', desiredColumn: 'keep', exec: context => verticalMove(context, context.count) },
  k: { kind: 'linewise', desiredColumn: 'keep', exec: context => verticalMove(context, -context.count) },
  w: {
    kind: 'exclusive',
    stopsAtLineEndForOperator: true,
    changeActsAs: 'e',
    exec: ({ buffer, from, count }) => repeated(count, p => wordForward(buffer, p, false))(from)
  },
  W: {
    kind: 'exclusive',
    stopsAtLineEndForOperator: true,
    changeActsAs: 'E',
    exec: ({ buffer, from, count }) => repeated(count, p => wordForward(buffer, p, true))(from)
  },
  b: { kind: 'exclusive', exec: ({ buffer, from, count }) => repeated(count, p => wordBackward(buffer, p, false))(from) },
  B: { kind: 'exclusive', exec: ({ buffer, from, count }) => repeated(count, p => wordBackward(buffer, p, true))(from) },
  e: { kind: 'inclusive', exec: ({ buffer, from, count }) => repeated(count, p => wordEndForward(buffer, p, false))(from) },
  E: { kind: 'inclusive', exec: ({ buffer, from, count }) => repeated(count, p => wordEndForward(buffer, p, true))(from) },
  '0': { kind: 'exclusive', exec: ({ from }) => (from.character === 0 ? null : pos(from.line, 0)) },
  '^': { kind: 'exclusive', exec: ({ buffer, from }) => pos(from.line, firstNonBlank(buffer, from.line)) },
  $: {
    kind: 'inclusive',
    desiredColumn: 'eol',
    exec: ({ buffer, from, count }) => {
      const line = clampLine(buffer, from.line + count - 1);
      return pos(line, Math.max(0, lineLength(buffer, line) - 1));
    }
  },
  G: {
    isJump: true,
    kind: 'linewise',
    exec: ({ buffer, count, hasCount }) => {
      const line = hasCount ? clampLine(buffer, count - 1) : lastLine(buffer);
      return pos(line, firstNonBlank(buffer, line));
    }
  },
  gg: {
    isJump: true,
    kind: 'linewise',
    exec: ({ buffer, count, hasCount }) => {
      const line = hasCount ? clampLine(buffer, count - 1) : 0;
      return pos(line, firstNonBlank(buffer, line));
    }
  },
  '{': { kind: 'exclusive', isJump: true, exec: ({ buffer, from, count }) => paragraph(buffer, from, count, -1) },
  '}': { kind: 'exclusive', isJump: true, exec: ({ buffer, from, count }) => paragraph(buffer, from, count, 1) },
  // `%` is inclusive so that `d%` takes both brackets and everything between.
  '%': { kind: 'inclusive', isJump: true, exec: ({ buffer, from }) => matchingBracket(buffer, from) },
  n: { kind: 'exclusive', isJump: true, exec: context => repeatSearch(context, false) },
  N: { kind: 'exclusive', isJump: true, exec: context => repeatSearch(context, true) },
  // `*` and `#` are `n` over a search the engine has just set to the word under
  // the cursor, so the direction is already baked into `context.search`.
  '*': { kind: 'exclusive', isJump: true, exec: context => repeatSearch(context, false) },
  '#': { kind: 'exclusive', isJump: true, exec: context => repeatSearch(context, false) },
  f: {
    kind: 'inclusive',
    needsArgument: true,
    exec: ({ buffer, from, count, argument }) =>
      argument === undefined ? null : findInLine(buffer, from, argument, count, 'forward', false)
  },
  F: {
    kind: 'exclusive',
    needsArgument: true,
    exec: ({ buffer, from, count, argument }) =>
      argument === undefined ? null : findInLine(buffer, from, argument, count, 'backward', false)
  },
  t: {
    kind: 'inclusive',
    needsArgument: true,
    exec: ({ buffer, from, count, argument }) =>
      argument === undefined ? null : findInLine(buffer, from, argument, count, 'forward', true)
  },
  T: {
    kind: 'exclusive',
    needsArgument: true,
    exec: ({ buffer, from, count, argument }) =>
      argument === undefined ? null : findInLine(buffer, from, argument, count, 'backward', true)
  },
  // `` `a `` goes to the marked character, `'a` to the start of its line. Both
  // take the mark's name as their argument, exactly as `f` takes a character.
  '`': { kind: 'exclusive', needsArgument: true, isJump: true, exec: markMotion(false) },
  "'": { kind: 'linewise', needsArgument: true, isJump: true, exec: markMotion(true) }
};

/**
 * A mark may point past the end of a document that has since been edited, so the
 * stored position is clamped rather than trusted.
 */
function markMotion(toLineStart: boolean): (context: MotionContext) => Position | null {
  return ({ buffer, marks, argument }) => {
    if (!marks || argument === undefined) return null;

    const at = marks.get(argument);
    if (!at) return null;

    if (!toLineStart) return clampPosition(buffer, at);
    const line = clampLine(buffer, at.line);
    return pos(line, firstNonBlank(buffer, line));
  };
}

/** True while `keys` is a strict prefix of a longer motion, e.g. `g` on the way to `gg`. */
export function isMotionPrefix(keys: string): boolean {
  return Object.keys(MOTIONS).some(key => key.length > keys.length && key.startsWith(keys));
}

export function lookupMotion(keys: string): Motion | undefined {
  return MOTIONS[keys];
}
