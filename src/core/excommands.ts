/**
 * The Ex commands, i.e. what `:` accepts.
 *
 * This is deliberately a lookup table rather than a parser. Vim's Ex language has
 * ranges (`%`, `'<,'>`), arguments and abbreviations of every length, and once a
 * parser is started it invites all of them in. What the configurations this
 * extension was built for actually type is a handful of fixed words plus a line
 * number, and a table says exactly that — anything else is reported as unknown
 * instead of half-working.
 *
 * Note that a remap can call a VS Code command directly, so `:w` is not the only
 * way to save. This exists for the reflex of typing `:w`, not as the mechanism
 * behind `<leader>s`.
 */

export type ExCommand =
  /** VS Code commands to run, in order. */
  | { readonly kind: 'commands'; readonly commands: readonly string[] }
  /** `:42` and `:$`. One-based, as written; the caller clamps to the buffer. */
  | { readonly kind: 'goto'; readonly line: number | 'last' }
  /** A bare `:` — Vim does nothing, and neither do we. */
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown'; readonly input: string };

const SAVE = 'workbench.action.files.save';
const CLOSE = 'workbench.action.closeActiveEditor';

/**
 * `!` is accepted where Vim accepts it, but only `:q!` differs in what it does:
 * it throws the changes away, which is the whole reason people type it.
 */
const COMMANDS: Readonly<Record<string, readonly string[]>> = {
  w: [SAVE],
  'w!': [SAVE],
  write: [SAVE],
  q: [CLOSE],
  quit: [CLOSE],
  'q!': ['workbench.action.revertAndCloseActiveEditor'],
  'quit!': ['workbench.action.revertAndCloseActiveEditor'],
  wq: [SAVE, CLOSE],
  'wq!': [SAVE, CLOSE],
  x: [SAVE, CLOSE],
  xit: [SAVE, CLOSE],
  sp: ['workbench.action.splitEditorDown'],
  split: ['workbench.action.splitEditorDown'],
  vs: ['workbench.action.splitEditor'],
  vsp: ['workbench.action.splitEditor'],
  vsplit: ['workbench.action.splitEditor'],
  // Vim's tab page holds a whole window layout, which is closer to an editor
  // group than to a tab; `:tabnew` opening an empty buffer is what it is used for.
  tabnew: ['workbench.action.files.newUntitledFile'],
  tabclose: [CLOSE],
  tabnext: ['workbench.action.nextEditor'],
  tabprevious: ['workbench.action.previousEditor']
};

export function parseExCommand(input: string): ExCommand {
  const text = input.trim();
  if (text === '') return { kind: 'none' };

  if (text === '$') return { kind: 'goto', line: 'last' };
  if (/^\d+$/.test(text)) return { kind: 'goto', line: Number.parseInt(text, 10) };

  const commands = COMMANDS[text];
  if (commands) return { kind: 'commands', commands };

  // Arguments are not supported, so `:w other.txt` must not silently save the
  // file it is looking at under the name the user believes they typed.
  return { kind: 'unknown', input: text };
}
