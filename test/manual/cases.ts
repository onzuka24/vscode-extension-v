/**
 * 手動テストの項目表。
 *
 * ここに並んでいるのは、`test/harness.ts` の文字列版エディタでは原理的に確かめられない
 * ものだけです。`type` コマンドの乗っ取り、ステータスバー、カーソル形状、`when` 句の効き方、
 * 設定の再読み込みは、いずれも本物の VS Code がないと観測できません。自動テストで書ける
 * ものをここに書くと、誰も実行しないまま古びていくので、追加するときは
 * 「run(text, keys) で書けないか」を先に考えてください。
 *
 * 普段の `npm test` では、この表の各項目は skip として一覧に出るだけです。
 * `npm test -- -manual` を付けたときだけ、1件ずつ結果を尋ねます。
 */

export type ManualArea = 'input' | 'ui' | 'keybindings' | 'settings' | 'integration';

export interface ManualCase {
  /** 実行時の絞り込みに使う識別子。kebab-case。 */
  readonly id: string;
  readonly area: ManualArea;
  readonly title: string;
  /** なぜ自動テストにできないのか。項目を消してよいかの判断はここを見て決めます。 */
  readonly why: string;
  /** 手順に入る前に整えておくこと。既定の状態でよければ省略します。 */
  readonly setup?: readonly string[];
  readonly steps: readonly string[];
  readonly expected: readonly string[];
}

/** 共通の前提。`F5` で立ち上がる Extension Development Host のことです。 */
const DEV_HOST = 'VS Code でこのリポジトリを開き、F5 で Extension Development Host を起動する';

export const MANUAL_CASES: readonly ManualCase[] = [
  {
    id: 'type-intercept',
    area: 'input',
    title: 'Normal モードで文字キーがバッファに入らない',
    why: '`type` コマンドの乗っ取りは VS Code のコマンド登録そのものなので、エンジンの外側にある',
    setup: [DEV_HOST, '適当なテキストファイルを開く'],
    steps: ['Escape を押して Normal モードにする', '`hello` と打つ', '`i` を押してから `hello` と打つ'],
    expected: [
      'Normal モードでは文字がバッファに入らず、`h` `e` `l` `l` `o` がそれぞれ移動などとして働く',
      'Insert モードに入ったあとは `hello` がそのまま入力される'
    ]
  },
  {
    id: 'ime-composition',
    area: 'input',
    title: 'Insert モードで日本語入力（変換・確定）が壊れない',
    why: 'IME の変換結果は複数文字まとめて `type` に届く。この経路はエンジンを通らず素通しされる',
    setup: [DEV_HOST, 'IME を日本語入力に切り替える'],
    steps: [
      '`i` で Insert モードに入る',
      '「にほんご」と打って変換し、確定する',
      'Escape で Normal モードに戻り、`u` で取り消す'
    ],
    expected: [
      '変換中の未確定文字が消えたり重複したりしない',
      '確定した文字列がそのまま挿入される',
      '取り消しで挿入した文字列が消える'
    ]
  },
  {
    id: 'rival-extension',
    area: 'input',
    title: '競合する Vim 拡張機能が有効なときは、黙って壊れずエラーを出す',
    why: '`type` は VS Code 全体で1つしか登録できず、奪われた側の挙動は実機でしか再現しない',
    setup: [
      '.vscode/launch.json の `--disable-extension=...` を一時的に外す',
      'VSCodeVim か vscode-neovim を有効にした状態で F5 で起動する'
    ],
    steps: ['起動直後の通知を読む', 'ステータスバーのモード表示を見る', 'エディターで文字を打つ'],
    expected: [
      '衝突相手の名前を含むエラー通知が出る',
      'ステータスバーにモードが出ない（`vimLike.active` が false）',
      '文字は普通に入力できる（半端に効いた状態にならない）',
      '確認後、launch.json の変更は元に戻す'
    ]
  },
  {
    id: 'status-bar',
    area: 'ui',
    title: 'ステータスバーにモードと入力途中のキーが出る',
    why: 'ステータスバーの描画は adapter 層の VS Code API 呼び出しで、文字列版エディタには存在しない',
    setup: [DEV_HOST],
    steps: [
      'Normal / Insert / Visual / Visual Line を順に切り替える',
      '`d` だけ押して止め、続けて `2` `d` と押して止める',
      '設定 `vimLike.showModeInStatusBar` を false にする'
    ],
    expected: [
      '各モードの名前が切り替わって表示される',
      '確定していないキー列（`d`、`2d`）が表示され、コマンドが完成すると消える',
      'false にすると表示が消え、true に戻すと再び出る'
    ]
  },
  {
    id: 'cursor-style',
    area: 'ui',
    title: 'Normal / Visual はブロックカーソル、Insert は縦線カーソル',
    why: '`editor.options.cursorStyle` の反映は実際の描画でしか確認できない',
    setup: [DEV_HOST],
    steps: ['Normal モードでカーソルを見る', '`i` で Insert に入って見る', 'Escape で戻して見る'],
    expected: [
      'Normal と Visual ではブロック',
      'Insert では縦線',
      'モードを往復しても形が取り残されない'
    ]
  },
  {
    id: 'window-keybindings',
    area: 'keybindings',
    title: 'Ctrl+w のウィンドウ操作が実際に発火する',
    why: '構造テストはキー名と `when` 句の妥当性しか見ない。実際に発火するかは VS Code が決める',
    setup: [DEV_HOST, 'エディターを左右に分割しておく'],
    steps: ['Normal モードで `Ctrl+w` `h` / `l` / `j` / `k` を押す', '`Ctrl+w` `s` と `Ctrl+w` `v`', '`Ctrl+w` `c`'],
    expected: [
      'フォーカスが対応する方向のエディターグループへ移る',
      's で上下、v で左右に分割される',
      'c で現在のエディターが閉じる',
      'Insert モードでは（`vimLike.mode != insert` のため）いずれも発火しない'
    ]
  },
  {
    id: 'escape-widgets',
    area: 'keybindings',
    title: 'ウィジェット表示中の Escape はウィジェットを閉じる',
    why: '`suggestWidgetVisible` などの条件が実際に効くかは VS Code のコンテキスト評価に依存する',
    setup: [DEV_HOST],
    steps: [
      'Insert モードで補完候補（サジェスト）を出し、Escape を押す',
      '検索ウィジェット（Ctrl+f / Cmd+f）を開いて Escape を押す',
      'マルチカーソルを作って Escape を押す'
    ],
    expected: [
      'サジェストが閉じるだけで、Insert モードのままになる',
      '検索ウィジェットが閉じる',
      'マルチカーソルが解除される（Normal モードに落ちない）'
    ]
  },
  {
    id: 'focus-elsewhere',
    area: 'keybindings',
    title: 'ターミナルやエクスプローラーではキーを奪わない',
    why: '`editorTextFocus` の効き方はフォーカスの実態次第で、静的な検査では確かめきれない',
    setup: [DEV_HOST],
    steps: [
      'ターミナルを開いて `dw` や `hjkl` を打つ',
      'エクスプローラーにフォーカスを移して同じキーを打つ',
      '検索欄（Ctrl+Shift+f / Cmd+Shift+f）でも打つ'
    ],
    expected: [
      'ターミナルには文字がそのまま届く',
      'エクスプローラーと検索欄でも通常どおり動く（拡張機能が飲み込まない）'
    ]
  },
  {
    id: 'config-reload',
    area: 'settings',
    title: '設定の変更が再起動なしで反映される',
    why: '`onDidChangeConfiguration` は VS Code のイベントで、設定の保存という外部操作が要る',
    setup: [DEV_HOST, 'examples/settings.jsonc の中身を settings.json に貼る'],
    steps: [
      '`<leader>s`（スペース→s）で保存できることを確認する',
      '`vimLike.leader` を `,` に変えて保存する',
      '`,s` と `スペース→s` の両方を試す'
    ],
    expected: [
      '設定を保存した時点で新しい leader が効く（ウィンドウの再読み込みは不要）',
      '変更後は `,s` が保存になり、スペースは元の意味（1文字右へ移動）に戻る'
    ]
  },
  {
    id: 'invalid-remap-warning',
    area: 'settings',
    title: '読み込めないキー割り当ては警告として見える',
    why: '`showWarningMessage` の通知は VS Code の UI で、コア層は問題の文字列を返すだけ',
    setup: [DEV_HOST],
    steps: [
      'settings.json に `{ "before": [] }` のような不正な規則を1つ足して保存する',
      '通知を読む',
      '不正な規則を消して保存する'
    ],
    expected: [
      '何が読み込めなかったかを述べる警告通知が出る',
      '残りの正しい規則はそのまま効いている（全部が無効にならない）'
    ]
  },
  {
    id: 'external-cursor',
    area: 'integration',
    title: 'マウスや定義ジャンプでカーソルが動いたあとも j / k の列が正しい',
    why: '外部からの選択変更イベントは VS Code から非同期で届く。ハーネスにはこの経路がない',
    setup: [DEV_HOST, '長さの違う行が並んだファイルを開く'],
    steps: [
      '長い行の末尾付近をマウスでクリックする',
      '`j` `j` `k` `k` と押す',
      '短い行を通り過ぎてから長い行に戻る'
    ],
    expected: ['短い行では行末に寄り、長い行に戻ると元の桁に戻る（狙った桁が失われない）']
  },
  {
    id: 'undo-redo',
    area: 'integration',
    title: 'u と Ctrl+r が VS Code の取り消し履歴と噛み合う',
    why: '取り消しは VS Code の履歴に委譲しているため、粒度は実際の編集履歴でしか見られない',
    setup: [DEV_HOST],
    steps: ['`dd` `dw` `x` を続けて実行する', '`u` を何度か押す', '`Ctrl+r` を何度か押す'],
    expected: [
      '編集が1つずつ戻る（まとめて全部戻ってしまわない）',
      'Ctrl+r でやり直せる',
      '取り消しのあともモードが Normal のまま崩れない'
    ]
  },
  {
    id: 'crlf-buffer',
    area: 'integration',
    title: 'CRLF のファイルで行単位の操作が改行を壊さない',
    why: 'ハーネスは改行コードを指定できるが、実際の保存結果と混在の有無は実機でしか見えない',
    setup: [DEV_HOST, '改行コードが CRLF のファイルを開く（右下の表示で切り替えられる）'],
    steps: ['`dd` `p` `yy` `P` を試す', 'ファイルを保存する', '右下の改行コード表示を見る'],
    expected: ['CRLF のまま保たれ、LF が混ざらない', '行が結合したり空行が増えたりしない']
  },
  {
    id: 'explorer-keybindings',
    area: 'integration',
    title: 'エクスプローラーのキーバインド一式が動く',
    why: 'ツリービューの打鍵は `type` を通らず、keybindings.json 側の設定で成り立っている',
    setup: [DEV_HOST, 'examples/keybindings.jsonc の中身を keybindings.json に貼る'],
    steps: [
      'エディターから `<leader>n`（スペース→n）でツリーへ入る',
      '`j` `k` `h` `l` `gg` `G` で移動する',
      '`a` `shift+a` `r` `d` `y` `p` `enter` を試す',
      '`スペース→n` で閉じ、`スペース→l` と Escape で戻る'
    ],
    expected: [
      '移動とファイル操作が Vim 風の打鍵で行える',
      'enter はファイルなら開く、フォルダなら開閉する（既定のリネームが暴発しない）',
      '`スペース→n` は開くときも閉じるときも同じ打鍵として働く',
      'Escape と `スペース→l` はサイドバーを開いたままエディターへ戻る'
    ]
  },
  {
    id: 'toggle-enabled',
    area: 'settings',
    title: 'Vim モードの切り替えコマンドが効き、設定として残る',
    why: '設定の書き込み（Global スコープ）とコマンドパレットからの実行は VS Code の機能',
    setup: [DEV_HOST],
    steps: [
      'コマンドパレットから「Vim Like: Toggle Vim Mode」を実行する',
      '文字を打ってみる',
      'もう一度実行して戻す'
    ],
    expected: [
      '無効にすると普通のエディターとして打てる（ステータスバーの表示も消える）',
      '有効に戻すと Normal モードから再開する',
      '`vimLike.enabled` がユーザー設定に書き込まれている'
    ]
  }
];
