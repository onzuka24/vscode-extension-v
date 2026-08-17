/**
 * VS Code silently ignores a keybinding whose key it cannot parse, so a typo
 * produces no error anywhere — the binding simply never fires. This is the set of
 * key names VS Code accepts; `$`, for instance, is not among them and has to be
 * written as `shift+4`.
 */
const MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'cmd', 'meta', 'win']);

const KEYS = new Set([
  ...'abcdefghijklmnopqrstuvwxyz'.split(''),
  ...'0123456789'.split(''),
  '`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
  ...Array.from({ length: 19 }, (_, index) => `f${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `numpad${index}`),
  'numpad_multiply', 'numpad_add', 'numpad_separator',
  'numpad_subtract', 'numpad_decimal', 'numpad_divide',
  'left', 'up', 'right', 'down', 'pageup', 'pagedown', 'end', 'home',
  'tab', 'enter', 'escape', 'space', 'backspace', 'delete',
  'pausebreak', 'capslock', 'insert'
]);

function isValidChord(chord: string): boolean {
  const parts = chord.split('+');
  const key = parts.pop();
  if (key === undefined || !KEYS.has(key)) return false;
  return parts.every(part => MODIFIERS.has(part));
}

/** True when every chord in a possibly-chorded binding such as `ctrl+w h` parses. */
export function isValidKeyBinding(key: string): boolean {
  return key.split(' ').every(isValidChord);
}
