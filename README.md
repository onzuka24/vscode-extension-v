# Vim Like

[![CI](https://github.com/onzuka24/vscode-extension-v/actions/workflows/ci.yml/badge.svg)](https://github.com/onzuka24/vscode-extension-v/actions/workflows/ci.yml)

VS Code 上で Vim ライクなモーダル編集を提供する拡張機能です。オペレータとモーションの
組み合わせ、カウント接頭辞、レジスタ、Visual モード、テキストオブジェクトに対応しています。

## 必要環境

- VS Code 1.85 以降
- ビルドとテストに Node.js 22.6 以降と npm

開発に使う Node のバージョンは [mise.toml](mise.toml) で固定しています。
[mise](https://mise.jdx.dev/) を使っている場合は `mise install` で同じ版が入ります。

## 導入と実行

```sh
git clone <repository-url>
cd vscode-extension-v
mise install   # mise を使わない場合は不要
npm install
npm run compile
```

VS Code でこのディレクトリを開き、`F5`（または「実行とデバッグ」ビューの **Run Extension**）を
実行すると、拡張機能が有効になった Extension Development Host が起動します。ビルドは
`.vscode/launch.json` の設定により自動で走ります。編集しながら試す場合は、別のターミナルで
`npm run watch` を実行しておくとインクリメンタルにビルドされます。

検査は `npm run lint`、`npm run typecheck`、`npm test` で実行します。GitHub Actions の CI でも
同じ3つが、mise.toml で固定したものと同じ Node で走ります。

現時点では Marketplace への公開や VSIX の配布は行っていません。

## 操作

### モード

| キー | 動作 |
| --- | --- |
| `i` `a` `I` `A` | Insert モードへ（現在位置 / 1つ右 / 行頭の非空白 / 行末） |
| `o` `O` | 下 / 上に行を開いて Insert モードへ。インデントを引き継ぎます |
| `v` `V` | Visual / Visual Line モードへ |
| `Esc` `Ctrl+[` | Normal モードへ |

Normal モードと Visual モードでは、割り当てのないキーはバッファに入力されず破棄されます。

### モーション

`h` `j` `k` `l` `w` `W` `b` `B` `e` `E` `0` `^` `$` `gg` `G` `{` `}` `f{char}` `F{char}` `t{char}` `T{char}`

いずれもカウント接頭辞を取ります（`3w`、`5j`、`2f,` など）。`G` はカウントで行番号指定になります。

### オペレータ

`d` `c` `y` を上記のモーションと自由に組み合わせられます（`dw` `d$` `c3w` `y}` `dfx` など）。
オペレータを重ねると行単位になります（`dd` `cc` `yy`）。カウントは前後どちらにも置け、
両方あれば掛け算されます（`2d3w` は6単語削除）。

短縮形として `D`（`d$`）、`C`（`c$`）、`Y`（`yy`）、`S`（`cc`）、`x` `X` `s` があります。

### テキストオブジェクト

`iw` `aw` `iW` `aW`、括弧の `i(` `a(` `i[` `a[` `i{` `a{` `i<` `a<`（`ib` `ab` `iB` `aB` も可）、
引用符の `i"` `a"` `i'` `a'` `` i` `` `` a` ``。オペレータの後（`ciw`）でも Visual モード中
（`viw`）でも同じように使えます。

### レジスタとその他

- `"a` などで名前付きレジスタを指定します（`"ayy` `"ap`）。大文字は追記です。
- `p` `P` で貼り付け。行単位のレジスタは行として、文字単位のレジスタは文字として貼られます。
- `r{char}` 置換、`~` 大小反転、`J` 行連結、`u` / `Ctrl+r` で取り消し・やり直し。

### ウィンドウ操作

`Ctrl+W` に続けて `h` `j` `k` `l` でエディターグループ間を移動、`s` `v` で分割、`c` で閉じます。

サイドバーやパネルの表示切替は VS Code 標準のキー（`Ctrl+B` など）をそのまま使います。
この拡張機能では再定義していません。

## 設定

設定画面で `Vim Like` を検索してください。

- `vimLike.enabled`: Vim モードの有効・無効（既定値: `true`）。ステータスバーの表示をクリックしても切り替わります。
- `vimLike.startInNormalMode`: エディターを切り替えたときに Normal モードへ戻すか（既定値: `true`）
- `vimLike.showModeInStatusBar`: ステータスバーに現在のモードを表示するか（既定値: `true`）
- `vimLike.leader`: キー割り当ての `<leader>` が指すキー（既定値: スペース）

### キーの割り当てを変える

`vimLike.normalModeKeyBindings` と `vimLike.visualModeKeyBindings` で、キーを別のキー列に
置き換えられます。Vim の `nnoremap` / `vnoremap` に相当します。

```jsonc
"vimLike.normalModeKeyBindings": [
  { "before": ["H"], "after": ["^"] },
  { "before": ["J"], "after": ["1", "0", "j"] },
  { "before": ["K"], "after": ["1", "0", "k"] },
  { "before": ["L"], "after": ["$"] },
  { "before": ["U"], "after": ["<C-r>"] },

  { "before": ["<leader>", "n"], "commands": ["workbench.view.explorer"] },
  { "before": ["<leader>", "h"], "commands": ["workbench.action.navigateLeft"] },
  { "before": ["<leader>", "w", "h"], "commands": ["workbench.action.decreaseViewWidth"] }
]
```

- `before` と `after` は 1 要素が 1 キーです。`10j` は `["1", "0", "j"]` と書きます。
- `after` の代わりに `commands` を書くと、VS Code のコマンドを直接呼べます。
- `<Esc>` `<C-r>` `<Space>` `<leader>` が特殊キーとして使えます。
  `<leader>` が何を指すかは `vimLike.leader` で変えられます（既定値はスペース）。
- 置き換えた結果はさらに置き換えられません（`nnoremap` と同じく非再帰です）。
- `f` `t` `r` の引数と、`"` に続くレジスタ名は置き換えの対象外です。
  `J` を割り当てていても `fJ` は文字 `J` を探します。
- 複数キーの `before` は、より長い規則が一致しうるあいだ次のキーを待ちます。
  `["g", "w"]` と `["g", "w", "h"]` を両方定義すると、短いほうは発火しません。
  待機中はステータスバーに打鍵済みのキーが出ます（スペースは `␣` と表示されます）。
- Vim の `timeoutlen` にあたる打ち切りはありません。待っているあいだは表示で分かるので、
  手が止まっただけで打鍵が実行されるより確実だと考えています。

すぐ使える設定例を [examples/settings.jsonc](examples/settings.jsonc) に置いています。
`H` `J` `K` `L` の置き換えから leader 起点のウィンドウ操作まで一式入っているので、
settings.json に貼り付けてから削っていくのが早いと思います。

## 制限

- Ex コマンドライン（`:w` `:s/foo/bar/`）と検索（`/` `?` `n` `N`）は未対応です。
- `.`（直前の変更の繰り返し）、マクロ、マークは未対応です。
- `u` と `Ctrl+r` は VS Code の取り消し履歴に委譲しているため、取り消しの粒度は Vim と一致しません。
- モードはウィンドウ全体で1つです。エディターごとに別々のモードは持ちません。

## ドキュメント

設計に関する資料は [docs/](docs/) にあります。

- [経緯](docs/history.md) — 最初の実装で何が問題になり、なぜ設計から作り直したか
- [構造と動作機序](docs/architecture.md) — フォルダ構成、レイヤの依存、キー1打が届くまでの流れ、
  パーサの状態機械、`type` 乗っ取りの判断、テストの構成

手を入れる場合は [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。
