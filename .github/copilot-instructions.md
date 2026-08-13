# Copilot 向けの指示

VS Code 上で Vim ライクなモーダル編集を提供する拡張機能です。TypeScript、ランタイム依存ゼロ、
テストは Node.js 標準のテストランナーのみを使います。

## 最優先の制約

### `src/core/` から `vscode` を import しない

この層が VS Code から独立しているおかげで、ふるまいのテストを実際のエディタなしに書けます。
一度この線が崩れると、そこから先はテスト不能になります。構造テストが自動で検査しており、
違反すれば CI が落ちます。

VS Code の API が必要になったら、`src/adapter/` に薄い変換を足してください。コアは
「何をすべきか」を表すデータ（`src/core/actions.ts` の `Action`）を返すだけで、副作用を持ちません。

```ts
// core がやること: データを返す
return { type: 'edit', range, text: '' };

// core がやってはいけないこと
await editor.edit(...);
```

### ふるまいを変えたらテストを添える

`test/harness.ts` の `run(text, keys)` を使います。実際のアダプタと同じ順序
（編集 → モード → カーソル）でエンジンを駆動するので、テストがそのまま挙動の説明になります。

```ts
assert.equal(run('hello world', 'dw').text, 'world');
assert.equal(run('foo(bar)baz', 'ci(X<Esc>', { cursor: pos(0, 5) }).text, 'foo(X)baz');
assert.equal(run('one\ntwo', 'dd', { cursor: pos(1, 0) }).at, '0:0');
```

## 機能を足すときの定石

| やりたいこと | 触る場所 |
| --- | --- |
| モーションを足す | `src/core/motions.ts` の `MOTIONS` に1エントリ |
| テキストオブジェクトを足す | `src/core/textobjects.ts` の `resolveTextObject` |
| 単独コマンドを足す | `src/core/parser.ts` の `NORMAL_ACTIONS` と `src/core/engine.ts` の `runAction` |
| 特殊キー（`<C-x>` 等）を足す | `src/core/keys.ts` の `SPECIAL_KEYS` と `engine.handleLiteralKey` |

モーションは自分が `exclusive` / `inclusive` / `linewise` のどれであるかを申告します。
これを正しく書けば `d` `c` `y` すべてから正しく使えるので、**オペレータ側に分岐を足さないでください**。
そこに分岐を書くのは、この設計が避けている `オペレータ数 × モーション数` の爆発を招く変更です。

```ts
ge: {
  kind: 'inclusive',
  exec: ({ buffer, from, count }) => /* 位置を返す。動けなければ null */
}
```

## 間違えやすい箇所

- **改行は必ず `buffer.eol` を使う。** `'\n'` を直書きすると CRLF のファイルを壊します。
- **カーソルのクランプは `clampCursor` を通す。** Vim のカーソルは文字の上、VS Code は文字の間に
  あるという差をここ1箇所に閉じ込めています。呼び出し側で `Math.min` を書かないでください。
- **新しいキーは原則 `type` 経由で受ける。** `package.json` の `keybindings` に入れてよいのは
  `type` に流れてこないキー（Escape、`Ctrl` 系、矢印）だけです。
- **`keybindings` の `when` には `vimLike.active` と `editorTextFocus` を必ず入れる。**
  忘れるとターミナルや検索欄でキーを奪います。構造テストが検査しています。
- **`registerCommand('type', ...)` の委譲条件を緩めない。** ウィンドウ全体で1つしかない
  ハンドラなので、判断を誤ると VS Code 全体で文字が打てなくなります。Insert モード中と
  複数文字のテキスト（IME の変換結果）は必ず `default:type` へ渡します。
- **リマップの展開は `handleLiteralKey` に流す。** `EngineResult.replay` を呼び出し側が
  1キーずつ流し直す設計で、この経路がリマップ層を通らないことが `nnoremap` の非再帰性を
  担保しています。`handleKey` に流し直すと無限ループになります。

## 書き方の約束

- 言語は日本語でも英語でもよい。1つのファイルの中で混ざると読みにくいので、
  周囲の記述に合わせる（`src/` と `test/` の既存コメントは英語、README や `docs/` は日本語）。
- コメントは「何をしているか」ではなく「なぜそうしているか」を書く。
- 依存を増やさない。ランタイム依存はゼロを保ちます。
- `any` を使わない。ESLint が型情報を使う設定で検査しています。

## 検査

```sh
npm run lint       # ESLint（型情報を使う設定）
npm run typecheck  # tsc --noEmit
npm test           # コンパイル + node --test
```

この3つが CI で走るものと同じです。Node のバージョンは `mise.toml` で固定しており、
CI も同じファイルを読みます。

## 詳しい背景

- [docs/architecture.md](../docs/architecture.md) — 構造、依存の向き、キー1打が届くまでの流れ
- [docs/history.md](../docs/history.md) — なぜこの設計になっているか
