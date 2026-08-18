import { Position } from './types';

/**
 * Vim's marks. `ma` remembers a position, `` `a `` returns to it exactly and `'a`
 * returns to the start of its line.
 *
 * Marks are kept per buffer, as Vim keeps its lowercase marks: `ma` in one file
 * and `` `a `` in another must not send the caret to a line number that belonged
 * to a different document.
 *
 * Positions are *not* adjusted when the document is edited. Following an edit
 * would mean subscribing to document changes and rewriting every stored
 * position; until that exists, a mark set above a deletion drifts. This is worth
 * knowing but rarely bites, because marks are mostly set and used within a few
 * keystrokes of each other.
 */
export interface MarkReader {
  get(name: string): Position | undefined;
}

export interface MarkEntry {
  readonly name: string;
  readonly position: Position;
}

/** Where `` `` `` and `''` go: the position held before the last jump. */
export const JUMP_MARK = '`';

/**
 * Both `` ` `` and `'` name the same stored mark; it is the motion, not the name,
 * that decides whether the jump is characterwise or linewise.
 */
export function normalizeMarkName(name: string): string | null {
  if (/^[a-z]$/.test(name)) return name;
  if (name === '`' || name === "'") return JUMP_MARK;
  return null;
}

export class MarkStore {
  private readonly byBuffer = new Map<string, Map<string, Position>>();

  /** Returns false for a name that is not a mark, so the caller can report it. */
  public set(bufferId: string, name: string, position: Position): boolean {
    const key = normalizeMarkName(name);
    if (key === null) return false;

    const marks = this.byBuffer.get(bufferId) ?? new Map<string, Position>();
    marks.set(key, position);
    this.byBuffer.set(bufferId, marks);
    return true;
  }

  public get(bufferId: string, name: string): Position | undefined {
    const key = normalizeMarkName(name);
    return key === null ? undefined : this.byBuffer.get(bufferId)?.get(key);
  }

  /**
   * Every mark set in a buffer, sorted by name. The jump mark is included; it is
   * up to the caller to decide whether something that moves on every `G` is worth
   * showing.
   */
  public list(bufferId: string): MarkEntry[] {
    const marks = this.byBuffer.get(bufferId);
    if (!marks) return [];

    return [...marks.entries()]
      .map(([name, position]) => ({ name, position }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A view bound to one buffer, which is what motions are handed. */
  public reader(bufferId: string): MarkReader {
    return { get: name => this.get(bufferId, name) };
  }
}
