import { TextBuffer } from './buffer';
import { Position, Range, pos } from './types';

/**
 * Where `<leader>e` sends the current line or selection.
 *
 * What actually gets sent is a *reference* — `@src/core/engine.ts#512-540` — not
 * the text. That is not a shortcut: it is the only thing the AI panels shipped by
 * other extensions accept into a conversation that is already open. Their commands
 * take no arguments and read the editor's selection themselves, so this extension
 * arranges the selection and then calls one of them. Passing text instead is
 * possible only by opening a brand new conversation every time, which is not what
 * "send to the open panel" means. A reference is also better than a paste: the
 * panel reads the file as it stands rather than a copy that is already stale.
 *
 * The command IDs live in the user's settings (`vimLike.aiPanels`) for the same
 * reason `:gg` does: this extension has no business knowing the command IDs of
 * tools it does not ship with, and a built-in list would have to grow with every
 * new assistant.
 */

export interface AiPanel {
  /** Shown when choosing between panels. */
  readonly name: string;
  /** The command to run once the selection is in place. */
  readonly command: string;
}

export function compileAiPanels(value: unknown): { panels: readonly AiPanel[]; problems: string[] } {
  const problems: string[] = [];
  if (value === undefined) return { panels: [], problems };

  if (!Array.isArray(value)) {
    return { panels: [], problems: ['vimLike.aiPanels: name と command を持つ項目の配列にしてください。'] };
  }

  const panels: AiPanel[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of value.entries()) {
    const where = `vimLike.aiPanels[${index}]`;

    if (!isPanel(entry)) {
      problems.push(`${where}: name と command の両方を、空でない文字列で指定してください。`);
      continue;
    }
    // Two entries with the same name make the chooser ambiguous, and the name is
    // the only thing shown there.
    if (seen.has(entry.name)) {
      problems.push(`${where}: 名前 "${entry.name}" が重複しています。`);
      continue;
    }

    seen.add(entry.name);
    panels.push({ name: entry.name, command: entry.command });
  }

  return { panels, problems };
}

/** The value comes straight from settings.json, so nothing about it is assumed. */
function isPanel(value: unknown): value is AiPanel {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    record.name !== '' &&
    typeof record.command === 'string' &&
    record.command !== ''
  );
}

/**
 * The range to put the selection on before calling the panel's command, or null
 * when there is nothing worth sending.
 *
 * A blank line returns null rather than an empty range. Every one of these
 * commands falls back to referencing the *whole file* when the selection is
 * empty, and quietly handing over the whole file because the caret happened to be
 * on an empty line is worse than saying nothing happened.
 */
export function referenceRange(buffer: TextBuffer, cursor: Position, selected: Range | null): Range | null {
  if (selected) return selected;

  const text = buffer.lineAt(cursor.line);
  if (text.trim() === '') return null;
  return { start: pos(cursor.line, 0), end: pos(cursor.line, text.length) };
}
