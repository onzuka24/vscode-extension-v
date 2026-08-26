import * as vscode from 'vscode';
import { Action, MarkListing } from './core/actions';
import { AiPanel, compileAiPanels } from './core/aiPanels';
import { SendOutcome, sendToAiPanel } from './adapter/aiPanel';
import { applyActions, readCursor } from './adapter/apply';
import { DocumentBuffer } from './adapter/buffer';
import { MarkDecorations } from './adapter/markDecorations';
import { ModeStatusBar } from './adapter/statusBar';
import { TerminalBridge } from './adapter/terminal';
import { EngineResult, VimEngine, VimState, createState, describePending, withExternalCursor } from './core/engine';
import { DEFAULT_LEADER, SPECIAL_KEYS } from './core/keys';
import { compileExCommands } from './core/excommands';
import { RemapRule, RemapTable } from './core/remap';
import { shouldPullCaretBack } from './core/cursor';
import { Mode, Position, pos } from './core/types';

const engine = new VimEngine();
let state: VimState = createState('normal');
let statusBar: ModeStatusBar;
let markDecorations: MarkDecorations;
let terminal: TerminalBridge;
let enabled = true;
let leader: string = DEFAULT_LEADER;

/**
 * Whether we actually own the `type` command. Without it there is no modal
 * editing at all, so the extension reports itself inactive however the `enabled`
 * setting is left — a half-working Vim mode is worse than none.
 */
let typeInterceptorReady = false;

/**
 * The selection we last placed ourselves. VS Code delivers selection-change
 * events asynchronously, so a simple "busy" flag would already be cleared by the
 * time our own move comes back and would make us resync against it.
 */
let lastAppliedSelection: string | undefined;

/**
 * Whether we believe the file tree is showing.
 *
 * VS Code gives an extension no way to ask. There is no API for view visibility,
 * and the `getContextKeyInfo` command returns the *declarations* of context keys
 * rather than their values, so `explorerViewletVisible` is unreadable from here.
 * A `when` clause is no help either: `<leader>n` arrives through the `type`
 * command, not through a keybinding, so there is nothing for a condition to gate.
 *
 * Remembering is acceptable because being wrong is cheap. Both directions are
 * idempotent — `workbench.action.closeSidebar` only ever closes, and
 * `workbench.files.action.focusFilesExplorer` only ever opens and focuses — so a
 * stale belief costs one keystroke that does the other thing, after which the
 * belief and reality agree again. Neither direction can destroy anything.
 *
 * It starts false so the first press of a session always opens and focuses, which
 * is the harmless guess: if the tree was already there, that press just moves
 * focus into it, exactly as `<leader>n` did before it became a toggle.
 *
 * Only VS Code's own ways of hiding the sidebar (`Cmd+B`, clicking the activity
 * bar) can desync it, because neither is observable.
 */
let fileTreeShowing = false;

/** The AI panels from `vimLike.aiPanels`, in the order they are written. */
let aiPanels: readonly AiPanel[] = [];
/**
 * Which panel `<leader>e` uses. Set by the chooser so that picking one sticks for
 * the rest of the session; with a single panel configured there is nothing to
 * choose and this stays on it. Deliberately not persisted — a default that
 * survives a restart with no way to see it would be a setting in disguise.
 */
let currentAiPanel: string | undefined;

/** Last `enabled:mode` pair pushed to the context keys, to avoid redundant round trips. */
let lastPublishedMode: string | undefined;

/** Serialises edits: `type` fires faster than `editor.edit` resolves. */
let queue: Promise<void> = Promise.resolve();

export function activate(context: vscode.ExtensionContext): void {
  statusBar = new ModeStatusBar();
  context.subscriptions.push(statusBar);
  markDecorations = new MarkDecorations();
  context.subscriptions.push(markDecorations);
  terminal = new TerminalBridge();
  context.subscriptions.push(terminal);

  enabled = configuration().get('enabled', true);
  state = createState(configuration().get('startInNormalMode', true) ? 'normal' : 'insert');
  loadRemaps();

  registerTypeInterceptor(context);
  registerCommands(context);
  registerListeners(context);

  void refresh();
}

export function deactivate(): void {
  void vscode.commands.executeCommand('setContext', 'vimLike.active', false);
  void vscode.commands.executeCommand('setContext', 'vimLike.mode', undefined);
}

// --------------------------------------------------------------------- input

/**
 * The commands VS Code routes typed text through, each of which an extension may
 * take over the same way it takes over `type`.
 *
 * `type` alone is not enough. The editor's view controller sends a composition —
 * what an IME produces — through three more of these: `compositionStart` when it
 * begins, then either `compositionType` or `replacePreviousChar` for each update,
 * then `compositionEnd`. Which of the two middle ones carries the text depends on
 * whether the update replaces characters after the caret. Leaving them alone left
 * a hole big enough to type through: in Normal mode `type` dropped the composing
 * text, and then the commit arrived on `replacePreviousChar` and went straight
 * into the buffer (#55).
 */
const INPUT_COMMANDS = ['type', 'compositionStart', 'compositionType', 'replacePreviousChar', 'compositionEnd'] as const;

/**
 * Whether a composition in progress is one we handed to the editor.
 *
 * The decision is made once, when the composition starts, and every part of that
 * composition then follows it. Deciding afresh per command would let a mode
 * change in the middle of composing split the sequence — the editor would be told
 * a composition began and never told it ended, or the reverse — and its cursor
 * controller keeps state across those calls.
 */
let delegatingComposition = false;

/**
 * Whether typed text belongs to VS Code rather than to us. Every one of the input
 * commands asks this same question, which is the point: a hole in one of them is
 * a hole in Normal mode.
 */
function shouldDelegateInput(): boolean {
  const editor = vscode.window.activeTextEditor;
  return !enabled || !editor || !isEditableEditor(editor) || state.mode === 'insert';
}

/**
 * Overriding `type` is what makes Normal mode a mode: keys that are not bound to
 * a command are swallowed instead of reaching the buffer. The override is global
 * to the whole window, so every path that is not certainly ours delegates to
 * `default:type`. Getting this wrong breaks typing everywhere, not just in this
 * extension.
 */
function registerTypeInterceptor(context: vscode.ExtensionContext): void {
  // All of them or none. Owning `type` while another extension owns
  // `replacePreviousChar` is the shape of the bug this guards against: text would
  // still reach the buffer in Normal mode, and nothing would say why.
  const claimed: vscode.Disposable[] = [];
  try {
    for (const command of INPUT_COMMANDS) {
      claimed.push(
        vscode.commands.registerCommand(command, (args: { text?: string } | undefined) =>
          handleInputCommand(command, args)
        )
      );
    }
    context.subscriptions.push(...claimed);
    typeInterceptorReady = true;
  } catch (error) {
    for (const disposable of claimed) disposable.dispose();

    // `type` is a single, window-wide registration. Losing the race to another
    // Vim extension is by far the most common reason to land here, so name the
    // culprit instead of reporting a bare failure.
    const rivals = conflictingExtensions();
    const cause =
      rivals.length > 0
        ? `${rivals.join('、')} が同じキー入力の仕組みを使っています。どちらか一方を無効にしてください。`
        : `他の拡張機能がキー入力を先に確保しています。 ${String(error)}`;

    void vscode.window.showErrorMessage(`Vim Like: キー入力を受け取れないため無効化しました。${cause}`);
  }
}

function handleInputCommand(command: string, args: { text?: string } | undefined): Thenable<unknown> | undefined {
  const delegate = (): Thenable<unknown> => vscode.commands.executeCommand(`default:${command}`, args);

  if (command === 'compositionStart') {
    delegatingComposition = shouldDelegateInput();
    return delegatingComposition ? delegate() : undefined;
  }

  if (command === 'compositionEnd') {
    const wasDelegating = delegatingComposition;
    delegatingComposition = false;
    return wasDelegating ? delegate() : undefined;
  }

  // The two that carry composed text. While a composition we started is running
  // they follow it, so that switching mode part-way cannot strand the editor with
  // half a composition applied.
  if (command === 'compositionType' || command === 'replacePreviousChar') {
    return delegatingComposition || shouldDelegateInput() ? delegate() : undefined;
  }

  if (shouldDelegateInput()) return delegate();

  const editor = vscode.window.activeTextEditor;
  const text = args?.text;
  if (!editor || typeof text !== 'string' || text.length === 0) return delegate();

  // Normal and Visual mode ignore text input. Anything longer than a single
  // character is composed text, which has no meaning as a Vim key, so it is
  // dropped rather than forwarded into the buffer.
  if ([...text].length !== 1) return undefined;

  return enqueue(() => handleKey(editor, text));
}

/** Extensions known to register the `type` command, which only one owner may have. */
const RIVAL_EXTENSIONS: readonly { id: string; name: string }[] = [
  { id: 'asvetliakov.vscode-neovim', name: 'VSCode Neovim' },
  { id: 'vscodevim.vim', name: 'Vim (vscodevim.vim)' }
];

function conflictingExtensions(): string[] {
  return RIVAL_EXTENSIONS.filter(rival => vscode.extensions.getExtension(rival.id) !== undefined).map(
    rival => rival.name
  );
}

async function handleKey(editor: vscode.TextEditor, key: string): Promise<void> {
  try {
    await feed(editor, key, false);
  } catch (error) {
    // One bad command must not wedge the session with a half-parsed prefix still
    // pending, which would make every following key look wrong too.
    state = { ...state, pendingKeys: '' };
    console.error(`Vim Like failed to handle the key ${JSON.stringify(key)}`, error);
  }
}

/**
 * Feeds one key, then any keys a remap expanded to. Each replayed key gets a
 * freshly read buffer, because an expansion such as `ddp` must see the document
 * as it stands after the delete. Replays go through `handleLiteralKey`, which is
 * what makes remapping non-recursive.
 */
async function feed(editor: vscode.TextEditor, key: string, literal: boolean): Promise<void> {
  const buffer = new DocumentBuffer(editor.document);
  const cursor = readCursor(editor, state.mode);
  const result = literal
    ? engine.handleLiteralKey(state, key, buffer, cursor)
    : engine.handleKey(state, key, buffer, cursor);

  if (!result.handled) {
    await vscode.commands.executeCommand('default:type', { text: key });
    return;
  }

  await commit(editor, result);

  for (const replayed of result.replay ?? []) {
    await feed(editor, replayed, true);
  }
}

async function commit(editor: vscode.TextEditor, result: EngineResult): Promise<void> {
  state = result.state;
  await applyActions(editor, result.actions, setMode, state.mode);
  lastAppliedSelection = selectionKey(editor.selection);
  await refresh();

  const listing = result.actions.find(isShowMarks);
  if (listing) {
    // Deliberately not awaited: the picker stays open for as long as the user
    // leaves it there, and awaiting it here would hold the keystroke queue.
    void showMarkPicker(editor, listing.entries).catch(error =>
      console.error('Vim Like failed to show the mark list', error)
    );
  }
}

function isShowMarks(action: Action): action is Extract<Action, { type: 'showMarks' }> {
  return action.type === 'showMarks';
}

interface MarkPick extends vscode.QuickPickItem {
  readonly name: string;
}

/**
 * `:marks`. Choosing a row does not move the caret directly — it replays `` ` ``
 * and the mark's name through the engine, so the jump is the same one the keys
 * would have made, including leaving a breadcrumb for `` `` ``.
 */
async function showMarkPicker(editor: vscode.TextEditor, entries: readonly MarkListing[]): Promise<void> {
  const here = editor.document.uri.toString();

  const items: MarkPick[] = entries.map(entry => ({
    name: entry.name,
    label: entry.name === '`' ? '` — 直前の位置' : entry.name,
    description: `${entry.line + 1}:${entry.character + 1}`,
    // A mark in another file names that file; one in this file shows its line.
    // Vim's `:marks` makes the same swap, and for the same reason: the line's
    // text is only worth showing when it is a line you are looking at.
    detail: entry.bufferId === here ? textOf(entry) : vscode.workspace.asRelativePath(vscode.Uri.parse(entry.bufferId))
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Vim Like: マーク',
    placeHolder: '選ぶとその位置へ移動します'
  });
  if (!picked) return;
  // The user may have moved on while the picker was open.
  if (vscode.window.activeTextEditor !== editor) return;

  await enqueue(async () => {
    await feed(editor, '`', true);
    await feed(editor, picked.name, true);
  });
}

function textOf(entry: MarkListing): string {
  return entry.text.trim() === '' ? '(空行)' : entry.text.trim();
}

function selectionKey(selection: vscode.Selection): string {
  const { anchor, active } = selection;
  return `${anchor.line}:${anchor.character}/${active.line}:${active.character}`;
}

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.catch(() => undefined).then(task);
  return queue;
}

// ------------------------------------------------------------------ commands

function registerCommands(context: vscode.ExtensionContext): void {
  const register = (id: string, callback: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, callback));
  };

  register('vimLike.escape', () =>
    withActiveEditor(editor => {
      const buffer = new DocumentBuffer(editor.document);
      return enqueue(() => commit(editor, engine.escape(state, buffer, readCursor(editor, state.mode))));
    })
  );

  register('vimLike.enterNormalMode', () =>
    withActiveEditor(editor => {
      const buffer = new DocumentBuffer(editor.document);
      return enqueue(() => commit(editor, engine.escape(state, buffer, readCursor(editor, state.mode))));
    })
  );

  register('vimLike.enterInsertMode', () =>
    withActiveEditor(editor =>
      enqueue(() => commit(editor, engine.setMode(state, 'insert', readCursor(editor, state.mode))))
    )
  );

  register('vimLike.redo', () => vscode.commands.executeCommand('redo'));

  // Enter, Backspace and Delete never arrive through `type`. They are delivered
  // the way Escape already is — a keybinding that feeds the matching token into
  // the engine — which is what stops VS Code from editing the buffer while
  // Normal mode is supposed to be swallowing the key.
  for (const [id, key] of [
    ['vimLike.enter', SPECIAL_KEYS.enter],
    ['vimLike.backspace', SPECIAL_KEYS.backspace],
    ['vimLike.delete', SPECIAL_KEYS.delete]
  ] as const) {
    register(id, () =>
      withActiveEditor(editor => enqueue(() => feed(editor, key, true)))
    );
  }

  // Terminal output is not a document, so the engine cannot reach it. Moving the
  // whole loop into a document is what gives it every motion, search and mark
  // without any of them being reimplemented.
  register('vimLike.openTerminalOutput', async () => {
    if (!terminal.available) {
      void vscode.window.showWarningMessage(
        'Vim Like: この VS Code はターミナルの出力を読む API に対応していません。'
      );
    }
    await terminal.open();
  });

  register('vimLike.showLog', () => terminal.showLog());

  register('vimLike.sendToTerminal', () =>
    withActiveEditor(async editor => {
      if (!(await terminal.send(editor))) {
        void vscode.window.showInformationMessage('Vim Like: 送る内容がありません。');
      }
    })
  );

  // `<leader>e` and `<leader>E`. What travels to the panel is a reference to the
  // line or selection, not its text — see `core/aiPanels.ts` for why that is the
  // only thing an already-open conversation will take.
  // Appended to every `:` command that closes an editor. In Vim `:qa` ends the
  // session; here the window stays behind, and with the last tab gone there is
  // nothing to type into and nothing to move around in — which reads as the
  // keyboard having stopped working (#57).
  register('vimLike.revealFileTreeIfEmpty', async () => {
    // Tabs rather than `visibleTextEditors`: a Git Graph or settings tab is not
    // something to type into, but it is something to act in, so the window is not
    // stranded and nothing should be forced open.
    const stranded = vscode.window.tabGroups.all.every(group => group.tabs.length === 0);
    if (!stranded) return;

    fileTreeShowing = true;
    await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
  });

  // `<leader>n`, and the same keys from inside the tree. Routed through one
  // command in both places so that closing from the tree keeps the belief above
  // in step; only VS Code's own sidebar keys can get it out of step.
  register('vimLike.toggleFileTree', async () => {
    if (fileTreeShowing) {
      fileTreeShowing = false;
      // Safe to call even when the sidebar is already hidden. The command does
      // carry a precondition of it being visible, but `registerAction2` applies a
      // precondition only to menus, the command palette and keybindings — the
      // handler that `executeCommand` reaches runs regardless, and hiding an
      // already-hidden part does nothing.
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
      return;
    }

    fileTreeShowing = true;
    // One command rather than `workbench.view.explorer`, which focuses the editor
    // instead when the tree already has focus. This one is unconditional: it
    // opens the sidebar on the explorer and puts the caret in the tree, so a
    // single press is enough to start moving with `j` and `k`.
    await vscode.commands.executeCommand('workbench.files.action.focusFilesExplorer');
  });

  // `<leader>R`. Which terminal receives is otherwise whichever was open last,
  // which is fine until there are two and the wrong one is running a server.
  register('vimLike.chooseTerminal', async () => {
    const outcome = await terminal.choose();
    if (outcome === 'none') {
      void vscode.window.showInformationMessage('Vim Like: 送り先は変わっていません。');
    }
  });

  register('vimLike.sendToAIPanel', () =>
    withActiveEditor(async editor => {
      const panel = chosenAiPanel();
      if (panel) reportSend(await sendToAiPanel(editor, state.mode, panel), panel);
    })
  );

  register('vimLike.chooseAIPanel', () =>
    withActiveEditor(async editor => {
      const panel = await askForAiPanel();
      if (!panel) return;
      currentAiPanel = panel.name;
      reportSend(await sendToAiPanel(editor, state.mode, panel), panel);
    })
  );

  register('vimLike.toggleEnabled', async () => {
    enabled = !enabled;
    await configuration().update('enabled', enabled, vscode.ConfigurationTarget.Global);
    await refresh();
  });
}

function registerListeners(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor) return;
      const mode: Mode = configuration().get('startInNormalMode', true) ? 'normal' : state.mode;
      state = { ...createState(mode), desiredColumn: readCursor(editor, mode).character };
      void refresh();
    }),

    // A click, an arrow key or a jump to a definition moves the caret without us:
    // resync so that the column `j` and `k` aim for is not stale, and put the
    // caret back where the mode allows it to be.
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor !== vscode.window.activeTextEditor) return;
      if (selectionKey(event.textEditor.selection) === lastAppliedSelection) return;
      const cursor = readCursor(event.textEditor, state.mode);
      state = withExternalCursor(state, cursor);
      pullCaretBack(event.textEditor, cursor);
    }),

    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('vimLike')) return;
      enabled = configuration().get('enabled', true);
      loadRemaps();
      void refresh();
    })
  );
}

// -------------------------------------------------------------------- shared

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('vimLike');
}

/**
 * Reads the user's remap rules. Rules that cannot be understood are reported
 * rather than dropped in silence — a binding that quietly never fires is
 * indistinguishable from a broken feature.
 */
function loadRemaps(): void {
  const settings = configuration();
  const { table, problems } = RemapTable.from({
    normal: settings.get<RemapRule[]>('normalModeKeyBindings', []),
    visual: settings.get<RemapRule[]>('visualModeKeyBindings', []),
    leader: settings.get<string>('leader', DEFAULT_LEADER)
  });

  engine.setRemaps(table);
  leader = table.leader;

  const ex = compileExCommands(settings.get<Record<string, string[]>>('exCommands', {}));
  engine.setExCommands(ex.table);
  problems.push(...ex.problems);

  const ai = compileAiPanels(settings.get<unknown>('aiPanels'));
  aiPanels = ai.panels;
  problems.push(...ai.problems);
  if (!aiPanels.some(panel => panel.name === currentAiPanel)) currentAiPanel = undefined;

  if (problems.length > 0) {
    void vscode.window.showWarningMessage(
      `Vim Like: 設定のキー割り当てを一部読み込めませんでした。 ${problems.join(' / ')}`
    );
  }
}

function withActiveEditor<T>(action: (editor: vscode.TextEditor) => T): T | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor ? action(editor) : undefined;
}

/** The panel `<leader>e` sends to, or nothing when none is configured. */
function chosenAiPanel(): AiPanel | undefined {
  if (aiPanels.length === 0) {
    void vscode.window.showWarningMessage(
      'Vim Like: 送り先が設定されていません。settings.json の vimLike.aiPanels に ' +
        '{ "name": …, "command": … } を並べてください。examples/settings.jsonc に例があります。'
    );
    return undefined;
  }
  return aiPanels.find(panel => panel.name === currentAiPanel) ?? aiPanels[0];
}

async function askForAiPanel(): Promise<AiPanel | undefined> {
  const current = chosenAiPanel();
  if (!current) return undefined;
  if (aiPanels.length === 1) return current;

  const picked = await vscode.window.showQuickPick(
    aiPanels.map(panel => ({
      label: panel.name,
      description: panel.name === current.name ? `${panel.command} (現在の送り先)` : panel.command,
      panel
    })),
    { title: 'Vim Like: 送り先', placeHolder: '選ぶと以降の <leader>e もここへ送ります' }
  );
  return picked?.panel;
}

function reportSend(outcome: SendOutcome, panel: AiPanel): void {
  if (outcome.kind === 'sent') return;

  if (outcome.kind === 'nothing') {
    void vscode.window.showInformationMessage('Vim Like: 空行なので送るものがありません。');
    return;
  }

  if (outcome.kind === 'unsaved') {
    void vscode.window.showInformationMessage(
      'Vim Like: 保存していないファイルは送れません。送るのは場所への参照なので、' +
        'ファイルに名前がないと指す先がありません。先に保存してください。'
    );
    return;
  }

  // Naming the command is what makes this actionable: the usual cause is that the
  // panel's own extension is not installed, or renamed the command.
  void vscode.window.showWarningMessage(
    `Vim Like: ${panel.name} へ送れませんでした。コマンド ${outcome.command} を実行できません。` +
      'その拡張機能が入っているか、コマンド ID が変わっていないか確かめてください。'
  );
}

/**
 * Draws the caret where the mode says it is, after something outside this
 * extension moved it — a click past the end of a line, most often.
 *
 * Nothing about what commands do changes here: `readCursor` already clamps, so
 * `x` at such a caret has always deleted the last character rather than nothing.
 * What is fixed is the disagreement between that and what the caret shows, which
 * is how the author's `set mouse=` habit turns into a visible bug in VS Code —
 * the mouse cannot be switched off, so the caret it leaves has to be corrected.
 */
function pullCaretBack(editor: vscode.TextEditor, clamped: Position): void {
  if (!enabled || !isEditableEditor(editor)) return;

  const selection = editor.selection;
  // The mode is not passed on: `readCursor` has already applied it to `clamped`.
  const decision = {
    active: pos(selection.active.line, selection.active.character),
    clamped,
    caretCount: editor.selections.length,
    hasSelection: !selection.isEmpty
  };
  if (!shouldPullCaretBack(decision)) return;

  const position = new vscode.Position(clamped.line, clamped.character);
  editor.selection = new vscode.Selection(position, position);
  // Our own write comes back as another selection change. It would settle by
  // itself — a clamped position clamps to itself, so the second pass finds
  // nothing to do — but recording it keeps this the same as every other place
  // that moves the caret, so a future correction that is not idempotent cannot
  // quietly start bouncing.
  lastAppliedSelection = selectionKey(editor.selection);
}

/**
 * Surfaces that report as text editors but are not somewhere to edit: the output
 * panel, the debug console, and the terminal's own buffer view.
 */
const READ_ONLY_SCHEMES: ReadonlySet<string> = new Set(['output', 'debug', 'vscode-terminal']);

/**
 * Whether this is an editor Vim mode belongs in.
 *
 * Decided by scheme rather than by `viewColumn`. `viewColumn` is
 * `undefined` for any editor that is not one of the main ones — which includes
 * every pane of a diff editor, and any group past the third. Using it meant
 * Normal mode silently stopped working when reviewing a diff, or in a fourth
 * editor group.
 */
function isEditableEditor(editor: vscode.TextEditor): boolean {
  return !READ_ONLY_SCHEMES.has(editor.document.uri.scheme);
}

function setMode(mode: Mode): void {
  state = { ...state, mode };
}

/**
 * The extension counts as active only when the `enabled` setting is on *and* we
 * own key input. Reporting active without owning `type` would light up the
 * keybindings and the status bar while Normal mode silently let every key
 * through to the buffer.
 */
function isActive(): boolean {
  return enabled && typeInterceptorReady;
}

/** Pushes the current mode out to the context keys, the status bar and the caret. */
async function refresh(): Promise<void> {
  const active = isActive();

  // `refresh` runs on every keystroke, and `setContext` is a round trip through
  // the extension host, so publish only when the mode has actually changed.
  const published = `${active}:${state.mode}`;
  if (published !== lastPublishedMode) {
    lastPublishedMode = published;
    await vscode.commands.executeCommand('setContext', 'vimLike.active', active);
    await vscode.commands.executeCommand('setContext', 'vimLike.mode', active ? state.mode : 'insert');
  }

  statusBar.update(state.mode, {
    visible: configuration().get('showModeInStatusBar', true),
    enabled: active,
    pending: describePending(state, leader)
  });

  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  // Cheap on a keystroke that changed nothing: the renderer compares what it
  // last drew and returns before touching the editor.
  markDecorations.render(
    editor,
    engine.listMarks(editor.document.uri.toString()),
    active && configuration().get('showMarks', true)
  );

  // A block caret is how Normal mode announces itself. Only assign when it
  // actually differs — this runs on every keystroke.
  const wanted =
    active && state.mode !== 'insert' ? vscode.TextEditorCursorStyle.Block : vscode.TextEditorCursorStyle.Line;
  if (editor.options.cursorStyle !== wanted) {
    editor.options = { ...editor.options, cursorStyle: wanted };
  }
}
