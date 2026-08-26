import { RegisterContent } from './types';

export const UNNAMED_REGISTER = '"';

/**
 * `"*` and `"+` both name the system clipboard, as they do in Vim. Two names for
 * one thing there as well — the distinction only ever mattered on X11, and this
 * runs where VS Code does.
 */
export const CLIPBOARD_REGISTER = '+';

export function isClipboardRegister(name: string | undefined): boolean {
  return name === '+' || name === '*';
}

/**
 * Vim's register file. Writing to a named register also refreshes the unnamed one,
 * and an uppercase name appends to the lowercase register of the same letter.
 *
 * The clipboard is a register like any other from in here, which is the point:
 * the engine stays synchronous and pure. Keeping it in step with the real one is
 * the adapter's job — it pushes the outside world in with `setClipboard` before a
 * paste, and carries our writes out when `write` reports one.
 */
export class RegisterStore {
  private readonly registers = new Map<string, RegisterContent>();
  /** The last text we sent out, so a clipboard we wrote keeps its linewise-ness. */
  private lastWritten: RegisterContent | undefined;

  public read(name: string | undefined): RegisterContent | undefined {
    return this.registers.get(normalize(name));
  }

  /** True when the write belongs in the system clipboard as well. */
  public write(name: string | undefined, content: RegisterContent): boolean {
    if (name !== undefined && /^[A-Z]$/.test(name)) {
      const target = name.toLowerCase();
      const existing = this.registers.get(target);
      const appended: RegisterContent = existing
        ? { text: existing.text + content.text, kind: existing.kind }
        : content;
      this.registers.set(target, appended);
      this.registers.set(UNNAMED_REGISTER, appended);
      return false;
    }

    const target = normalize(name);
    this.registers.set(target, content);
    if (target !== UNNAMED_REGISTER) {
      this.registers.set(UNNAMED_REGISTER, content);
    }

    if (!isClipboardRegister(target)) return false;
    this.lastWritten = content;
    return true;
  }

  /**
   * Hands over what the system clipboard currently holds.
   *
   * The clipboard carries text and nothing else, so whether it is a run of lines
   * or a run of characters has to be guessed — except when the text is still what
   * we put there, in which case we remember. That is what keeps `yy` followed by
   * `p` pasting a whole line rather than jamming it into the middle of one.
   *
   * For anything else the rule is Vim's: text that ends in a line break is a set
   * of lines. It is what every editor's line-copy produces.
   */
  public setClipboard(text: string): void {
    const content: RegisterContent =
      this.lastWritten?.text === text
        ? this.lastWritten
        : { text, kind: text.endsWith('\n') ? 'linewise' : 'characterwise' };

    // One entry, because `normalize` folds `*` onto `+`.
    this.registers.set(CLIPBOARD_REGISTER, content);
  }
}

function normalize(name: string | undefined): string {
  if (name === undefined || name === '') return UNNAMED_REGISTER;
  if (isClipboardRegister(name)) return CLIPBOARD_REGISTER;
  return /^[A-Z]$/.test(name) ? name.toLowerCase() : name;
}
