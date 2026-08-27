import { CommandSpec, parseCommandList } from './commands';
import { DEFAULT_LEADER, normalizeKey, resolveLeader } from './keys';
import { Mode } from './types';

/**
 * User-defined key remapping, the mechanism behind settings such as
 * `nnoremap J 10j`. Rules replace a key sequence with another sequence of keys,
 * or invoke VS Code commands directly.
 *
 * Expansions are never themselves remapped, matching Vim's `nnoremap` rather
 * than `nmap`; without that, `nnoremap j gj` would loop forever.
 */
export interface RemapRule {
  readonly before: readonly string[];
  readonly after?: readonly string[];
  /** Bare IDs are written as strings; `{ command, args }` is the long form. */
  readonly commands?: readonly (string | CommandSpec)[];
}

/** The same rule once validated: keys normalised, commands in their long form. */
export interface CompiledRemapRule {
  readonly before: readonly string[];
  readonly after?: readonly string[];
  readonly commands?: readonly CommandSpec[];
}

/** Rules are shared between Visual and Visual Line, as `vnoremap` is in Vim. */
export type RemapScope = 'normal' | 'visual';

export interface RemapConfiguration {
  readonly normal?: readonly RemapRule[];
  readonly visual?: readonly RemapRule[];
  /** What `<leader>` stands for. A bare character or `<Space>`; defaults to Space. */
  readonly leader?: string;
}

export type RemapMatch =
  | { readonly kind: 'none' }
  /** A longer rule starts with these keys, so more input is needed. */
  | { readonly kind: 'prefix' }
  | { readonly kind: 'exact'; readonly rule: CompiledRemapRule };

const NO_MATCH: RemapMatch = { kind: 'none' };
const PREFIX: RemapMatch = { kind: 'prefix' };

export class RemapTable {
  private constructor(
    private readonly rules: Readonly<Record<RemapScope, readonly CompiledRemapRule[]>>,
    /** The resolved leader key, needed to render pending sequences readably. */
    public readonly leader: string
  ) {}

  public static empty(): RemapTable {
    return new RemapTable({ normal: [], visual: [] }, DEFAULT_LEADER);
  }

  /**
   * Validates and normalises configured rules. Invalid rules are dropped and
   * reported rather than ignored, because a silently discarded binding looks
   * exactly like a broken feature to whoever wrote it.
   */
  public static from(configuration: RemapConfiguration): { table: RemapTable; problems: string[] } {
    const problems: string[] = [];

    let leader = DEFAULT_LEADER;
    if (configuration.leader !== undefined && configuration.leader !== '') {
      const resolved = resolveLeader(configuration.leader);
      if (resolved === null) {
        problems.push(`vimLike.leader の "${configuration.leader}" は解釈できないキーです。`);
      } else {
        leader = resolved;
      }
    }

    const normal = compile(configuration.normal ?? [], 'normalModeKeyBindings', problems, leader);
    const visual = compile(configuration.visual ?? [], 'visualModeKeyBindings', problems, leader);
    return { table: new RemapTable({ normal, visual }, leader), problems };
  }

  public get isEmpty(): boolean {
    return this.rules.normal.length === 0 && this.rules.visual.length === 0;
  }

  /**
   * `prefix` wins over `exact` when both are possible: with `<leader>w` and
   * `<leader>wh` both bound, the shorter one can never fire. Vim resolves this
   * with a timeout; we deliberately have none, so that a keystroke is never
   * acted upon merely because the user paused.
   */
  public match(keys: readonly string[], mode: Mode): RemapMatch {
    const scope = scopeOf(mode);
    if (!scope) return NO_MATCH;

    let exact: CompiledRemapRule | undefined;
    let prefixed = false;

    for (const rule of this.rules[scope]) {
      if (rule.before.length > keys.length) {
        if (startsWith(rule.before, keys)) prefixed = true;
      } else if (rule.before.length === keys.length && startsWith(rule.before, keys)) {
        exact ??= rule;
      }
    }

    if (prefixed) return PREFIX;
    return exact ? { kind: 'exact', rule: exact } : NO_MATCH;
  }
}

function scopeOf(mode: Mode): RemapScope | undefined {
  if (mode === 'normal') return 'normal';
  if (mode === 'visual' || mode === 'visual-line') return 'visual';
  return undefined; // Insert mode is not remapped.
}

function startsWith(sequence: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((key, index) => sequence[index] === key);
}

function compile(
  rules: readonly RemapRule[],
  setting: string,
  problems: string[],
  leader: string
): CompiledRemapRule[] {
  const compiled: CompiledRemapRule[] = [];

  rules.forEach((rule, index) => {
    const where = `vimLike.${setting}[${index}]`;

    const before = normalizeAll(rule.before, `${where}.before`, problems, leader);
    if (!before) return;
    if (before.length === 0) {
      problems.push(`${where}.before は空にできません。`);
      return;
    }

    const rawAfter = rule.after ?? [];
    const commands = rule.commands ?? [];
    if (rawAfter.length > 0 === commands.length > 0) {
      problems.push(`${where} には after か commands のどちらか一方を指定してください。`);
      return;
    }

    if (commands.length > 0) {
      const parsed = parseCommandList(commands);
      if (parsed === null) {
        problems.push(
          `${where}.commands には VS Code のコマンド ID を並べてください。` +
            `引数を渡すものは { "command": "...", "args": ... } と書きます。`
        );
        return;
      }
      compiled.push({ before, commands: parsed });
      return;
    }

    const after = normalizeAll(rawAfter, `${where}.after`, problems, leader);
    if (!after) return;
    compiled.push({ before, after });
  });

  return compiled;
}

function normalizeAll(
  keys: readonly string[],
  where: string,
  problems: string[],
  leader: string
): string[] | null {
  const normalized: string[] = [];
  for (const key of keys) {
    const value = normalizeKey(key, leader);
    if (value === null) {
      problems.push(`${where} の "${key}" は解釈できないキーです。`);
      return null;
    }
    normalized.push(value);
  }
  return normalized;
}
