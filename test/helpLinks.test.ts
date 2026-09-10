import assert from 'node:assert/strict';
import test from 'node:test';
import { absoluteLinks, repositoryPage } from '../src/adapter/helpLinks';

/**
 * `:h` が開くヘルプの中のリンク。
 *
 * ヘルプは独自のスキームで出しているので、相対リンクはそのままでは
 * `vim-like-help:docs/demo.md` に解決され、こちらが出せない文書を要求されます。
 * VSIX に docs/ を同梱していないので、ローカルに開く先もそもそもありません。
 */

const REPO = 'https://github.com/onzuka24/vscode-extension-v.git';
const PAGE = 'https://github.com/onzuka24/vscode-extension-v';

test('package.json の書き方から見られる URL を作る', () => {
  assert.equal(repositoryPage(REPO), PAGE);
  assert.equal(repositoryPage('git+https://github.com/o/r.git'), 'https://github.com/o/r');
  assert.equal(repositoryPage('https://github.com/o/r/'), 'https://github.com/o/r');
});

test('相対リンクをリポジトリの URL にする', () => {
  assert.equal(
    absoluteLinks('[構造](docs/architecture.md) を参照', REPO),
    `[構造](${PAGE}/blob/main/docs/architecture.md) を参照`
  );
});

test('末尾が / のものはディレクトリとして扱う', () => {
  // GitHub はディレクトリを blob ではなく tree で出します。
  assert.equal(absoluteLinks('[docs](docs/)', REPO), `[docs](${PAGE}/tree/main/docs/)`);
  assert.equal(absoluteLinks('[例](examples/)', REPO), `[例](${PAGE}/tree/main/examples/)`);
});

test('見出しの指定は残す', () => {
  assert.equal(
    absoluteLinks('[節](docs/a.md#見出し)', REPO),
    `[節](${PAGE}/blob/main/docs/a.md#見出し)`
  );
});

test('外部のリンクは触らない', () => {
  const external = '[mise](https://mise.jdx.dev/) と [連絡](mailto:x@example.com)';
  assert.equal(absoluteLinks(external, REPO), external);
});

test('同じ文書の中の見出しへのリンクは触らない', () => {
  // これは書き換えるとかえって壊れます。ヘルプの中で動いているためです。
  assert.equal(absoluteLinks('[上へ](#モーション)', REPO), '[上へ](#モーション)');
});

test('画像つきのバッジも壊さない', () => {
  const badge = '[![CI](https://example.com/b.svg)](https://example.com/ci)';
  assert.equal(absoluteLinks(badge, REPO), badge);
});

test('リンクでない括弧は触らない', () => {
  const text = 'これは (括弧) です。`call(alpha, beta)` も。';
  assert.equal(absoluteLinks(text, REPO), text);
});

test('1行に複数あっても全部書き換える', () => {
  assert.equal(
    absoluteLinks('[a](x.md) と [b](y.md)', REPO),
    `[a](${PAGE}/blob/main/x.md) と [b](${PAGE}/blob/main/y.md)`
  );
});

test('実物の README を通しても外部リンクの数が変わらない', () => {
  const before = 'https://mise.jdx.dev/';
  assert.ok(absoluteLinks(`[mise](${before})`, REPO).includes(before));
});
