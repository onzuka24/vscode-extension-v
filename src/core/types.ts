/**
 * Core value types. Nothing in `src/core` may import `vscode` — the whole point
 * of this layer is that it can be exercised from a plain Node test runner.
 */

export type Mode = 'normal' | 'insert' | 'visual' | 'visual-line';

/** Zero-based, mirroring VS Code's coordinate system. */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** `start` is inclusive, `end` is exclusive. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

export type RegisterKind = 'characterwise' | 'linewise';

export interface RegisterContent {
  readonly text: string;
  readonly kind: RegisterKind;
}

export function pos(line: number, character: number): Position {
  return { line, character };
}

export function comparePositions(a: Position, b: Position): number {
  return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.line === b.line && a.character === b.character;
}

export function isBefore(a: Position, b: Position): boolean {
  return comparePositions(a, b) < 0;
}

/** Builds a range from two positions in either order. */
export function makeRange(a: Position, b: Position): Range {
  return isBefore(a, b) ? { start: a, end: b } : { start: b, end: a };
}
