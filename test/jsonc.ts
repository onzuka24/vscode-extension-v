/**
 * Minimal JSONC reader for the files under `examples/`.
 *
 * Those files carry explanatory notes after the value itself, so the first
 * balanced value is taken and the rest ignored. Comments inside strings are left
 * alone, which matters because command IDs contain slashes-free but quoted text
 * generally cannot be assumed comment-free.
 */
export function parseJsonc<T>(source: string): T {
  return JSON.parse(extractValue(stripComments(source))) as T;
}

/**
 * The same file with the commentary taken out: plain JSON, ready to paste.
 *
 * The layout is kept rather than reformatted. Running the parsed value back
 * through `JSON.stringify` would put every `"before": ["H"]` on four lines of its
 * own and make the result harder to read than the annotated original — the
 * opposite of the point. So this removes lines and nothing else: each rule stays
 * on the one line it was written on.
 *
 * Trailing notes after the closing brace disappear on their own, since stripping
 * their `//` leaves nothing behind.
 */
export function withoutComments(source: string): string {
  const kept = stripComments(source)
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line !== '');
  return `${kept.join('\n')}\n`;
}

function stripComments(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      if (newline === -1) break;
      i = newline - 1;
      continue;
    }

    result += char;
  }
  return result;
}

/** Takes the first balanced `{...}` or `[...]`, ignoring anything that follows. */
function extractValue(text: string): string {
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('JSON の値が見つかりません');

  const open = text[start]!;
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return text.slice(start, i + 1);
  }

  throw new Error('括弧が閉じていません');
}
