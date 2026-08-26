import { Mode, Position, Range } from './types';

/**
 * The engine never touches VS Code. It describes what should happen as data and
 * the adapter carries it out, which is what makes every behaviour in this
 * extension testable as "keys in, actions out".
 *
 * Application order is part of the contract: all `edit` actions first, in one
 * transaction, then `indent` and `executeCommand`, then `setMode`, then the
 * cursor or selection. Positions carried by the later actions are therefore in
 * post-edit coordinates, and the cursor is clamped under the mode the command
 * ends in rather than the one it started in.
 */
export type Action =
  | { readonly type: 'edit'; readonly range: Range; readonly text: string }
  | { readonly type: 'setCursor'; readonly position: Position; readonly toFirstNonBlank: boolean }
  | { readonly type: 'setSelection'; readonly anchor: Position; readonly active: Position; readonly linewise: boolean }
  | { readonly type: 'setMode'; readonly mode: Mode }
  | { readonly type: 'executeCommand'; readonly command: string }
  /**
   * `>` and `<`. The width of one step, tabs versus spaces and the per-language
   * settings all belong to the editor, so the core states only which lines move
   * and in which direction; the adapter hands the work to VS Code.
   */
  | {
      readonly type: 'indent';
      readonly startLine: number;
      readonly endLine: number;
      readonly direction: 'in' | 'out';
      /** How many steps. Visual mode's count means levels, as in Vim's `3>`. */
      readonly levels: number;
    }
  /**
   * Something to tell the user, such as an Ex command that does not exist. Shown
   * transiently rather than as a dialog: a typo in the command line should not
   * cost a click to dismiss.
   */
  | { readonly type: 'notify'; readonly message: string }
  /**
   * `:marks`. The core assembles the rows, including the text of each marked
   * line, and the adapter decides how to show them — a picker here, but nothing
   * about the list depends on that choice.
   */
  | { readonly type: 'showMarks'; readonly entries: readonly MarkListing[] }
  /**
   * `` `a `` onto a mark that lives in another document. A motion cannot express
   * this — its contract is a position in the buffer it was handed — so the core
   * names the document instead and the adapter opens it.
   */
  | {
      readonly type: 'openFile';
      readonly bufferId: string;
      readonly position: Position;
      /** `'a` lands on the first non-blank of the line; `` `a `` on the column. */
      readonly toFirstNonBlank: boolean;
    }
  | { readonly type: 'reveal' };

export interface MarkListing {
  readonly name: string;
  readonly line: number;
  readonly character: number;
  /** The document the mark points into, which may not be the current one. */
  readonly bufferId: string;
  /**
   * The marked line's text. Empty for a mark in another document: the core only
   * ever holds the buffer it was given, so that line is not ours to read.
   */
  readonly text: string;
}
