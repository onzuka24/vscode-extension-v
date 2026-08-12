import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

test('exclusive and inclusive motions delete different amounts', () => {
  assert.equal(run('hello world', 'dw').text, 'world');
  assert.equal(run('hello world', 'de').text, ' world');
});

test('a count multiplies through the operator', () => {
  assert.equal(run('one two three four', '3dw').text, 'four');
  assert.equal(run('one two three four', 'd3w').text, 'four');
  assert.equal(run('one two three four five six seven', '2d3w').text, 'seven', 'the counts multiply to six words');
});

test('dw stops at the end of the line instead of pulling up the next one', () => {
  assert.equal(run('foo bar\nbaz', 'dw', { cursor: pos(0, 4) }).text, 'foo \nbaz');
});

test('dd removes the line and its break', () => {
  assert.equal(run('one\ntwo\nthree', 'dd').text, 'two\nthree');
  assert.equal(run('one\ntwo\nthree', '2dd').text, 'three');
});

test('dd on the last line leaves no empty line behind', () => {
  const session = run('one\ntwo\nthree', 'dd', { cursor: pos(2, 0) });
  assert.equal(session.text, 'one\ntwo');
  assert.equal(session.at, '1:0', 'the cursor moves up to the new last line');
});

test('dd lands on the first non-blank of the line that takes its place', () => {
  assert.equal(run('one\n    two\nthree', 'dd').at, '0:4');
});

test('d$ and D delete to the end of the line', () => {
  assert.equal(run('hello world', 'd$', { cursor: pos(0, 5) }).text, 'hello');
  assert.equal(run('hello world', 'D', { cursor: pos(0, 5) }).text, 'hello');
});

test('cw behaves as ce so it keeps the following space', () => {
  const session = run('hello world', 'cwbye<Esc>');
  assert.equal(session.text, 'bye world');
  assert.equal(session.mode, 'normal');
});

test('cc keeps the line and its indentation', () => {
  const session = run('    first\nsecond', 'ccnew<Esc>');
  assert.equal(session.text, '    new\nsecond');
});

test('yy then p puts the copy on the following line', () => {
  const session = run('one\ntwo', 'yyp');
  assert.equal(session.text, 'one\none\ntwo');
  assert.equal(session.at, '1:0');
});

test('yy then p on the last line appends without a stray blank line', () => {
  assert.equal(run('one\ntwo', 'yyp', { cursor: pos(1, 0) }).text, 'one\ntwo\ntwo');
});

test('P puts a linewise register above the current line', () => {
  assert.equal(run('one\ntwo', 'yyP', { cursor: pos(1, 0) }).text, 'one\ntwo\ntwo');
});

test('named registers keep their own contents', () => {
  const session = run('alpha\nbeta\ngamma', '"ayyj"byyG"ap"bp');
  assert.equal(session.text, 'alpha\nbeta\ngamma\nalpha\nbeta');
});

test('xp transposes two characters', () => {
  const session = run('abc', 'xp');
  assert.equal(session.text, 'bac');
  assert.equal(session.at, '0:1');
});

test('x and X delete around the cursor', () => {
  assert.equal(run('abcdef', '3x').text, 'def');
  assert.equal(run('abc', 'X', { cursor: pos(0, 2) }).text, 'ac');
  assert.equal(run('', 'x').text, '', 'x on an empty line does nothing');
});

test('o and O open an indented line and enter Insert mode', () => {
  assert.equal(run('    foo', 'obar<Esc>').text, '    foo\n    bar');
  assert.equal(run('    foo', 'Obar<Esc>').text, '    bar\n    foo');
});

test('o and O use the buffer line separator rather than a bare newline', () => {
  const session = run('a\r\nb', 'o', { eol: '\r\n' });
  assert.equal(session.text, 'a\r\n\r\nb');
  assert.ok(!/[^\r]\n/.test(session.text), 'no lone LF may appear in a CRLF buffer');
});

test('dd and p keep CRLF endings intact', () => {
  const session = run('one\r\ntwo\r\nthree', 'ddp', { eol: '\r\n' });
  assert.equal(session.text, 'two\r\none\r\nthree');
});

test('J joins lines with a single space and drops the indent', () => {
  const session = run('foo\n    bar', 'J');
  assert.equal(session.text, 'foo bar');
  assert.equal(session.at, '0:3');
});

test('r replaces in place and refuses to run past the line end', () => {
  assert.equal(run('abc', 'rZ').text, 'Zbc');
  assert.equal(run('abcdef', '3rZ').text, 'ZZZdef');
  assert.equal(run('ab', '5rZ').text, 'ab', 'the count exceeds the line, so nothing happens');
});

test('~ flips the case and steps forward', () => {
  const session = run('abc', '~');
  assert.equal(session.text, 'Abc');
  assert.equal(session.at, '0:1');
});

test('s substitutes characters and enters Insert mode', () => {
  assert.equal(run('abcdef', '3sX<Esc>').text, 'Xdef');
});

test('leaving Insert mode steps back onto the last typed character', () => {
  const session = run('abc', 'iX<Esc>');
  assert.equal(session.text, 'Xabc');
  assert.equal(session.at, '0:0');
});

test('a, I and A choose where Insert mode begins', () => {
  assert.equal(run('abc', 'aX<Esc>').text, 'aXbc');
  assert.equal(run('   abc', 'IX<Esc>').text, '   Xabc');
  assert.equal(run('abc', 'AX<Esc>').text, 'abcX');
});
