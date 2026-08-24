# 開発の手引き

## 準備

```sh
mise install   # mise を使わない場合は不要
npm install
npm run compile
```

Node のバージョンは [mise.toml](mise.toml) で固定しています。CI も同じファイルを読むので、
手元と CI で版がずれることはありません。版を上げるときは mise.toml を書き換えて、
下の検査を通してください。

VS Code でこのディレクトリを開き `F5` を押すと、拡張機能が有効になった Extension
Development Host が起動します。編集しながら試す場合は別のターミナルで `npm run watch` を
実行しておいてください。

## 検査

```sh
npm run lint       # ESLint（型情報を使う設定）
npm run typecheck  # tsc --noEmit
npm test           # コンパイル + node --test
npm run package    # VSIX を作る（マニフェストの不備はここで初めて出る）
```

この4つが CI で走るものと同じです。送る前に手元で通しておくと往復が減ります。

`package` を CI に入れているのは、`main` の指定漏れや `.vscodeignore` の書き過ぎといった
マニフェストの不備が、型検査でもテストでも捕まらないからです。実際に詰めてみるのが唯一の
確かめ方です。

## examples を直すとき

`examples/` には同じ内容が2つの形で入っています。注釈つきの `.jsonc`（読む用）と、
注釈を外した `.json`（貼り付ける用）です。

**直すのは `.jsonc` のほうだけです。**

```sh
npm run examples   # .jsonc から .json を作りなおす
```

`.json` は生成物なので、手で直しても次の生成で消えます。2つがずれていると `npm test` が
落ちるので、忘れても気づけます。

## まず読むもの

- [docs/architecture.md](docs/architecture.md) — フォルダ構成、レイヤの依存、キー1打が届くまでの流れ
- [docs/history.md](docs/history.md) — なぜこの設計になっているか

## 守ってほしい2つの約束

### `src/core/` は `vscode` を import しない

ロジックが VS Code から独立しているおかげで、ふるまいのテストを実際のエディタなしに書けます。
この線が一度崩れると、そこから先はテストできなくなります。構造テストが自動で検査しています。

VS Code の API が必要になったら、`src/adapter/` に薄い変換を足し、コアには
「何をすべきか」を表すデータ（`src/core/actions.ts` の `Action`）だけを返させてください。

### ふるまいの変更にはテストを添える

テストは `test/harness.ts` の `run(text, keys)` を通します。実際のアダプタと同じ順序で
エンジンを駆動するので、テストがそのまま挙動の説明になります。

```ts
assert.equal(run('hello world', 'dw').text, 'world');
assert.equal(run('foo(bar)baz', 'ci(X<Esc>', { cursor: pos(0, 5) }).text, 'foo(X)baz');
```

バグ報告のイシューには、これを書くのに必要な項目（バッファ・カーソル・キー列・期待・実際）が
揃っているので、まず失敗するテストに写してから直すのが早道です。

## よくある変更のしかた

### モーションを1つ足す

[`src/core/motions.ts`](src/core/motions.ts) の `MOTIONS` にエントリを足します。
そのモーションが exclusive / inclusive / linewise のどれであるかを申告すれば、
`d` `c` `y` すべてから正しく使えるようになります。オペレータ側に手を入れる必要はありません。

```ts
ge: {
  kind: 'inclusive',
  exec: ({ buffer, from, count }) => /* 位置を返す。動けなければ null */
}
```

### テキストオブジェクトを1つ足す

[`src/core/textobjects.ts`](src/core/textobjects.ts) に範囲を返す関数を足し、
`resolveTextObject` から引けるようにします。オペレータからも Visual モードからも
同じ経路で使われます。

### 単独コマンドを1つ足す

[`src/core/parser.ts`](src/core/parser.ts) の `NORMAL_ACTIONS` にキーを登録し、
[`src/core/engine.ts`](src/core/engine.ts) の `runAction` に分岐を足します。
引数を1文字取るコマンド（`r` のような）は `ACTIONS_WITH_ARGUMENT` に入れてください。

### キーバインドを足す

`type` で受け取れないキー（Escape、`Ctrl` 系、矢印キー）だけが `package.json` の
`keybindings` に入ります。`when` 句には必ず `vimLike.active` と `editorTextFocus` を
含めてください。これを忘れると、ターミナルや検索欄でキーを奪ってしまいます。
構造テストが検査しているので、忘れれば CI で落ちます。

## コミットとブランチ

`main` から作業ブランチを切ってください。コミットメッセージの形式は特に定めていませんが、
`feat:` `fix:` `docs:` のような接頭辞があると履歴が読みやすくなります。
