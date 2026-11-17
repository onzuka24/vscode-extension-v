import assert from 'node:assert/strict';
import test from 'node:test';
import { fullWidthSpaceOffsets } from '../src/core/fullWidthSpace';

test('全角スペースの位置をすべて返す', () => {
  assert.deepEqual(fullWidthSpaceOffsets('a　b　　c'), [1, 3, 4]);
});

test('半角スペースやタブは数えない', () => {
  assert.deepEqual(fullWidthSpaceOffsets('a b\tc'), []);
});

test('改行をまたいでも文書全体の位置で返す', () => {
  assert.deepEqual(fullWidthSpaceOffsets('　\nx　'), [0, 3]);
});
