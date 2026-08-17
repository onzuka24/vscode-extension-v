import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isValidKeyBinding } from './keySyntax';

const ROOT = path.resolve(__dirname, '..', '..');

interface Manifest {
  contributes: {
    commands: { command: string; title: string }[];
    keybindings: { command: string; key: string; when?: string }[];
  };
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as Manifest;
const extensionSource = readFileSync(path.join(ROOT, 'src', 'extension.ts'), 'utf8');

test('every contributed keybinding uses a key VS Code can parse', () => {
  for (const binding of manifest.contributes.keybindings) {
    assert.ok(isValidKeyBinding(binding.key), `"${binding.key}" is not a valid key for ${binding.command}`);
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
