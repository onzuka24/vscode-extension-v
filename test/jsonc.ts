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
