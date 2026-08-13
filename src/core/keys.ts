/**
 * Key tokens as they travel through the engine.
 *
 * Almost every key is a single character that arrives through VS Code's `type`
 * command. The exceptions are keys that `type` never delivers — Escape and the
 * Ctrl combinations — which reach us through `package.json` keybindings. Remap
 * rules need to name those too (`nnoremap U <c-r>`), so they are written in
 * Vim's angle-bracket notation and kept as single indivisible tokens.
 */

/** Keys that a remap may expand to but that the parser never sees. */
export const SPECIAL_KEYS = {
  escape: '<Esc>',
  redo: '<C-r>'
} as const;

export type SpecialKey = (typeof SPECIAL_KEYS)[keyof typeof SPECIAL_KEYS];

/** Angle-bracket spellings accepted in configuration, normalised to a canonical token. */
const ALIASES: Readonly<Record<string, SpecialKey>> = {
  esc: SPECIAL_KEYS.escape,
  escape: SPECIAL_KEYS.escape,
  'c-r': SPECIAL_KEYS.redo,
  'ctrl-r': SPECIAL_KEYS.redo
};

export function isSpecialKey(key: string): key is SpecialKey {
  return (Object.values(SPECIAL_KEYS) as string[]).includes(key);
}

/**
 * Normalises one key as written in configuration. Angle-bracket names are matched
 * case-insensitively, so `<Esc>`, `<esc>` and `<ESC>` are the same token.
 * Returns null for an unrecognised name so the caller can report it rather than
 * silently binding a key that will never fire.
 */
export function normalizeKey(key: string): string | null {
  if (key.length === 0) return null;
  if (!key.startsWith('<') || !key.endsWith('>')) {
    // A plain key is a single character; `<` and `>` themselves are written bare.
    return [...key].length === 1 ? key : null;
  }

  const name = key.slice(1, -1).toLowerCase();
  return ALIASES[name] ?? null;
}

/** Splits a written key sequence such as `10j` or `<Esc>` into tokens. */
export function tokenize(sequence: string): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i] === '<') {
      const close = sequence.indexOf('>', i);
      if (close !== -1) {
        tokens.push(sequence.slice(i, close + 1));
        i = close;
        continue;
      }
    }
    tokens.push(sequence[i]!);
  }
  return tokens;
}
