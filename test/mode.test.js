const assert = require('node:assert/strict');
const test = require('node:test');
const { ModeController } = require('../out/mode.js');

test('starts in Normal mode by default', () => {
  assert.equal(new ModeController().mode, 'normal');
});

test('can start in Insert mode', () => {
  assert.equal(new ModeController('insert').mode, 'insert');
});

test('notifies listeners only when the mode changes', () => {
  const controller = new ModeController();
  const changes = [];
  controller.onDidChange(mode => changes.push(mode));

  controller.setMode('normal');
  controller.setMode('insert');
  controller.setMode('normal');

  assert.deepEqual(changes, ['insert', 'normal']);
});

test('allows a listener to unsubscribe', () => {
  const controller = new ModeController();
  const changes = [];
  const dispose = controller.onDidChange(mode => changes.push(mode));

  dispose();
  controller.setMode('insert');

  assert.deepEqual(changes, []);
});
