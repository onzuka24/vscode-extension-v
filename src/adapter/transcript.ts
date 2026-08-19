/**
 * Prepares terminal output for the working document: strips what only makes
 * sense on a terminal, and formats each run as a transcript entry.
 *
 * Kept free of any `vscode` import so that what lands in the document can be
 * asserted in a test — the same split as `markIcon.ts`.
 */

/*
 * The escape character is itself a control character, which is exactly what
 * these patterns exist to remove — so the rule that guards against stray ones
 * has nothing to catch here.
 */
/* eslint-disable no-control-regex */

/** `ESC ] ... BEL` or `ESC ] ... ESC \` — window titles, hyperlinks. */
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** `ESC [ ... letter` — colours, cursor movement, line clearing. */
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;

/** Two-character escapes that neither of the above covers. */
const OTHER_ESCAPES = /\x1b[@-Z\\-_]/g;

/* eslint-enable no-control-regex */

/**
 * Strips the escape sequences and resolves carriage returns.
 *
 * The `\r` handling is the part that matters in practice: progress bars and
 * spinners redraw a line by returning to its start, so keeping the raw text
 * would show every intermediate frame stacked together. Only what the terminal
 * actually left on each line survives.
 */
export function plainTerminalText(raw: string): string {
  const withoutEscapes = raw.replace(OSC, '').replace(CSI, '').replace(OTHER_ESCAPES, '');

  return withoutEscapes
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(collapseCarriageReturns)
    .join('\n');
}

function collapseCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line;

  // Each `\r` returns the cursor to column 0, so what follows overwrites from
  // there — hiding only as much of the earlier text as it actually covers.
  let rendered = '';
  for (const segment of line.split('\r')) {
    rendered = segment + rendered.slice(segment.length);
  }
  return rendered;
}

/**
 * Keeps the tail of a long capture. The end is where the failure usually is, so
 * dropping the head loses less than cutting the output short would.
 */
export function keepTail(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };

  const tail = text.slice(text.length - limit);
  // Start at a line boundary; beginning mid-line reads as corruption.
  const firstBreak = tail.indexOf('\n');
  return { text: firstBreak === -1 ? tail : tail.slice(firstBreak + 1), truncated: true };
}

/**
 * One run, as it appears in the working document.
 *
 * The rule above the output separates the result from whatever the user typed to
 * start it. Without it a command line and its echo sit next to each other and it
 * is not obvious which is which.
 */
export function formatTranscriptEntry(command: string, output: string): string {
  const body = output.replace(/\n+$/, '');
  return ['', `\u2500\u2500\u2500 $ ${command}`, body, ''].join('\n');
}
