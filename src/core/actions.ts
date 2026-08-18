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
  | { readonly type: 'reveal' };
