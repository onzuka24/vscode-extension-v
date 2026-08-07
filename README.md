# Vim Like Navigation

VS Code 上で Vim ライクなモード切り替えと、マウスなしの UI 操作を提供する拡張機能です。

## 必要環境

- VS Code 1.85 以降
- ソースから実行する場合は Node.js と npm

## 導入方法

### ソースコードから導入する場合

1. リポジトリを取得して、拡張機能のディレクトリへ移動します。

   ```sh
   git clone <repository-url>
   cd vscode-extension-v
   ```

2. 開発用パッケージをインストールし、拡張機能をビルドします。

   ```sh
   npm install
   npm run compile
   ```

3. VS Code でこのディレクトリを開きます。

   ```sh
   code .
   ```

### 開発版の実行

1. VS Code でこのプロジェクトを開きます。
2. `F5` または「実行とデバッグ」ビューの「Run Extension」を実行します。
3. 起動した Extension Development Host で任意のファイルを開きます。

拡張機能は開発用ホスト内でのみ有効になります。ソースを変更した場合は、先に `npm run compile` を実行してから Extension Development Host を再起動してください。編集中に自動ビルドする場合は、別のターミナルで次を実行します。

```sh
npm run watch
```

現時点では Marketplace への公開や VSIX の配布は行っていないため、上記の Extension Development Host を使って導入・実行します。

## アンインストール

ソースから実行している場合は、Extension Development Host を閉じるだけで無効になります。VSIX としてインストールした場合は、拡張機能ビューで「Vim Like Navigation」を検索し、歯車メニューから「アンインストール」を選択します。

## 操作

- `i` / `a`: Insert モードへ
- `Esc`: Normal モードへ
- Normal モードの `h` `j` `k` `l`: カーソル移動
- `x`: 1 文字削除、`dd`: 行削除、`o` / `Shift+o`: 行を開いて Insert モードへ
- `Ctrl+w` + `h/j/k/l`: エディターグループ間を移動
- `Ctrl+b`: サイドバー、`Ctrl+j`: パネルの表示切替
- `Ctrl+Alt+b`: Auxiliary Bar、`Ctrl+Alt+a`: Activity Bar の表示切替

キー割り当ては VS Code のキーボードショートカット設定から変更できます。

## 設定

設定画面で `Vim Like` を検索すると、次の設定を変更できます。

- `vimLike.startInNormalMode`: 起動時に Normal モードにするかどうか（既定値: `true`）
- `vimLike.showModeInStatusBar`: ステータスバーに現在のモードを表示するかどうか（既定値: `true`）

コマンドパレット（`Ctrl+Shift+P` / macOS は `Cmd+Shift+P`）で `Vim Like:` と検索すると、モード切り替えや各種 UI 切り替えを個別に実行できます。
