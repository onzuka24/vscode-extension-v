import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

const SAMPLE = 'const answer = 42;\n\nfunction main() {\n  return answer;\n}';

test('hjkl move by one and stop at the edges', () => {
  assert.equal(run('abc', 'l').at, '0:1');
  assert.equal(run('abc', 'lll').at, '0:2', 'Normal mode never passes the last character');
  assert.equal(run('abc', 'h', { cursor: pos(0, 2) }).at, '0:1');
  assert.equal(run('abc', 'hhh', { cursor: pos(0, 2) }).at, '0:0');
  assert.equal(run('ab\ncd', 'j').at, '1:0');
  assert.equal(run('ab\ncd', 'jk').at, '0:0');
});

test('a count repeats the motion', () => {
  assert.equal(run('abcdefg', '3l').at, '0:3');
  assert.equal(run('a\nb\nc\nd\ne', '3j').at, '3:0');
  assert.equal(run('a\nb\nc', '9j').at, '2:0', 'a count past the end clamps rather than failing');
});

test('j and k remember the column they came from', () => {
  const text = 'longer line\nab\nlonger line';
  assert.equal(run(text, 'jj', { cursor: pos(0, 8) }).at, '2:8');
  assert.equal(run(text, 'j', { cursor: pos(0, 8) }).at, '1:1', 'clamped on the short line');
});

test('$ sticks to the end of the line across j', () => {
  assert.equal(run('abcdef\nxy', '$').at, '0:5');
  assert.equal(run('abcdef\nxy', '$j').at, '1:1');
});

test('0 and ^ address the line start and the first non-blank', () => {
  assert.equal(run('    indented', '0', { cursor: pos(0, 8) }).at, '0:0');
  assert.equal(run('    indented', '^', { cursor: pos(0, 8) }).at, '0:4');
});

test('w, b and e walk words', () => {
  assert.equal(run('const answer = 42;', 'w').at, '0:6');
  assert.equal(run('const answer = 42;', 'ww').at, '0:13');
  assert.equal(run('const answer = 42;', '2w').at, '0:13');
  assert.equal(run('const answer = 42;', 'e').at, '0:4');
  assert.equal(run('const answer = 42;', 'b', { cursor: pos(0, 6) }).at, '0:0');
});

test('w treats punctuation as its own word but W does not', () => {
  assert.equal(run('foo.bar', 'w').at, '0:3', 'w stops on the dot');
  assert.equal(run('foo.bar baz', 'W').at, '0:8', 'W skips the whole blob');
});

test('word motions cross lines and stop on empty lines', () => {
  assert.equal(run(SAMPLE, 'w', { cursor: pos(0, 15) }).at, '0:17', 'the semicolon is its own word');
  assert.equal(run(SAMPLE, '2w', { cursor: pos(0, 15) }).at, '1:0', 'an empty line counts as a word');
});

test('gg and G jump to the first non-blank of a line', () => {
  assert.equal(run(SAMPLE, 'G').at, '4:0');
  assert.equal(run(SAMPLE, 'gg', { cursor: pos(3, 2) }).at, '0:0');
  assert.equal(run(SAMPLE, '4G').at, '3:2', 'a count selects the line and lands on its first non-blank');
});

test('f, F, t and T search within the line', () => {
  assert.equal(run('a-b-c-d', 'f-').at, '0:1');
  assert.equal(run('a-b-c-d', '2f-').at, '0:3');
  assert.equal(run('a-b-c-d', 't-').at, '0:0', 't stops before the match, so it cannot move here');
  assert.equal(run('abc-def', 't-').at, '0:2');
  assert.equal(run('a-b-c-d', 'F-', { cursor: pos(0, 6) }).at, '0:5');
  assert.equal(run('a-b-c-d', 'T-', { cursor: pos(0, 6) }).at, '0:6', 'already adjacent, so no move');
  assert.equal(run('a-bcd', 'T-', { cursor: pos(0, 4) }).at, '0:2');
});

test('an unknown key is swallowed rather than typed into the buffer', () => {
  const session = run('abc', 'qzQZ');
  assert.equal(session.text, 'abc');
  assert.equal(session.mode, 'normal');
});

test('a partial command waits for the rest of the keys', () => {
  assert.equal(run('a-b-c', 'f').text, 'a-b-c', 'f alone is still pending');
  assert.equal(run('abc\ndef', 'g').at, '0:0', 'g alone is still pending');
});
