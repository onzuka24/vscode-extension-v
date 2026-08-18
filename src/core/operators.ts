import { TextBuffer, clampLine, getText, lastLine, lineLength, linewiseRange, linewiseText } from './buffer';
import { firstNonBlank, indentOf } from './cursor';
import { MOTIONS, Motion, MotionContext } from './motions';
import { charAt, classOf } from './scan';
import { Mode, Position, Range, RegisterContent, comparePositions, pos } from './types';

/** Operators that edit the buffer themselves and fill a register. */
export type EditOperatorName = 'd' | 'c' | 'y';

/** Operators that only shift lines. The editor decides by how much, so these produce no edit. */
export type IndentOperatorName = '>' | '<';

export type OperatorName = EditOperatorName | IndentOperatorName;

export const OPERATORS: ReadonlySet<string> = new Set<OperatorName>(['d', 'c', 'y', '>', '<']);

export function isOperator(key: string): key is OperatorName {
  return OPERATORS.has(key);
}

export function isIndentOperator(operator: OperatorName): operator is IndentOperatorName {
  return operator === '>' || operator === '<';
}

/**
 * The lines an indent operator acts on.
 *
 * In Vim `>` is always linewise, even behind a characterwise motion: `>w` shifts
 * the line the word sits on rather than the word itself. So any target is rounded
 * out to whole lines here.
 */
export function targetLines(buffer: TextBuffer, target: Target): { startLine: number; endLine: number } {
  if (target.kind === 'linewise') {
    return {
      startLine: Math.min(target.startLine, target.endLine),
      endLine: clampLine(buffer, Math.max(target.startLine, target.endLine))
    };
  }

  const { start, end } = target.range;
  // The range end is exclusive, so one that stops at column 0 does not reach into
  // that line — `>w` onto the next line's first word must not shift that line.
  const last = end.character === 0 && end.line > start.line ? end.line - 1 : end.line;
  return { startLine: start.line, endLine: clampLine(buffer, Math.max(start.line, last)) };
}

/** What an operator will act on, in the two granularities Vim distinguishes. */
export type Target =
  | { readonly kind: 'characterwise'; readonly range: Range }
  | { readonly kind: 'linewise'; readonly startLine: number; readonly endLine: number };

export interface OperatorOutcome {
  readonly edit: { readonly range: Range; readonly text: string } | null;
  readonly register: RegisterContent;
  readonly cursor: Position;
  readonly toFirstNonBlank: boolean;
  readonly mode: Mode;
}

/** Turns a motion into the range an operator should act on. Null aborts the operator. */
export function resolveMotionTarget(motion: Motion, context: MotionContext, operator: OperatorName): Target | null {
  const effective = substituteForChange(motion, context, operator);
  const destination = effective.exec(context);
  if (!destination) return null;

  const { buffer, from } = context;

  if (effective.kind === 'linewise') {
    return { kind: 'linewise', startLine: from.line, endLine: destination.line };
  }

  const forwards = comparePositions(from, destination) <= 0;
  const start = forwards ? from : destination;
  let end = forwards ? destination : from;

  if (effective.kind === 'inclusive') {
    end = pos(end.line, Math.min(end.character + 1, lineLength(buffer, end.line)));
  }

  // Vim's rule for `dw`: when the motion lands on the first word of a later line,
  // the operated range stops at the end of the previous line instead of swallowing
  // the line break and the new line's indent.
  if (effective.stopsAtLineEndForOperator && end.line > start.line && end.character <= firstNonBlank(buffer, end.line)) {
    const previous = end.line - 1;
    end = pos(previous, lineLength(buffer, previous));
  }

  return { kind: 'characterwise', range: { start, end } };
}

/** `cw` on a non-blank behaves as `ce`, so it does not eat the following space. */
function substituteForChange(motion: Motion, context: MotionContext, operator: OperatorName): Motion {
  if (operator !== 'c' || motion.changeActsAs === undefined) return motion;
  if (classOf(charAt(context.buffer, context.from)) === 'blank') return motion;
  return MOTIONS[motion.changeActsAs] ?? motion;
}

export function applyOperator(
  operator: EditOperatorName,
  buffer: TextBuffer,
  target: Target,
  origin: Position
): OperatorOutcome {
  if (target.kind === 'linewise') {
    return applyLinewise(operator, buffer, target.startLine, target.endLine, origin);
  }
  return applyCharacterwise(operator, buffer, target.range);
}

function applyLinewise(
  operator: EditOperatorName,
  buffer: TextBuffer,
  rawStart: number,
  rawEnd: number,
  origin: Position
): OperatorOutcome {
  const startLine = Math.min(rawStart, rawEnd);
  const endLine = Math.max(rawStart, rawEnd);
  const register: RegisterContent = { text: linewiseText(buffer, startLine, endLine), kind: 'linewise' };

  if (operator === 'y') {
    return { edit: null, register, cursor: pos(startLine, origin.character), toFirstNonBlank: false, mode: 'normal' };
  }

  if (operator === 'c') {
    // `cc` empties the lines but keeps one line and its indent, unlike `dd`.
    const indent = indentOf(buffer, startLine);
    const range: Range = { start: pos(startLine, 0), end: pos(endLine, lineLength(buffer, endLine)) };
    return {
      edit: { range, text: indent },
      register,
      cursor: pos(startLine, indent.length),
      toFirstNonBlank: false,
      mode: 'insert'
    };
  }

  const range = linewiseRange(buffer, startLine, endLine);
  return {
    edit: { range, text: '' },
    register,
    cursor: pos(range.start.line, 0),
    toFirstNonBlank: true,
    mode: 'normal'
  };
}

function applyCharacterwise(operator: EditOperatorName, buffer: TextBuffer, range: Range): OperatorOutcome {
  const register: RegisterContent = { text: getText(buffer, range), kind: 'characterwise' };

  if (operator === 'y') {
    return { edit: null, register, cursor: range.start, toFirstNonBlank: false, mode: 'normal' };
  }

  return {
    edit: { range, text: '' },
    register,
    cursor: range.start,
    toFirstNonBlank: false,
    mode: operator === 'c' ? 'insert' : 'normal'
  };
}

export interface PasteOutcome {
  readonly edit: { readonly range: Range; readonly text: string };
  readonly cursor: Position;
  readonly toFirstNonBlank: boolean;
}

/**
 * `p` and `P`. Register text is re-joined with the target buffer's line separator
 * so that yanking in an LF file and pasting into a CRLF one cannot mix endings.
 */
export function paste(
  buffer: TextBuffer,
  cursor: Position,
  content: RegisterContent,
  count: number,
  before: boolean
): PasteOutcome {
  const body = normalizeEol(content.text, buffer.eol);

  if (content.kind === 'linewise') {
    return pasteLinewise(buffer, cursor, body, count, before);
  }

  const text = body.repeat(count);
  const at = before
    ? cursor
    : pos(cursor.line, Math.min(cursor.character + 1, lineLength(buffer, cursor.line)));

  return {
    edit: { range: { start: at, end: at }, text },
    cursor: endOfInsertedText(at, text),
    toFirstNonBlank: false
  };
}

function pasteLinewise(
  buffer: TextBuffer,
  cursor: Position,
  body: string,
  count: number,
  before: boolean
): PasteOutcome {
  const text = body.repeat(count);

  if (before) {
    const at = pos(cursor.line, 0);
    return { edit: { range: { start: at, end: at }, text }, cursor: at, toFirstNonBlank: true };
  }

  if (cursor.line < lastLine(buffer)) {
    const at = pos(cursor.line + 1, 0);
    return { edit: { range: { start: at, end: at }, text }, cursor: at, toFirstNonBlank: true };
  }

  // No line below to insert before, so append after the final line instead and
  // drop the register's trailing break to avoid leaving a stray empty line.
  const at = pos(cursor.line, lineLength(buffer, cursor.line));
  const trimmed = text.endsWith(buffer.eol) ? text.slice(0, -buffer.eol.length) : text;
  return {
    edit: { range: { start: at, end: at }, text: buffer.eol + trimmed },
    cursor: pos(cursor.line + 1, 0),
    toFirstNonBlank: true
  };
}

function normalizeEol(text: string, eol: string): string {
  return text.split(/\r\n|\n/).join(eol);
}

/** Position of the last character of `text` once inserted at `at`. */
function endOfInsertedText(at: Position, text: string): Position {
  const lines = text.split(/\r\n|\n/);
  if (lines.length === 1) {
    return pos(at.line, Math.max(at.character, at.character + text.length - 1));
  }
  const lastPart = lines[lines.length - 1]!;
  return pos(at.line + lines.length - 1, Math.max(0, lastPart.length - 1));
}
