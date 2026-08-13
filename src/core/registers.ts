import { RegisterContent } from './types';

export const UNNAMED_REGISTER = '"';

/**
 * Vim's register file. Writing to a named register also refreshes the unnamed one,
 * and an uppercase name appends to the lowercase register of the same letter.
 */
export class RegisterStore {
  private readonly registers = new Map<string, RegisterContent>();

  public read(name: string | undefined): RegisterContent | undefined {
    return this.registers.get(normalize(name));
  }

  public write(name: string | undefined, content: RegisterContent): void {
    if (name !== undefined && /^[A-Z]$/.test(name)) {
      const target = name.toLowerCase();
      const existing = this.registers.get(target);
      const appended: RegisterContent = existing
        ? { text: existing.text + content.text, kind: existing.kind }
        : content;
      this.registers.set(target, appended);
      this.registers.set(UNNAMED_REGISTER, appended);
      return;
    }

    const target = normalize(name);
    this.registers.set(target, content);
    if (target !== UNNAMED_REGISTER) {
      this.registers.set(UNNAMED_REGISTER, content);
    }
  }
}

function normalize(name: string | undefined): string {
  if (name === undefined || name === '') return UNNAMED_REGISTER;
  return /^[A-Z]$/.test(name) ? name.toLowerCase() : name;
}
