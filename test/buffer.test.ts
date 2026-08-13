import assert from 'node:assert/strict';
import test from 'node:test';
import { LinesBuffer, getText, linewiseRange, linewiseText } from '../src/core/buffer';
import { clampCursor, firstNonBlank, indentOf } from '../src/core/cursor';
import { pos } from '../src/core/types';

test('getText reads within a single line', () => {
  const buffer = new LinesBuffer('hello world');
  assert.equal(getText(buffer, { start: pos(0, 0), end: pos(0, 5) }), 'hello');
});

test('getText joins across lines using the buffer eol', () => {
  const buffer = new LinesBuffer('one\ntwo\nthree', '\r\n');
  assert.equal(getText(buffer, { start: pos(0, 1), end: pos(2, 2) }), 'ne\r\ntwo\r\nth');
});

test('linewiseRange takes the following line break', () => {
  const buffer = new LinesBuffer('one\ntwo\nthree');
  assert.deepEqual(linewiseRange(buffer, 0, 0), { start: pos(0, 0), end: pos(1, 0) });
});

test('linewiseRange on the last line takes the preceding line break instead', () => {
  const buffer = new LinesBuffer('one\ntwo\nthree');
  assert.deepEqual(linewiseRange(buffer, 2, 2), { start: pos(1, 3), end: pos(2, 5) });
});

test('linewiseRange spanning the whole buffer leaves one empty line', () => {
  const buffer = new LinesBuffer('one\ntwo');
  assert.deepEqual(linewiseRange(buffer, 0, 1), { start: pos(0, 0), end: pos(1, 3) });
});

test('linewiseText keeps a trailing break so linewise pastes land on their own line', () => {
  const buffer = new LinesBuffer('one\ntwo\nthree');
  assert.equal(linewiseText(buffer, 1, 2), 'two\nthree\n');
});

test('the cursor stops on the last character in Normal mode but may pass it in Insert', () => {
  const buffer = new LinesBuffer('abc');
  assert.deepEqual(clampCursor(buffer, pos(0, 9), 'normal'), pos(0, 2));
  assert.deepEqual(clampCursor(buffer, pos(0, 9), 'insert'), pos(0, 3));
});

test('the cursor rests at column 0 on an empty line', () => {
  const buffer = new LinesBuffer('abc\n\ndef');
  assert.deepEqual(clampCursor(buffer, pos(1, 4), 'normal'), pos(1, 0));
});

test('firstNonBlank and indentOf describe the leading whitespace', () => {
  const buffer = new LinesBuffer('    indented\n\n\ttabbed');
  assert.equal(firstNonBlank(buffer, 0), 4);
  assert.equal(indentOf(buffer, 0), '    ');
  assert.equal(firstNonBlank(buffer, 1), 0);
  assert.equal(indentOf(buffer, 2), '\t');
});
