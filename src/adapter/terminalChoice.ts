/**
 * How the terminals are described when choosing which one `<leader>r` sends to.
 *
 * Kept apart from `terminal.ts` so it holds no `vscode` import and can be tested
 * directly. The wording carries real weight here: whether a terminal has shell
 * integration decides whether its output can be captured at all, and that is
 * invisible otherwise. Saying so in the list is the difference between choosing
 * badly on purpose and wondering later why nothing was appended.
 */

export interface TerminalChoice {
  readonly name: string;
  /**
   * `Terminal.state.shell`: the shell VS Code detected. Undefined when there is
   * no clear signal, which is common right after a terminal opens and for shells
   * VS Code does not recognise.
   */
  readonly shell: string | undefined;
  readonly hasShellIntegration: boolean;
  /** Whether this is the terminal we are already sending to. */
  readonly isCurrent: boolean;
}

export interface ChoiceLabel {
  readonly label: string;
  readonly description: string;
}

export function describeTerminal(choice: TerminalChoice): ChoiceLabel {
  const parts = [choice.shell ?? 'シェル不明'];
  parts.push(
    choice.hasShellIntegration ? 'シェル統合あり' : 'シェル統合なし (出力を取り込めません)'
  );
  if (choice.isCurrent) parts.push('現在の送り先');

  return { label: choice.name, description: parts.join(' · ') };
}

/** The row that opens a new terminal, letting VS Code ask which shell to use. */
export const NEW_TERMINAL_LABEL = '$(add) 新しいターミナル…';
export const NEW_TERMINAL_DESCRIPTION = 'シェルは VS Code の一覧から選びます';
