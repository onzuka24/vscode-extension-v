import { isMotionPrefix, lookupMotion } from './motions';
import { CaseOperatorName, OPERATORS, OperatorName, isOperator } from './operators';
import { isTextObjectKey } from './textobjects';
import { Mode } from './types';

/**
 * Vim's command grammar, `[count]["reg][operator][count]{motion|text-object}`,
 * as one parser over the accumulated keystrokes.
 *
 * Parsing the whole pending string on every key rather than mutating an
 * incremental state machine keeps this a pure function of `(keys, mode)`, which
 * is far easier to test — and the strings involved are never more than a few
 * characters long.
 */
export interface Command {
  readonly count: number;
  readonly hasCount: boolean;
  readonly register: string | undefined;
  readonly operator: OperatorName | undefined;
  readonly motion: string | undefined;
  readonly motionArgument: string | undefined;
  readonly textObject: string | undefined;
  /** `dd`, `cc`, `yy`: the operator doubled, meaning whole lines. */
  readonly linewise: boolean;
  readonly action: string | undefined;
  readonly actionArgument: string | undefined;
}

export type ParseResult =
  | {
      readonly status: 'pending';
      /**
       * True when the next keystroke is consumed as a raw character rather than
       * as a command: the target of `f`/`t`, the replacement of `r`, the name of
       * a register. Vim does not apply key remapping to those, and neither do we —
       * otherwise `fJ` would find whatever `J` is mapped to instead of the letter J.
       */
      readonly awaitingLiteral: boolean;
    }
  | { readonly status: 'invalid' }
  | { readonly status: 'complete'; readonly command: Command };

const PENDING: ParseResult = { status: 'pending', awaitingLiteral: false };
const PENDING_LITERAL: ParseResult = { status: 'pending', awaitingLiteral: true };
const INVALID: ParseResult = { status: 'invalid' };

/** Normal-mode commands that are not operators and take no motion. */
const NORMAL_ACTIONS = new Set([
  'i', 'a', 'I', 'A', 'o', 'O',
  'x', 'X', 's', 'S', 'D', 'C', 'Y',
  'p', 'P', 'u', 'J', '~', 'v', 'V',
  '.'
]);

/** Visual-mode commands. `d`/`c`/`y` are handled as operators over the selection. */
const VISUAL_ACTIONS = new Set(['x', 's', 'p', 'P', 'o', 'v', 'V', 'J']);

/**
 * Visual-mode `u` `U` `~`. They become the case operators rather than actions of
 * their own, because the selection is already the target — exactly as it is for
 * `d`, `c` and `y`. Doing it here is also what keeps Visual `u` from reaching the
 * `u` that means undo in Normal mode.
 */
const VISUAL_CASE_OPERATORS: Readonly<Record<string, CaseOperatorName>> = {
  u: 'gu',
  U: 'gU',
  '~': 'g~'
};

/**
 * First keys of the operators spelled with two keys (`gu`, `gU`, `g~`). The same
 * `g` also begins the `gg` motion, so a lone `g` decides nothing and has to wait.
 */
const OPERATOR_PREFIXES: ReadonlySet<string> = new Set(
  [...OPERATORS].filter(name => name.length > 1).map(name => name[0]!)
);

const ACTIONS_WITH_ARGUMENT = new Set(['r', 'm']);

const TEXT_OBJECT_PREFIXES = new Set(['i', 'a']);

class Scanner {
  private index = 0;

  public constructor(private readonly keys: string) {}

  public peek(): string | undefined {
    return this.keys[this.index];
  }

  public next(): string | undefined {
    return this.keys[this.index++];
  }

  public back(): void {
    this.index--;
  }

  public atEnd(): boolean {
    return this.index >= this.keys.length;
  }

  /** True when `text` is exactly what comes next. */
  public startsWith(text: string): boolean {
    return this.keys.startsWith(text, this.index);
  }

  public skip(count: number): void {
    this.index += count;
  }

  /** A leading `0` is the motion, never a count, so it is left for the caller. */
  public readCount(): { value: number; has: boolean } {
    let digits = '';
    for (;;) {
      const char = this.peek();
      if (char === undefined || char < '0' || char > '9') break;
      if (char === '0' && digits === '') break;
      digits += char;
      this.index++;
    }
    return digits === '' ? { value: 1, has: false } : { value: Number.parseInt(digits, 10), has: true };
  }
}

const EMPTY: Command = {
  count: 1,
  hasCount: false,
  register: undefined,
  operator: undefined,
  motion: undefined,
  motionArgument: undefined,
  textObject: undefined,
  linewise: false,
  action: undefined,
  actionArgument: undefined
};

export function parse(keys: string, mode: Mode): ParseResult {
  const scanner = new Scanner(keys);

  const leadingCount = scanner.readCount();

  let register: string | undefined;
  if (scanner.peek() === '"') {
    scanner.next();
    register = scanner.next();
    if (register === undefined) return PENDING_LITERAL;
  }

  const trailingCount = scanner.readCount();
  // Vim multiplies the counts around a register, so `2"a3dw` deletes six words.
  const count = leadingCount.value * trailingCount.value;
  const hasCount = leadingCount.has || trailingCount.has;
  const base: Command = { ...EMPTY, count, hasCount, register };

  const isVisual = mode === 'visual' || mode === 'visual-line';
  return isVisual ? parseVisual(scanner, base) : parseNormal(scanner, base);
}

function parseNormal(scanner: Scanner, base: Command): ParseResult {
  const key = scanner.next();
  if (key === undefined) return PENDING;

  if (isOperator(key)) return parseOperator(scanner, base, key);

  const twoKey = twoKeyOperator(scanner, key);
  if (twoKey === 'pending') return PENDING;
  if (twoKey) return parseOperator(scanner, base, twoKey);

  if (ACTIONS_WITH_ARGUMENT.has(key)) {
    const argument = scanner.next();
    if (argument === undefined) return PENDING_LITERAL;
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, action: key, actionArgument: argument });
  }

  if (NORMAL_ACTIONS.has(key)) {
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, action: key });
  }

  scanner.back();
  return parseMotion(scanner, base);
}

function parseVisual(scanner: Scanner, base: Command): ParseResult {
  const key = scanner.next();
  if (key === undefined) return PENDING;

  // In Visual mode an operator needs no motion: the selection is the target.
  if (isOperator(key)) {
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, operator: key });
  }

  const twoKey = twoKeyOperator(scanner, key);
  if (twoKey === 'pending') return PENDING;
  if (twoKey) {
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, operator: twoKey });
  }

  const caseOperator = VISUAL_CASE_OPERATORS[key];
  if (caseOperator !== undefined) {
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, operator: caseOperator });
  }

  if (TEXT_OBJECT_PREFIXES.has(key)) {
    const object = scanner.next();
    if (object === undefined) return PENDING;
    if (!isTextObjectKey(object)) return INVALID;
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, textObject: key + object });
  }

  if (VISUAL_ACTIONS.has(key)) {
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...base, action: key });
  }

  scanner.back();
  return parseMotion(scanner, base);
}

/**
 * Consumes the second key of a two-key operator, if that is what this is.
 *
 * `'pending'` means the first key could still become one but the second has not
 * arrived; `undefined` means it is something else entirely and the caller should
 * carry on. Nothing is consumed in either of those cases.
 */
function twoKeyOperator(scanner: Scanner, key: string): OperatorName | 'pending' | undefined {
  if (!OPERATOR_PREFIXES.has(key)) return undefined;

  const second = scanner.peek();
  if (second === undefined) return 'pending';
  if (!isOperator(key + second)) return undefined;

  scanner.next();
  return key + second as OperatorName;
}

function parseOperator(scanner: Scanner, base: Command, operator: OperatorName): ParseResult {
  const innerCount = scanner.readCount();
  const command: Command = {
    ...base,
    operator,
    count: base.count * innerCount.value,
    hasCount: base.hasCount || innerCount.has
  };

  const key = scanner.peek();
  if (key === undefined) return PENDING;

  // The operator doubled means whole lines. For a two-key operator it is the last
  // key that repeats (`guu`), and Vim accepts the whole operator twice as well
  // (`gugu`), so both spellings are taken.
  const doubled = key === operator[operator.length - 1] ? 1 : scanner.startsWith(operator) ? operator.length : 0;
  if (doubled > 0) {
    scanner.skip(doubled);
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...command, linewise: true });
  }

  if (TEXT_OBJECT_PREFIXES.has(key)) {
    scanner.next();
    const object = scanner.next();
    if (object === undefined) return PENDING;
    if (!isTextObjectKey(object)) return INVALID;
    if (!scanner.atEnd()) return INVALID;
    return complete({ ...command, textObject: key + object });
  }

  return parseMotion(scanner, command);
}

function parseMotion(scanner: Scanner, base: Command): ParseResult {
  let keys = '';
  for (;;) {
    const char = scanner.next();
    if (char === undefined) return PENDING;
    keys += char;

    const motion = lookupMotion(keys);
    if (motion) {
      let argument: string | undefined;
      if (motion.needsArgument) {
        argument = scanner.next();
        if (argument === undefined) return PENDING_LITERAL;
      }
      if (!scanner.atEnd()) return INVALID;
      return complete({ ...base, motion: keys, motionArgument: argument });
    }

    if (!isMotionPrefix(keys)) return INVALID;
  }
}

function complete(command: Command): ParseResult {
  return { status: 'complete', command };
}

/** True when the next keystroke is taken literally, so remapping must not apply. */
export function awaitsLiteralKey(keys: string, mode: Mode): boolean {
  const result = parse(keys, mode);
  return result.status === 'pending' && result.awaitingLiteral;
}
