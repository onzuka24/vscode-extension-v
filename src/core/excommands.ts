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
 *
 * Names beyond the built-in ones come from the user's own table
 * (`vimLike.exCommands`). Anything that belongs to another extension — opening
 * Git Graph, say — lives there rather than here: this extension has no business
 * knowing the command IDs of tools it does not ship with, and a built-in list
 * would have to grow with every user's favourite.
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
const SAVE_ALL = 'workbench.action.files.saveAll';
const CLOSE = 'workbench.action.closeActiveEditor';
const CLOSE_ALL = 'workbench.action.closeAllEditors';
/**
 * Runs after anything that closes an editor.
 *
 * In Vim `:qa` ends the session; here the window stays, and closing the last tab
 * leaves nothing to type into and nothing to move around in — the keyboard
 * appears to stop working (#57). Landing on the file tree instead keeps the
 * window usable: `j` and `k` move, `Enter` opens the next file. It only acts when
 * nothing at all is left open, so `:q` with other tabs still there is unaffected.
 */
const REVEAL_IF_EMPTY = 'vimLike.revealFileTreeIfEmpty';

/**
 * `!` is accepted where Vim accepts it, but only `:q!` differs in what it does:
 * it throws the changes away, which is the whole reason people type it.
 *
 * `:qa!` cannot do the same. Discarding changes across every editor has no
 * command behind it in VS Code — `workbench.action.files.revertEditors` looks
 * like one but is an action built inside the "could not save" notification, not
 * something that can be invoked. So `:qa!` closes everything and lets VS Code
 * ask about the unsaved files. The prompt makes the difference visible at the
 * moment it matters, which beats refusing a command Vim users type by reflex.
 */
const COMMANDS: Readonly<Record<string, readonly string[]>> = {
  w: [SAVE],
  'w!': [SAVE],
  write: [SAVE],
  q: [CLOSE, REVEAL_IF_EMPTY],
  quit: [CLOSE, REVEAL_IF_EMPTY],
  'q!': ['workbench.action.revertAndCloseActiveEditor', REVEAL_IF_EMPTY],
  'quit!': ['workbench.action.revertAndCloseActiveEditor', REVEAL_IF_EMPTY],
  wq: [SAVE, CLOSE, REVEAL_IF_EMPTY],
  'wq!': [SAVE, CLOSE, REVEAL_IF_EMPTY],
  x: [SAVE, CLOSE, REVEAL_IF_EMPTY],
  xit: [SAVE, CLOSE, REVEAL_IF_EMPTY],
  qa: [CLOSE_ALL, REVEAL_IF_EMPTY],
  qall: [CLOSE_ALL, REVEAL_IF_EMPTY],
  'qa!': [CLOSE_ALL, REVEAL_IF_EMPTY],
  'qall!': [CLOSE_ALL, REVEAL_IF_EMPTY],
  wqa: [SAVE_ALL, CLOSE_ALL, REVEAL_IF_EMPTY],
  'wqa!': [SAVE_ALL, CLOSE_ALL, REVEAL_IF_EMPTY],
  wqall: [SAVE_ALL, CLOSE_ALL, REVEAL_IF_EMPTY],
  xa: [SAVE_ALL, CLOSE_ALL, REVEAL_IF_EMPTY],
  xall: [SAVE_ALL, CLOSE_ALL, REVEAL_IF_EMPTY],
  sp: ['workbench.action.splitEditorDown'],
  split: ['workbench.action.splitEditorDown'],
  vs: ['workbench.action.splitEditor'],
  vsp: ['workbench.action.splitEditor'],
  vsplit: ['workbench.action.splitEditor'],
  // Vim's tab page holds a whole window layout, which is closer to an editor
  // group than to a tab; `:tabnew` opening an empty buffer is what it is used for.
  tabnew: ['workbench.action.files.newUntitledFile'],
  tabclose: [CLOSE, REVEAL_IF_EMPTY],
  tabnext: ['workbench.action.nextEditor'],
  tabprevious: ['workbench.action.previousEditor']
};

/** User-defined `:` names, each mapping to the VS Code commands it runs. */
export type ExCommandTable = Readonly<Record<string, readonly string[]>>;

/** Names the built-in table already owns, which a user entry may not shadow. */
const RESERVED: ReadonlySet<string> = new Set([...Object.keys(COMMANDS), 'marks', 'delmarks', 'delm']);

const VALID_NAME = /^[a-zA-Z][a-zA-Z0-9]*!?$/;

/**
 * Validates a user's table. Entries are dropped rather than half-accepted, and
 * every rejection is reported: a `:` command that silently does nothing is
 * indistinguishable from a typo in the name.
 */
export function compileExCommands(config: Readonly<Record<string, unknown>>): {
  table: ExCommandTable;
  problems: string[];
} {
  const table: Record<string, readonly string[]> = {};
  const problems: string[] = [];

  for (const [name, value] of Object.entries(config)) {
    const where = `vimLike.exCommands["${name}"]`;

    if (!VALID_NAME.test(name)) {
      problems.push(`${where}: 名前は英字で始まり、英数字と末尾の ! だけが使えます。`);
      continue;
    }
    // Shadowing `:w` would be a trap, so the built-ins always win.
    if (RESERVED.has(name)) {
      problems.push(`${where}: この名前は既に使われています。別の名前にしてください。`);
      continue;
    }
    if (!isCommandList(value)) {
      problems.push(`${where}: 実行する VS Code のコマンド ID を1つ以上並べてください。`);
      continue;
    }

    table[name] = [...value];
  }

  return { table, problems };
}

/** The value comes straight from settings.json, so nothing about it is assumed. */
function isCommandList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item: unknown) => typeof item === 'string' && item !== '')
  );
}

export function parseExCommand(input: string, custom: ExCommandTable = {}): ExCommand {
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

  const userCommands = custom[text];
  if (userCommands) return { kind: 'commands', commands: userCommands };

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
