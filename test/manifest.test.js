const assert = require('node:assert/strict');
const test = require('node:test');
const packageJson = require('../package.json');

const keybindings = packageJson.contributes.keybindings;

test('manifest exposes the expected mode keybindings', () => {
  const commands = keybindings.map(binding => binding.command);
  assert.ok(commands.includes('vimLike.enterInsertMode'));
  assert.ok(commands.includes('vimLike.enterNormalMode'));
  assert.ok(keybindings.some(binding => binding.key === 'escape'));
});

test('manifest exposes keyboard-only window and UI controls', () => {
  for (const command of [
    'workbench.action.navigateLeft',
    'workbench.action.navigateDown',
    'workbench.action.navigateUp',
    'workbench.action.navigateRight',
    'vimLike.toggleSidebar',
    'vimLike.togglePanel'
  ]) {
    assert.ok(keybindings.some(binding => binding.command === command), command);
  }
});
