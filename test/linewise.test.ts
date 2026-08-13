import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

const LINES = 'one\ntwo\nthree\nfour';

test('a linewise motion makes the operator linewise', () => {
  assert.equal(run(LINES, 'dj').text, 'three\nfour', 'dj takes both lines whole');
  assert.equal(run(LINES, 'dk', { cursor: pos(1, 1) }).text, 'three\nfour');
});

test('dG and dgg delete to the end and the start of the buffer', () => {
  assert.equal(run(LINES, 'dG', { cursor: pos(2, 0) }).text, 'one\ntwo');
  assert.equal(run(LINES, 'dgg', { cursor: pos(1, 0) }).text, 'three\nfour');
});

test('a count on G selects the line to operate to', () => {
  assert.equal(run(LINES, 'd3G').text, 'four');
});

test('a linewise yank pastes as whole lines', () => {
  assert.equal(run(LINES, 'yjP', { cursor: pos(2, 0) }).text, 'one\ntwo\nthree\nfour\nthree\nfour');
});

test('Visual Line yank keeps the linewise kind', () => {
  assert.equal(run(LINES, 'Vjy' + 'Gp').text, 'one\ntwo\nthree\nfour\none\ntwo');
});

test('a paragraph motion operates on the text between blank lines', () => {
  const text = 'alpha\nbeta\n\ngamma';
  assert.equal(run(text, 'd}').text, '\ngamma');
});

test('the whole buffer can be deleted and leaves a single empty line', () => {
  assert.equal(run('one\ntwo', 'dG').text, '');
});
