/**
 * The ideographic space (U+3000). It is as wide as a kanji and blank, so in a
 * Japanese text it reads exactly like two ASCII spaces — until a compiler or a
 * diff tool disagrees.
 */
export const FULL_WIDTH_SPACE = '　';

/** Offsets of every full-width space in `text`, in order. */
export function fullWidthSpaceOffsets(text: string): number[] {
  const offsets: number[] = [];
  for (let at = text.indexOf(FULL_WIDTH_SPACE); at !== -1; at = text.indexOf(FULL_WIDTH_SPACE, at + 1)) {
    offsets.push(at);
  }
  return offsets;
}
