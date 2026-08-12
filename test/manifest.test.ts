import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(__dirname, '..', '..');

interface Manifest {
  contributes: {
    commands: { command: string; title: string }[];
    keybindings: { command: string; key: string; when?: string }[];
  };
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;
const extensionSource = readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');

/**
 * VS Code silently ignores a keybinding whose key it cannot parse, so a typo
 * produces no error anywhere — the binding simply never fires. This list is the
 * set of key names VS Code accepts; `$`, for instance, is not among them and has
 * to be written as `shift+4`.
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

test('every contributed keybinding uses a key VS Code can parse', () => {
  for (const binding of manifest.contributes.keybindings) {
    for (const chord of binding.key.split(' ')) {
      assert.ok(isValidChord(chord), `"${binding.key}" is not a valid key for ${binding.command}`);
    }
  }
});

test('every contributed command is registered by the extension', () => {
  for (const { command } of manifest.contributes.commands) {
    assert.ok(
      extensionSource.includes(`'${command}'`),
      `${command} is contributed in package.json but never registered in src/extension.ts`
    );
  }
});

test('every keybinding targets a command this extension or VS Code provides', () => {
  const contributed = new Set(manifest.contributes.commands.map(entry => entry.command));
  for (const { command } of manifest.contributes.keybindings) {
    const builtIn = command.startsWith('workbench.') || command.startsWith('editor.');
    assert.ok(contributed.has(command) || builtIn, `${command} is bound to a key but is not defined anywhere`);
  }
});

/**
 * Editor keybindings that fire without `editorTextFocus` steal keys from the
 * terminal, the find widget and every other input in the workbench. Requiring the
 * guard here is cheaper than rediscovering it from a bug report.
 */
test('every keybinding is scoped to the editor and to Vim being active', () => {
  for (const binding of manifest.contributes.keybindings) {
    const when = binding.when ?? '';
    assert.ok(when.includes('vimLike.active'), `${binding.key} does not check that Vim mode is enabled`);
    assert.ok(when.includes('editorTextFocus'), `${binding.key} is not scoped to editor focus`);
  }
});

test('Escape does not swallow the widgets that already use it', () => {
  const escape = manifest.contributes.keybindings.find(binding => binding.key === 'escape');
  assert.ok(escape, 'escape should be bound');
  for (const guard of ['!suggestWidgetVisible', '!parameterHintsVisible', '!renameInputVisible', '!inSnippetMode']) {
    assert.ok(escape.when?.includes(guard), `the escape binding must yield when ${guard.slice(1)}`);
  }
});

/**
 * The core owes its testability to knowing nothing about VS Code. Enforcing the
 * dependency direction here means a stray import fails the build rather than
 * quietly making a module untestable.
 */
test('the core layer never imports vscode', () => {
  const directory = path.join(ROOT, 'src', 'core');
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.ts')) continue;
    const source = readFileSync(path.join(directory, file), 'utf8');
    assert.ok(
      !/from\s+['"]vscode['"]/.test(source),
      `src/core/${file} imports vscode, which breaks the layering the tests rely on`
    );
  }
});
