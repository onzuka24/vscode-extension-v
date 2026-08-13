import assert from 'node:assert/strict';
import test from 'node:test';
import { pos } from '../src/core/types';
import { run } from './harness';

test('v selects characterwise and an operator consumes the selection', () => {
  const session = run('hello world', 'vlld');
  assert.equal(session.text, 'lo world');
  assert.equal(session.mode, 'normal');
});

test('V selects whole lines', () => {
  assert.equal(run('one\ntwo\nthree', 'Vd').text, 'two\nthree');
  assert.equal(run('one\ntwo\nthree', 'Vjd').text, 'three');
});

test('o swaps which end of the selection the motion moves', () => {
  assert.equal(run('abcdef', 'vllold').text, 'adef');
});

test('y in Visual mode yanks the selection characterwise', () => {
  const session = run('abc', 'vlyp');
  assert.equal(session.text, 'aabbc');
  assert.equal(session.at, '0:2');
});

test('Escape leaves Visual mode without editing', () => {
  const session = run('hello', 'vll<Esc>');
  assert.equal(session.text, 'hello');
  assert.equal(session.mode, 'normal');
  assert.equal(session.at, '0:2');
});

test('unbound keys are swallowed in Visual mode too', () => {
  const session = run('hello', 'vlqZ');
  assert.equal(session.text, 'hello');
  assert.equal(session.mode, 'visual');
});

test('iw and aw differ by the trailing whitespace', () => {
  assert.equal(run('one two three', 'diw', { cursor: pos(0, 4) }).text, 'one  three');
  assert.equal(run('one two three', 'daw', { cursor: pos(0, 4) }).text, 'one three');
});

test('a text object works the same from Visual mode as from an operator', () => {
  assert.equal(run('one two three', 'viwd', { cursor: pos(0, 4) }).text, 'one  three');
});

test('bracket objects find the enclosing pair from inside', () => {
  assert.equal(run('foo(bar)baz', 'ci(X<Esc>', { cursor: pos(0, 5) }).text, 'foo(X)baz');
  assert.equal(run('foo(bar)baz', 'da(', { cursor: pos(0, 5) }).text, 'foobaz');
});

test('bracket objects also work with the cursor on a bracket', () => {
  assert.equal(run('foo(bar)baz', 'di(', { cursor: pos(0, 3) }).text, 'foo()baz');
  assert.equal(run('foo(bar)baz', 'di(', { cursor: pos(0, 7) }).text, 'foo()baz');
});

test('bracket objects nest', () => {
  assert.equal(run('a(b(c)d)e', 'di(', { cursor: pos(0, 4) }).text, 'a(b()d)e');
  assert.equal(run('a(b(c)d)e', 'di(', { cursor: pos(0, 2) }).text, 'a()e');
});

test('bracket objects span lines', () => {
  const session = run('call(\n  arg\n)', 'di(', { cursor: pos(1, 3) });
  assert.equal(session.text, 'call()');
});

test('quote objects select inside and around the quotes', () => {
  assert.equal(run('say "hi" now', 'di"', { cursor: pos(0, 6) }).text, 'say "" now');
  assert.equal(run('say "hi" now', 'da"', { cursor: pos(0, 6) }).text, 'say  now');
});

test('a text object that matches nothing leaves the buffer alone', () => {
  assert.equal(run('no brackets here', 'di(').text, 'no brackets here');
});
