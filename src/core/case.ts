import { TextBuffer, getText, lineLength } from './buffer';
import { CaseOperatorName, Target } from './operators';
import { Position, Range, pos } from './types';

/**
 * Changing case: `gu` `gU` `g~` over a motion, and the Visual-mode `u` `U` `~`
 * that the parser turns into the same three operators.
 *
 * These are kept apart from `d` `c` `y` because they differ in what they do
 * besides editing: no register is filled and the mode never becomes Insert. What
 * remains is one range and one per-character function, which is why all three
 * fit in a table.
 */

const TRANSFORMS: Readonly<Record<CaseOperatorName, (char: string) => string>> = {
  gu: char => char.toLowerCase(),
  gU: char => char.toUpperCase(),
  // A character that already equals its own lower case has nowhere lower to go,
  // so it goes up; anything else comes down. Characters with no case at all
  // ('あ', '1') take the first branch and come back unchanged.
  'g~': char => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase())
};

export interface CaseOutcome {
  /** Null when the text was already in that case, so no undo step is spent. */
  readonly edit: { readonly range: Range; readonly text: string } | null;
  readonly cursor: Position;
  readonly toFirstNonBlank: boolean;
}

/**
 * The text with every character passed through the operator's transform.
 *
 * Iterating with the spread keeps astral characters whole; iterating by UTF-16
 * unit would split them and produce nonsense.
 */
export function transformCase(text: string, operator: CaseOperatorName): string {
  const transform = TRANSFORMS[operator];
  return [...text].map(char => sameLength(char, transform(char))).join('');
}

/**
 * A case change that would alter how many characters there are is dropped.
 *
 * JavaScript upper-cases 'ß' to 'SS' and lower-cases 'İ' to two code points.
 * Vim does neither — it maps 'ß' to the single 'ẞ' and never changes a line's
 * length. Since every column after the change would shift, leaving the character
 * alone is the smaller error than growing the line, and it keeps the replacement
 * the same length as what it replaces.
 */
function sameLength(original: string, changed: string): string {
  return changed.length === original.length ? changed : original;
}

/**
 * Applies a case operator to whatever the motion, text object or selection
 * resolved to.
 *
 * `fromVisual` exists because Vim lands the caret differently on the two sides,
 * and the difference is not guessable: measured against Vim 9.1, `guu` on an
 * indented line leaves the caret on the first non-blank, while `Vu` on the same
 * line leaves it in column 0.
 */
export function applyCase(
  operator: CaseOperatorName,
  buffer: TextBuffer,
  target: Target,
  fromVisual: boolean
): CaseOutcome {
  const range = caseRange(buffer, target);
  const text = getText(buffer, range);
  const changed = transformCase(text, operator);

  return {
    // Vim moves the caret even when nothing needed changing, so the cursor is
    // reported either way; only the edit is withheld.
    edit: changed === text ? null : { range, text: changed },
    cursor: range.start,
    toFirstNonBlank: target.kind === 'linewise' && !fromVisual
  };
}

/**
 * Whole lines for a linewise target, but stopping at the end of the last line.
 * Reaching past it would take in the trailing line break, and a range whose
 * replacement has to reproduce that break exactly is one more thing to get wrong
 * for no gain: no case change ever touches a line break.
 */
function caseRange(buffer: TextBuffer, target: Target): Range {
  if (target.kind === 'characterwise') return target.range;

  const startLine = Math.min(target.startLine, target.endLine);
  const endLine = Math.max(target.startLine, target.endLine);
  return { start: pos(startLine, 0), end: pos(endLine, lineLength(buffer, endLine)) };
}
