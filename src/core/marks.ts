import { Position } from './types';

/**
 * Vim's marks. `ma` remembers a position, `` `a `` returns to it exactly and `'a`
 * returns to the start of its line.
 *
 * **Named marks are shared across every file**, so `ma` in one document and `ma`
 * in another are the same mark and the second wins. Vim reserves that behaviour
 * for its uppercase marks and keeps `a`-`z` inside one buffer, so this is a
 * deliberate divergence: in an editor where changing file is a keystroke, a mark
 * that cannot leave the file it was set in is worth much less than one that can
 * (#58). The shifted keys stay free rather than carrying the useful meaning.
 *
 * The jump mark stays per file. It is the breadcrumb for `` `` ``, and it is
 * rewritten by every `G`, `gg` and `/`; shared, a couple of jumps inside the
 * second file would erase the way back to the first, which is the one thing it
 * exists for.
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

/** Where a mark points: a document, and a position inside it. */
export interface MarkLocation {
  readonly bufferId: string;
  readonly position: Position;
}

export interface MarkEntry extends MarkLocation {
  readonly name: string;
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
  /** `a`-`z`, one of each for the whole session, wherever they point. */
  private readonly named = new Map<string, MarkLocation>();
  /** The jump mark, one per document. */
  private readonly jumps = new Map<string, Position>();

  /** Returns false for a name that is not a mark, so the caller can report it. */
  public set(bufferId: string, name: string, position: Position): boolean {
    const key = normalizeMarkName(name);
    if (key === null) return false;

    if (key === JUMP_MARK) this.jumps.set(bufferId, position);
    else this.named.set(key, { bufferId, position });
    return true;
  }

  /**
   * Where the mark points, which may be a different document than `bufferId`.
   * The caller has to decide what to do about that; a motion cannot express it.
   */
  public get(bufferId: string, name: string): MarkLocation | undefined {
    const key = normalizeMarkName(name);
    if (key === null) return undefined;

    if (key !== JUMP_MARK) return this.named.get(key);

    const position = this.jumps.get(bufferId);
    return position ? { bufferId, position } : undefined;
  }

  /**
   * Every mark reachable from this document, sorted by name: all the named ones
   * wherever they point, plus this document's jump mark. What `:marks` shows.
   */
  public list(bufferId: string): MarkEntry[] {
    const entries: MarkEntry[] = [...this.named.entries()].map(([name, location]) => ({ name, ...location }));

    const jump = this.jumps.get(bufferId);
    if (jump) entries.push({ name: JUMP_MARK, bufferId, position: jump });

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Only the marks that point into this document, for drawing them in the gutter.
   * Separate from `list` because the gutter can draw a line number and `:marks`
   * can name a file; showing another file's mark on this file's line would be a
   * lie rather than a shortcut.
   */
  public listIn(bufferId: string): MarkEntry[] {
    return this.list(bufferId).filter(entry => entry.bufferId === bufferId);
  }

  /** Returns false when there was no such mark, which `:delmarks` does not mind. */
  public delete(name: string): boolean {
    const key = normalizeMarkName(name);
    if (key === null || key === JUMP_MARK) return false;
    return this.named.delete(key);
  }

  /**
   * Drops every mark the user set, leaving the jump marks alone: those are
   * maintained by movement rather than by hand, and the next jump would set one
   * again anyway.
   */
  public clearNamed(): void {
    this.named.clear();
  }

  /**
   * A view for motions, which are pure functions of one buffer. A named mark in
   * another document resolves to nothing here — handing over its position would
   * put the caret at that line number in *this* file.
   */
  public reader(bufferId: string): MarkReader {
    return {
      get: name => {
        const found = this.get(bufferId, name);
        return found?.bufferId === bufferId ? found.position : undefined;
      }
    };
  }
}
