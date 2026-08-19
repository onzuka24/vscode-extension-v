import { Position, Range, pos } from './types';

/**
 * Read-only view of a document. Kept as an interface so the VS Code adapter can
 * wrap a `TextDocument` lazily instead of copying every line on each keystroke.
 */
export interface TextBuffer {
  readonly lineCount: number;
  /** Line content without its trailing line break. */
  lineAt(line: number): string;
  /** The document's line separator, so edits never mix `\n` into a CRLF file. */
  readonly eol: string;
  /**
   * Identifies the document. Anything the engine remembers per file — marks so
   * far — is keyed by this, so a position recorded in one file cannot be applied
   * to another.
   */
  readonly id: string;
}

/** In-memory buffer used by the tests. */
export class LinesBuffer implements TextBuffer {
  private readonly lines: readonly string[];

  public constructor(
    text: string,
    public readonly eol: string = '\n',
    public readonly id: string = 'buffer'
  ) {
    this.lines = text.split(/\r\n|\n/);
  }

  public get lineCount(): number {
    return this.lines.length;
  }

  public lineAt(line: number): string {
    const value = this.lines[line];
    if (value === undefined) {
      throw new RangeError(`line ${line} is out of range (lineCount=${this.lineCount})`);
    }
    return value;
  }

  public toString(): string {
    return this.lines.join(this.eol);
  }
}

export function lineLength(buffer: TextBuffer, line: number): number {
  return buffer.lineAt(line).length;
}

export function lastLine(buffer: TextBuffer): number {
  return buffer.lineCount - 1;
}

export function clampLine(buffer: TextBuffer, line: number): number {
  return Math.min(Math.max(line, 0), lastLine(buffer));
}

/** Clamps a position into the buffer, allowing the column just past the last character. */
export function clampPosition(buffer: TextBuffer, position: Position): Position {
  const line = clampLine(buffer, position.line);
  const character = Math.min(Math.max(position.character, 0), lineLength(buffer, line));
  return pos(line, character);
}

export function bufferEnd(buffer: TextBuffer): Position {
  const line = lastLine(buffer);
  return pos(line, lineLength(buffer, line));
}

export function getText(buffer: TextBuffer, range: Range): string {
  const start = clampPosition(buffer, range.start);
  const end = clampPosition(buffer, range.end);
  if (start.line === end.line) {
    return buffer.lineAt(start.line).slice(start.character, end.character);
  }
  const parts: string[] = [buffer.lineAt(start.line).slice(start.character)];
  for (let line = start.line + 1; line < end.line; line++) {
    parts.push(buffer.lineAt(line));
  }
  parts.push(buffer.lineAt(end.line).slice(0, end.character));
  return parts.join(buffer.eol);
}

/**
 * Range covering whole lines `[startLine, endLine]` together with one line break.
 *
 * The final line of a buffer has no trailing break, so there the range is extended
 * backwards to swallow the *preceding* break instead. Without this, `dd` on the
 * last line deletes the text but leaves an empty line behind.
 */
export function linewiseRange(buffer: TextBuffer, startLine: number, endLine: number): Range {
  const first = clampLine(buffer, Math.min(startLine, endLine));
  const last = clampLine(buffer, Math.max(startLine, endLine));

  if (last < lastLine(buffer)) {
    return { start: pos(first, 0), end: pos(last + 1, 0) };
  }
  if (first > 0) {
    return { start: pos(first - 1, lineLength(buffer, first - 1)), end: pos(last, lineLength(buffer, last)) };
  }
  // The whole buffer: deleting it leaves a single empty line, as Vim does.
  return { start: pos(0, 0), end: pos(last, lineLength(buffer, last)) };
}

/** Text of lines `[startLine, endLine]` with a trailing break, for linewise registers. */
export function linewiseText(buffer: TextBuffer, startLine: number, endLine: number): string {
  const first = clampLine(buffer, Math.min(startLine, endLine));
  const last = clampLine(buffer, Math.max(startLine, endLine));
  const lines: string[] = [];
  for (let line = first; line <= last; line++) {
    lines.push(buffer.lineAt(line));
  }
  return lines.join(buffer.eol) + buffer.eol;
}
