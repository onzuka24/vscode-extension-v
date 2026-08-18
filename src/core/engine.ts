import { Action } from './actions';
import { TextBuffer, clampLine, lastLine, lineLength, linewiseRange, linewiseText } from './buffer';
import { clampCursor, firstNonBlank, indentOf, maxColumn } from './cursor';
import { Motion, MotionContext, lookupMotion } from './motions';
import {
  IndentOperatorName,
  OperatorName,
  Target,
  applyOperator,
  isIndentOperator,
  paste,
  resolveMotionTarget,
  targetLines
} from './operators';
import { SPECIAL_KEYS, describeKeys, isSpecialKey } from './keys';
import { Command, awaitsLiteralKey, parse } from './parser';
import { RegisterStore } from './registers';
import { RemapTable } from './remap';
import { resolveTextObject } from './textobjects';
import { Mode, Position, Range, RegisterContent, comparePositions, pos } from './types';

export interface VimState {
  readonly mode: Mode;
  /** Keys typed so far that do not yet form a complete command, e.g. `d` or `2f`. */
  readonly pendingKeys: string;
  /** Keys held while a longer remap rule might still match, e.g. `<leader>w`. */
  readonly remapPending: readonly string[];
  /** Column `j` and `k` aim for; preserved across short lines as Vim does. */
  readonly desiredColumn: number;
  readonly visualAnchor: Position | null;
}

export interface EngineResult {
  readonly state: VimState;
  readonly actions: readonly Action[];
  /**
   * False means the keystroke was not consumed and the adapter should hand it to
   * VS Code's own `type` handler. Normal and Visual mode always report true —
   * swallowing unbound keys is precisely what makes them modes rather than a set
   * of shortcuts over an editable buffer.
   */
  readonly handled: boolean;
  /**
   * Keys a remap expanded to, which the caller must feed back one at a time
   * through `handleLiteralKey`, re-reading the buffer between each.
   *
   * The engine cannot run them itself: an expansion such as `ddp` needs the
   * document as it stands *after* the delete, and the core has no way to apply
   * an edit. Feeding them back also makes the non-recursion of `nnoremap` fall
   * out naturally, since `handleLiteralKey` never consults the remap table.
   */
  readonly replay?: readonly string[];
}

export function createState(mode: Mode = 'normal', cursor: Position = pos(0, 0)): VimState {
  return { mode, pendingKeys: '', remapPending: [], desiredColumn: cursor.character, visualAnchor: null };
}

/**
 * Re-syncs the state to a cursor this engine did not place — a mouse click, an
 * arrow key, a jump from Go to Definition. Without this the column `j` and `k`
 * aim for would still reflect the last Vim motion.
 */
export function withExternalCursor(state: VimState, cursor: Position): VimState {
  return { ...state, pendingKeys: '', remapPending: [], desiredColumn: cursor.character };
}

/**
 * The keys the engine is currently holding, rendered for display.
 *
 * A half-typed sequence is otherwise invisible: with Space as the leader there is
 * nothing on screen to distinguish "waiting for the rest of `<leader>w`" from
 * "ignored your keystroke".
 */
export function describePending(state: VimState, leader: string): string {
  return describeKeys([...state.pendingKeys, ...state.remapPending], leader);
}

/** Normal-mode keys that are just shorthand for an operator, e.g. `D` for `d$`. */
const OPERATOR_SHORTHAND: Readonly<Record<string, Partial<Command>>> = {
  D: { operator: 'd', motion: '$' },
  C: { operator: 'c', motion: '$' },
  Y: { operator: 'y', linewise: true },
  S: { operator: 'c', linewise: true }
};

export class VimEngine {
  private readonly registers = new RegisterStore();
  private remaps: RemapTable = RemapTable.empty();

  public setRemaps(table: RemapTable): void {
    this.remaps = table;
  }

  /**
   * Entry point for a key the user actually pressed. Applies remapping, then
   * hands what remains to `handleLiteralKey`.
   */
  public handleKey(state: VimState, key: string, buffer: TextBuffer, cursor: Position): EngineResult {
    // Escape and the Ctrl combinations are not remappable, and they must work in
    // Insert mode too, so they bypass everything below.
    if (isSpecialKey(key)) return this.handleLiteralKey(state, key, buffer, cursor);

    if (state.mode === 'insert') {
      return { state, actions: [], handled: false };
    }

    // A pending `f`, `t`, `r` or `"` swallows the next key as a raw character.
    // Vim does not remap those, so neither do we: `fJ` must find the letter J
    // even when `J` is bound to something else.
    if (this.remaps.isEmpty || awaitsLiteralKey(state.pendingKeys, state.mode)) {
      return this.handleLiteralKey(state, key, buffer, cursor);
    }

    const buffered = [...state.remapPending, key];
    const match = this.remaps.match(buffered, state.mode);

    if (match.kind === 'prefix') {
      return { state: { ...state, remapPending: buffered }, actions: [], handled: true };
    }

    const cleared: VimState = { ...state, remapPending: [] };

    if (match.kind === 'exact') {
      const { rule } = match;
      if (rule.commands) {
        return {
          state: cleared,
          actions: rule.commands.map(command => ({ type: 'executeCommand', command }) as const),
          handled: true
        };
      }
      return { state: cleared, actions: [], handled: true, replay: rule.after ?? [] };
    }

    // Nothing matched. Keys held back while a longer rule was still possible are
    // played through as if they had just been typed.
    if (buffered.length > 1) {
      return { state: cleared, actions: [], handled: true, replay: buffered };
    }
    return this.handleLiteralKey(cleared, key, buffer, cursor);
  }

  /**
   * A key that has already passed through remapping, or that must bypass it.
   * Callers replay a remap expansion through here, which is what stops an
   * expansion from being remapped again.
   */
  public handleLiteralKey(state: VimState, key: string, buffer: TextBuffer, cursor: Position): EngineResult {
    if (key === SPECIAL_KEYS.escape) return this.escape(state, buffer, cursor);
    if (key === SPECIAL_KEYS.redo) {
      return {
        state: { ...state, pendingKeys: '', remapPending: [] },
        actions: [{ type: 'executeCommand', command: 'redo' }],
        handled: true
      };
    }
    if (isSpecialKey(key)) return this.unchanged(state);

    if (state.mode === 'insert') {
      return { state, actions: [], handled: false };
    }

    const keys = state.pendingKeys + key;
    const result = parse(keys, state.mode);

    if (result.status === 'pending') {
      return { state: { ...state, pendingKeys: keys }, actions: [], handled: true };
    }
    if (result.status === 'invalid') {
      return { state: { ...state, pendingKeys: '' }, actions: [], handled: true };
    }
    return this.execute({ ...state, pendingKeys: '' }, result.command, buffer, cursor);
  }

  /** Escape arrives as a keybinding rather than through `type`. */
  public escape(state: VimState, buffer: TextBuffer, cursor: Position): EngineResult {
    // Leaving Insert mode steps the caret back onto the last character typed,
    // because in Normal mode the cursor sits on a character rather than after it.
    const target = state.mode === 'insert' ? pos(cursor.line, Math.max(0, cursor.character - 1)) : cursor;
    const position = clampCursor(buffer, target, 'normal');
    return {
      state: { mode: 'normal', pendingKeys: '', remapPending: [], desiredColumn: position.character, visualAnchor: null },
      actions: [
        { type: 'setCursor', position, toFirstNonBlank: false },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  public setMode(state: VimState, mode: Mode, cursor: Position): EngineResult {
    return {
      state: { ...state, mode, pendingKeys: '', visualAnchor: mode === 'normal' ? null : cursor },
      actions: [{ type: 'setMode', mode }],
      handled: true
    };
  }

  private execute(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    if (command.operator) return this.runOperator(state, command, buffer, cursor);
    if (command.action) return this.runAction(state, command, buffer, cursor);
    if (command.textObject) return this.selectTextObject(state, command, buffer, cursor);
    if (command.motion) return this.runMotion(state, command, buffer, cursor);
    return this.unchanged(state);
  }

  // ---------------------------------------------------------------- motions

  private runMotion(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    const motion = command.motion === undefined ? undefined : lookupMotion(command.motion);
    if (!motion) return this.unchanged(state);

    const destination = motion.exec(this.motionContext(state, command, buffer, cursor, false));
    if (!destination) return this.unchanged(state);

    const position = clampCursor(buffer, destination, state.mode);
    const desiredColumn = nextDesiredColumn(motion, state.desiredColumn, position);

    return {
      state: { ...state, desiredColumn },
      actions: [...this.moveActions(state, position), { type: 'reveal' }],
      handled: true
    };
  }

  /** In Visual mode a motion drags the active end; in Normal mode it moves the caret. */
  private moveActions(state: VimState, position: Position): Action[] {
    if (isVisual(state.mode) && state.visualAnchor) {
      return [
        { type: 'setSelection', anchor: state.visualAnchor, active: position, linewise: state.mode === 'visual-line' }
      ];
    }
    return [{ type: 'setCursor', position, toFirstNonBlank: false }];
  }

  private motionContext(
    state: VimState,
    command: Command,
    buffer: TextBuffer,
    cursor: Position,
    forOperator: boolean
  ): MotionContext {
    return {
      buffer,
      from: cursor,
      count: command.count,
      hasCount: command.hasCount,
      mode: state.mode,
      desiredColumn: state.desiredColumn,
      forOperator,
      argument: command.motionArgument
    };
  }

  // -------------------------------------------------------------- operators

  private runOperator(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    const operator = command.operator;
    if (!operator) return this.unchanged(state);

    const target = this.resolveTarget(state, command, buffer, cursor, operator);
    if (!target) return this.unchanged(state);

    if (isIndentOperator(operator)) return this.runIndent(state, command, buffer, target, operator);

    const origin = isVisual(state.mode) ? startOf(target, cursor) : cursor;
    const outcome = applyOperator(operator, buffer, target, origin);
    this.registers.write(command.register, outcome.register);

    const actions: Action[] = [];
    if (outcome.edit) actions.push({ type: 'edit', range: outcome.edit.range, text: outcome.edit.text });
    actions.push({ type: 'setCursor', position: outcome.cursor, toFirstNonBlank: outcome.toFirstNonBlank });
    actions.push({ type: 'setMode', mode: outcome.mode });
    actions.push({ type: 'reveal' });

    return {
      state: {
        mode: outcome.mode,
        pendingKeys: '',
        remapPending: [],
        desiredColumn: outcome.cursor.character,
        visualAnchor: null
      },
      actions,
      handled: true
    };
  }

  /**
   * `>` and `<`. No edit and no register: the lines to move are named and the
   * editor performs the shift, so that the step width and tabs-versus-spaces
   * follow VS Code's settings for that language rather than a number chosen here.
   *
   * The count means different things on the two sides, as in Vim. In Normal mode
   * it has already been spent on the extent (`3>>` is three lines, `>2j` is
   * three lines); in Visual mode the extent is the selection, so the count is
   * how many steps to move it (`3>`). Vim also drops the selection afterwards,
   * and the caret lands on the first non-blank of the topmost line.
   */
  private runIndent(
    state: VimState,
    command: Command,
    buffer: TextBuffer,
    target: Target,
    operator: IndentOperatorName
  ): EngineResult {
    const { startLine, endLine } = targetLines(buffer, target);
    const position = pos(startLine, 0);

    return {
      state: { mode: 'normal', pendingKeys: '', remapPending: [], desiredColumn: 0, visualAnchor: null },
      actions: [
        {
          type: 'indent',
          startLine,
          endLine,
          direction: operator === '>' ? 'in' : 'out',
          levels: isVisual(state.mode) ? command.count : 1
        },
        { type: 'setCursor', position, toFirstNonBlank: true },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private resolveTarget(
    state: VimState,
    command: Command,
    buffer: TextBuffer,
    cursor: Position,
    operator: OperatorName
  ): Target | null {
    if (isVisual(state.mode)) return this.visualTarget(state, buffer, cursor);

    if (command.linewise) {
      return { kind: 'linewise', startLine: cursor.line, endLine: clampLine(buffer, cursor.line + command.count - 1) };
    }

    if (command.textObject) {
      const range = resolveTextObject(buffer, cursor, command.textObject);
      return range ? { kind: 'characterwise', range } : null;
    }

    const motion = command.motion === undefined ? undefined : lookupMotion(command.motion);
    if (!motion) return null;
    return resolveMotionTarget(motion, this.motionContext(state, command, buffer, cursor, true), operator);
  }

  private visualTarget(state: VimState, buffer: TextBuffer, cursor: Position): Target {
    const anchor = state.visualAnchor ?? cursor;

    if (state.mode === 'visual-line') {
      return {
        kind: 'linewise',
        startLine: Math.min(anchor.line, cursor.line),
        endLine: Math.max(anchor.line, cursor.line)
      };
    }

    const forwards = comparePositions(anchor, cursor) <= 0;
    const start = forwards ? anchor : cursor;
    const last = forwards ? cursor : anchor;
    // Visual selections are inclusive of the character under the active end.
    const end = pos(last.line, Math.min(last.character + 1, lineLength(buffer, last.line)));
    return { kind: 'characterwise', range: { start, end } };
  }

  private selectTextObject(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    if (!isVisual(state.mode) || command.textObject === undefined) return this.unchanged(state);

    const range = resolveTextObject(buffer, cursor, command.textObject);
    if (!range) return this.unchanged(state);

    const active = clampCursor(buffer, pos(range.end.line, range.end.character - 1), state.mode);
    return {
      state: { ...state, visualAnchor: range.start, desiredColumn: active.character },
      actions: [
        { type: 'setSelection', anchor: range.start, active, linewise: state.mode === 'visual-line' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  // ---------------------------------------------------------------- actions

  private runAction(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    const key = command.action;
    if (key === undefined) return this.unchanged(state);

    const shorthand = OPERATOR_SHORTHAND[key];
    if (shorthand && !isVisual(state.mode)) {
      return this.runOperator(state, { ...command, action: undefined, ...shorthand }, buffer, cursor);
    }

    if (isVisual(state.mode)) {
      if (key === 'x') return this.runOperator(state, { ...command, action: undefined, operator: 'd' }, buffer, cursor);
      if (key === 's') return this.runOperator(state, { ...command, action: undefined, operator: 'c' }, buffer, cursor);
      // `o` opens a line in Normal mode but swaps the selection ends in Visual mode.
      if (key === 'o') return this.swapVisualEnds(state, cursor);
    }

    switch (key) {
      case 'i':
        return this.enterInsert(state, cursor);
      case 'a':
        return this.enterInsert(state, pos(cursor.line, Math.min(cursor.character + 1, lineLength(buffer, cursor.line))));
      case 'I':
        return this.enterInsert(state, pos(cursor.line, firstNonBlank(buffer, cursor.line)));
      case 'A':
        return this.enterInsert(state, pos(cursor.line, lineLength(buffer, cursor.line)));
      case 'o':
        return this.openLine(state, buffer, cursor, 'below');
      case 'O':
        return this.openLine(state, buffer, cursor, 'above');
      case 'x':
        return this.deleteCharacters(state, command, buffer, cursor, 'after');
      case 'X':
        return this.deleteCharacters(state, command, buffer, cursor, 'before');
      case 's':
        return this.substitute(state, command, buffer, cursor);
      case 'p':
        return this.pasteRegister(state, command, buffer, cursor, false);
      case 'P':
        return this.pasteRegister(state, command, buffer, cursor, true);
      case 'r':
        return this.replaceCharacters(state, command, buffer, cursor);
      case 'J':
        return this.joinLines(state, command, buffer, cursor);
      case '~':
        return this.toggleCase(state, command, buffer, cursor);
      case 'u':
        return {
          state: { ...state, mode: 'normal', visualAnchor: null },
          actions: [{ type: 'executeCommand', command: 'undo' }, { type: 'setMode', mode: 'normal' }],
          handled: true
        };
      case 'v':
        return this.toggleVisual(state, cursor, 'visual');
      case 'V':
        return this.toggleVisual(state, cursor, 'visual-line');
      default:
        return this.unchanged(state);
    }
  }

  private enterInsert(state: VimState, position: Position): EngineResult {
    return {
      state: { mode: 'insert', pendingKeys: '', remapPending: [], desiredColumn: position.character, visualAnchor: null },
      actions: [
        { type: 'setCursor', position, toFirstNonBlank: false },
        { type: 'setMode', mode: 'insert' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  /**
   * `o` and `O`. Inserting a bare `\n` next to the cursor is the obvious
   * implementation and it is wrong twice over: the caret stays on the original
   * line because the insertion sits on the far side of it, and a lone LF ends up
   * in a CRLF file. Using the buffer's own separator and naming the resulting
   * caret position explicitly avoids both.
   */
  private openLine(state: VimState, buffer: TextBuffer, cursor: Position, where: 'above' | 'below'): EngineResult {
    const indent = indentOf(buffer, cursor.line);

    if (where === 'below') {
      const at = pos(cursor.line, lineLength(buffer, cursor.line));
      return {
        state: { mode: 'insert', pendingKeys: '', remapPending: [], desiredColumn: indent.length, visualAnchor: null },
        actions: [
          { type: 'edit', range: { start: at, end: at }, text: buffer.eol + indent },
          { type: 'setCursor', position: pos(cursor.line + 1, indent.length), toFirstNonBlank: false },
          { type: 'setMode', mode: 'insert' },
          { type: 'reveal' }
        ],
        handled: true
      };
    }

    const at = pos(cursor.line, 0);
    return {
      state: { mode: 'insert', pendingKeys: '', remapPending: [], desiredColumn: indent.length, visualAnchor: null },
      actions: [
        { type: 'edit', range: { start: at, end: at }, text: indent + buffer.eol },
        { type: 'setCursor', position: pos(cursor.line, indent.length), toFirstNonBlank: false },
        { type: 'setMode', mode: 'insert' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private deleteCharacters(
    state: VimState,
    command: Command,
    buffer: TextBuffer,
    cursor: Position,
    direction: 'before' | 'after'
  ): EngineResult {
    const length = lineLength(buffer, cursor.line);
    const start = direction === 'after' ? cursor.character : Math.max(0, cursor.character - command.count);
    const end = direction === 'after' ? Math.min(cursor.character + command.count, length) : cursor.character;
    if (start === end) return this.unchanged(state);

    const range: Range = { start: pos(cursor.line, start), end: pos(cursor.line, end) };
    this.registers.write(command.register, {
      text: buffer.lineAt(cursor.line).slice(start, end),
      kind: 'characterwise'
    });

    return {
      state: { ...state, mode: 'normal', desiredColumn: start, visualAnchor: null },
      actions: [
        { type: 'edit', range, text: '' },
        { type: 'setCursor', position: pos(cursor.line, start), toFirstNonBlank: false },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  /** `s` deletes forward like `x` and then enters Insert mode. */
  private substitute(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    const length = lineLength(buffer, cursor.line);
    const end = Math.min(cursor.character + command.count, length);
    const range: Range = { start: cursor, end: pos(cursor.line, end) };

    this.registers.write(command.register, {
      text: buffer.lineAt(cursor.line).slice(cursor.character, end),
      kind: 'characterwise'
    });

    return {
      state: { mode: 'insert', pendingKeys: '', remapPending: [], desiredColumn: cursor.character, visualAnchor: null },
      actions: [
        { type: 'edit', range, text: '' },
        { type: 'setCursor', position: cursor, toFirstNonBlank: false },
        { type: 'setMode', mode: 'insert' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private pasteRegister(
    state: VimState,
    command: Command,
    buffer: TextBuffer,
    cursor: Position,
    before: boolean
  ): EngineResult {
    const content = this.registers.read(command.register);
    if (!content) return this.unchanged(state);

    if (isVisual(state.mode)) return this.pasteOverSelection(state, command, buffer, cursor, content);

    const outcome = paste(buffer, cursor, content, command.count, before);
    return {
      state: { ...state, mode: 'normal', desiredColumn: outcome.cursor.character, visualAnchor: null },
      actions: [
        { type: 'edit', range: outcome.edit.range, text: outcome.edit.text },
        { type: 'setCursor', position: outcome.cursor, toFirstNonBlank: outcome.toFirstNonBlank },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  /** Visual `p` replaces the selection and yanks what it replaced, as Vim does. */
  private pasteOverSelection(
    state: VimState,
    command: Command,
    buffer: TextBuffer,
    cursor: Position,
    content: RegisterContent
  ): EngineResult {
    const target = this.visualTarget(state, buffer, cursor);
    const range =
      target.kind === 'characterwise' ? target.range : linewiseRange(buffer, target.startLine, target.endLine);
    const replaced =
      target.kind === 'characterwise'
        ? { text: sliceRange(buffer, target.range), kind: 'characterwise' as const }
        : { text: linewiseText(buffer, target.startLine, target.endLine), kind: 'linewise' as const };

    this.registers.write(undefined, replaced);
    const text = content.text.split(/\r\n|\n/).join(buffer.eol);

    return {
      state: { mode: 'normal', pendingKeys: '', remapPending: [], desiredColumn: range.start.character, visualAnchor: null },
      actions: [
        { type: 'edit', range, text },
        { type: 'setCursor', position: range.start, toFirstNonBlank: false },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private replaceCharacters(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    const replacement = command.actionArgument;
    if (replacement === undefined) return this.unchanged(state);

    const length = lineLength(buffer, cursor.line);
    // Vim refuses `r` when the count runs past the end of the line.
    if (cursor.character + command.count > length) return this.unchanged(state);

    const range: Range = { start: cursor, end: pos(cursor.line, cursor.character + command.count) };
    const position = pos(cursor.line, cursor.character + command.count - 1);

    return {
      state: { ...state, mode: 'normal', desiredColumn: position.character, visualAnchor: null },
      actions: [
        { type: 'edit', range, text: replacement.repeat(command.count) },
        { type: 'setCursor', position, toFirstNonBlank: false },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private joinLines(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    if (cursor.line >= lastLine(buffer)) return this.unchanged(state);

    const last = clampLine(buffer, cursor.line + Math.max(command.count - 1, 1));
    let joined = buffer.lineAt(cursor.line);
    let caret = joined.length;

    for (let line = cursor.line + 1; line <= last; line++) {
      const trimmed = buffer.lineAt(line).slice(firstNonBlank(buffer, line));
      const separator = joined.length === 0 || trimmed.length === 0 ? '' : ' ';
      caret = joined.length;
      joined += separator + trimmed;
    }

    const range: Range = { start: pos(cursor.line, 0), end: pos(last, lineLength(buffer, last)) };
    const position = pos(cursor.line, caret);

    return {
      state: { ...state, mode: 'normal', desiredColumn: caret, visualAnchor: null },
      actions: [
        { type: 'edit', range, text: joined },
        { type: 'setCursor', position, toFirstNonBlank: false },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private toggleCase(state: VimState, command: Command, buffer: TextBuffer, cursor: Position): EngineResult {
    const text = buffer.lineAt(cursor.line);
    const end = Math.min(cursor.character + command.count, text.length);
    if (end === cursor.character) return this.unchanged(state);

    const flipped = [...text.slice(cursor.character, end)]
      .map(char => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()))
      .join('');
    const position = pos(cursor.line, Math.min(end, maxColumn(buffer, cursor.line, 'normal')));

    return {
      state: { ...state, mode: 'normal', desiredColumn: position.character, visualAnchor: null },
      actions: [
        { type: 'edit', range: { start: cursor, end: pos(cursor.line, end) }, text: flipped },
        { type: 'setCursor', position, toFirstNonBlank: false },
        { type: 'setMode', mode: 'normal' },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private toggleVisual(state: VimState, cursor: Position, requested: 'visual' | 'visual-line'): EngineResult {
    const mode: Mode = state.mode === requested ? 'normal' : requested;
    const anchor = mode === 'normal' ? null : (state.visualAnchor ?? cursor);

    const actions: Action[] = [{ type: 'setMode', mode }];
    if (mode === 'normal') {
      actions.push({ type: 'setCursor', position: cursor, toFirstNonBlank: false });
    } else if (anchor) {
      actions.push({ type: 'setSelection', anchor, active: cursor, linewise: mode === 'visual-line' });
    }

    return { state: { ...state, mode, pendingKeys: '', visualAnchor: anchor }, actions, handled: true };
  }

  private swapVisualEnds(state: VimState, cursor: Position): EngineResult {
    if (!state.visualAnchor) return this.unchanged(state);
    return {
      state: { ...state, visualAnchor: cursor, desiredColumn: state.visualAnchor.character },
      actions: [
        {
          type: 'setSelection',
          anchor: cursor,
          active: state.visualAnchor,
          linewise: state.mode === 'visual-line'
        },
        { type: 'reveal' }
      ],
      handled: true
    };
  }

  private unchanged(state: VimState): EngineResult {
    return { state: { ...state, pendingKeys: '', remapPending: [] }, actions: [], handled: true };
  }
}

export function isVisual(mode: Mode): boolean {
  return mode === 'visual' || mode === 'visual-line';
}

function nextDesiredColumn(motion: Motion, current: number, position: Position): number {
  switch (motion.desiredColumn) {
    case 'keep':
      return current;
    case 'eol':
      return Number.MAX_SAFE_INTEGER;
    default:
      return position.character;
  }
}

function startOf(target: Target, fallback: Position): Position {
  return target.kind === 'characterwise' ? target.range.start : pos(target.startLine, fallback.character);
}

function sliceRange(buffer: TextBuffer, range: Range): string {
  const lines: string[] = [];
  for (let line = range.start.line; line <= range.end.line; line++) {
    const text = buffer.lineAt(line);
    const from = line === range.start.line ? range.start.character : 0;
    const to = line === range.end.line ? range.end.character : text.length;
    lines.push(text.slice(from, to));
  }
  return lines.join(buffer.eol);
}
