/**
 * A VS Code command as the settings write it.
 *
 * Command IDs appear in two settings — `vimLike.exCommands` and the `commands`
 * of a key binding — and both took a bare ID until commands that do nothing
 * useful without an argument came up (#63). `workbench.action.tasks.runTask`
 * without a task name opens a picker, `workbench.action.terminal.sendSequence`
 * without text sends nothing: neither could be reached from `:` or from a key.
 *
 * This is not the Ex command line growing arguments. What is written here is
 * fixed in the settings; `:w foo` would have to be parsed out of what was typed,
 * which the table deliberately does not do (see `excommands.ts`).
 */
export interface CommandSpec {
  readonly command: string;
  /**
   * One value, not a list of positional arguments — the shape keybindings.json
   * uses. A command wanting several things takes an object. What is inside is
   * passed through untouched: only the command itself knows what it wants.
   */
  readonly args?: unknown;
}

/**
 * Reads `["a.b", { "command": "c.d", "args": … }]` as it arrives from
 * settings.json, where nothing about the value is assumed. Returns null for
 * anything unusable and leaves the reporting to the caller, which knows the
 * setting it came from — a binding that quietly never fires is indistinguishable
 * from a broken feature.
 */
export function parseCommandList(value: unknown): CommandSpec[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const commands: CommandSpec[] = [];
  for (const item of value as readonly unknown[]) {
    const command = parseCommand(item);
    if (command === null) return null;
    commands.push(command);
  }
  return commands;
}

/** The bare ID stays legal: `["git-graph.view"]` is what most entries need. */
function parseCommand(value: unknown): CommandSpec | null {
  if (typeof value === 'string') return value === '' ? null : { command: value };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { command, args } = value as { command?: unknown; args?: unknown };
  if (typeof command !== 'string' || command === '') return null;

  // `args` itself is never checked: every JSON value is a legitimate argument,
  // and what the command accepts is the command's business.
  return 'args' in value ? { command, args } : { command };
}

/** Built-in tables hold plain IDs; this is how they meet the configured ones. */
export function toCommandSpecs(commands: readonly string[]): readonly CommandSpec[] {
  return commands.map(command => ({ command }));
}
