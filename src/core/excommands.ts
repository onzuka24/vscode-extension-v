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
  /** `:marks` — list what is set, and offer to jump to one. */
  | { readonly kind: 'marks' }
  /** `:delmarks {names}` and `:delmarks!`. */
  | { readonly kind: 'deleteMarks'; readonly all: boolean; readonly names: readonly string[] }
  /** A command that exists but was given something it cannot use. */
  | { readonly kind: 'error'; readonly message: string }
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

  // `:marks` takes a list of names in Vim (`:marks ab`). Arguments are not
  // supported here, in keeping with the rest of the table.
  if (text === 'marks') return { kind: 'marks' };

  const deleteMarks = /^(?:delmarks|delm)(!?)(?:\s+(.*))?$/.exec(text);
  if (deleteMarks) return parseDeleteMarks(deleteMarks[1] === '!', (deleteMarks[2] ?? '').trim());

  const commands = COMMANDS[text];
  if (commands) return { kind: 'commands', commands };

  // Arguments are not supported, so `:w other.txt` must not silently save the
  // file it is looking at under the name the user believes they typed.
  return { kind: 'unknown', input: text };
}

/**
 * `:delmarks` is the one command here that reads an argument.
 *
 * The table exists to avoid growing an Ex parser, and that still holds: mark
 * names are a closed grammar of single letters and `a-d` ranges, with none of
 * the ranges, registers or filenames that make Vim's argument syntax open-ended.
 * Without it the command would be `:delmarks!` alone, which can only delete
 * everything — a blunt instrument when the point is often to free up one letter.
 */
function parseDeleteMarks(bang: boolean, argument: string): ExCommand {
  if (bang) {
    return argument === ''
      ? { kind: 'deleteMarks', all: true, names: [] }
      : { kind: 'error', message: `E475: Invalid argument: ${argument}` };
  }

  // Vim requires the argument, and reports exactly this when it is missing.
  if (argument === '') return { kind: 'error', message: 'E471: Argument required' };

  const names = parseMarkNames(argument);
  return names === null
    ? { kind: 'error', message: `E475: Invalid argument: ${argument}` }
    : { kind: 'deleteMarks', all: false, names };
}

/** `a b c`, `abc` and `a-d` all name the same thing; Vim accepts each spelling. */
function parseMarkNames(argument: string): string[] | null {
  const compact = argument.replace(/\s+/g, '');
  const names: string[] = [];

  for (let i = 0; i < compact.length; i++) {
    const from = compact[i]!;
    if (!/[a-z]/.test(from)) return null;

    if (compact[i + 1] === '-') {
      const to = compact[i + 2];
      if (to === undefined || !/[a-z]/.test(to) || to < from) return null;
      for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code++) {
        names.push(String.fromCharCode(code));
      }
      i += 2;
      continue;
    }
    names.push(from);
  }

  return names.length === 0 ? null : [...new Set(names)];
}
