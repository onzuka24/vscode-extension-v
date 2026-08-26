import assert from 'node:assert/strict';
import test from 'node:test';
import { MARK_ICON_COLORS, isDrawableMark, markIconSvg, markIconUri } from '../src/adapter/markIcon';
import { MarkStore } from '../src/core/marks';
import { pos } from '../src/core/types';

test('ガターに描くのは利用者が付けた名前付きマークだけ', () => {
  assert.equal(isDrawableMark('a'), true);
  assert.equal(isDrawableMark('z'), true);
  // ジャンプの戻り先は移動のたびに動くので、出すと目障りになる。
  assert.equal(isDrawableMark('`'), false);
  assert.equal(isDrawableMark('A'), false);
});

test('アイコンはマーク名と色を含む SVG になる', () => {
  const svg = markIconSvg('a', MARK_ICON_COLORS.dark);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes('>a<'), 'マーク名が描かれている');
  assert.ok(svg.includes(MARK_ICON_COLORS.dark));
});

test('明るいテーマと暗いテーマで色が違う', () => {
  assert.notEqual(MARK_ICON_COLORS.light, MARK_ICON_COLORS.dark);
  assert.ok(markIconSvg('a', MARK_ICON_COLORS.light).includes(MARK_ICON_COLORS.light));
});

test('アイコンはそのまま読み込めるデータ URI になる', () => {
  const uri = markIconUri('b', MARK_ICON_COLORS.dark);
  assert.match(uri, /^data:image\/svg\+xml;base64,/);

  const decoded = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  assert.equal(decoded, markIconSvg('b', MARK_ICON_COLORS.dark));
});

test('マーク名は XML として安全に埋め込まれる', () => {
  // 現状ガターに出すのは a-z だけだが、生成側は名前を信用しない。
  assert.ok(markIconSvg('<', '#000').includes('&lt;'));
  assert.ok(!markIconSvg('&', '#000').includes('>&<'));
});

test('マークの一覧は名前順で返る', () => {
  const marks = new MarkStore();
  marks.set('file:///a.ts', 'c', pos(9, 0));
  marks.set('file:///a.ts', 'a', pos(2, 4));
  marks.set('file:///a.ts', 'b', pos(5, 1));

  assert.deepEqual(
    marks.list('file:///a.ts').map(mark => mark.name),
    ['a', 'b', 'c']
  );
  assert.deepEqual(marks.list('file:///a.ts')[0]?.position, pos(2, 4));
});

test('一覧は別ファイルのマークも含む', () => {
  // 名前付きマークは横断するので、どのファイルから見ても同じものが並びます。
  const marks = new MarkStore();
  marks.set('file:///a.ts', 'a', pos(1, 0));

  assert.deepEqual(marks.list('file:///b.ts'), [
    { name: 'a', bufferId: 'file:///a.ts', position: pos(1, 0) }
  ]);
});

test('ガターに出すのは、そのファイルにあるマークだけ', () => {
  // ガターは行番号の横に描くので、別ファイルの行番号を出すと嘘になります。
  const marks = new MarkStore();
  marks.set('file:///a.ts', 'a', pos(1, 0));
  marks.set('file:///b.ts', 'b', pos(4, 2));

  assert.deepEqual(
    marks.listIn('file:///a.ts').map(mark => mark.name),
    ['a']
  );
  assert.deepEqual(
    marks.listIn('file:///b.ts').map(mark => mark.name),
    ['b']
  );
});
