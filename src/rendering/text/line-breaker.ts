export const LINE_BREAK_TOLERANCE = 0.5;

export const NO_BREAK_BEFORE = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '%',
  "'",
  '"',
  '’',
  '”',
  '…',
  '。',
  '，',
  '、',
]);

export const NO_BREAK_AFTER = new Set(['(', '[', '{', '«', '“', '‘']);

export const BREAK_OPPORTUNITY = new Set(['/', '\u00ad', '\u200b']);

export interface LineBreakOptions {
  tolerance?: number;
  firstLineIndent?: number;
}

export interface TextLine {
  text: string;
  paragraphEnd: boolean;
}

const FORCED_BREAK_RE = /\r\n|\r|\n|\u2028|\u2029/g;

export function breakLinesInfo(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  opts: LineBreakOptions = {}
): TextLine[] {
  const tolerance = opts.tolerance ?? LINE_BREAK_TOLERANCE;
  const firstLineIndent = opts.firstLineIndent ?? 0;
  const info: TextLine[] = [];

  const segments: Array<{ text: string; paragraphEnd: boolean }> = [];
  let last = 0;
  FORCED_BREAK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORCED_BREAK_RE.exec(text)) !== null) {
    segments.push({ text: text.slice(last, match.index), paragraphEnd: match[0] !== '\u2028' });
    last = match.index + match[0].length;
  }
  segments.push({ text: text.slice(last), paragraphEnd: true });

  for (const segment of segments) {
    const chunk: string[] = [];
    wrapParagraph(segment.text, maxWidth, measure, tolerance, chunk, firstLineIndent);
    for (let i = 0; i < chunk.length; i++) {
      info.push({ text: chunk[i], paragraphEnd: i === chunk.length - 1 && segment.paragraphEnd });
    }
  }

  if (info.length === 0) return [{ text, paragraphEnd: true }];
  return info;
}

export function breakLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  opts: LineBreakOptions = {}
): string[] {
  return breakLinesInfo(text, maxWidth, measure, opts).map((line) => line.text);
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: (s: string) => number,
  tolerance: number,
  lines: string[],
  firstLineIndent: number
): void {
  if (paragraph === '') {
    lines.push('');
    return;
  }
  if (maxWidth <= 0) {
    lines.push(paragraph);
    return;
  }

  const tokens = paragraph.split(/(\s+)/);
  let current = '';
  let lineLimit = maxWidth - Math.max(firstLineIndent, 0);

  const push = (): void => {
    if (current !== '') lines.push(current.trimEnd());
    current = '';
    lineLimit = maxWidth;
  };

  for (const token of tokens) {
    if (token === '') continue;
    if (/^\s+$/.test(token)) {
      if (current !== '') current += token;
      continue;
    }
    const candidate = current + token;
    if (measure(candidate) <= lineLimit + tolerance) {
      current = candidate;
      continue;
    }
    const firstChar = token[0];
    if (current.trim() !== '' && NO_BREAK_BEFORE.has(firstChar)) {
      current = candidate;
      continue;
    }
    const breakTail = breakAtOpportunity(
      token,
      current,
      lineLimit,
      maxWidth,
      measure,
      tolerance,
      lines
    );
    if (breakTail != null) {
      current = breakTail;
      continue;
    }
    push();
    const trimmed = token.trimStart();
    if (measure(trimmed) <= lineLimit + tolerance) {
      current = trimmed;
    } else {
      splitLongToken(trimmed, lineLimit, measure, tolerance, lines);
      lineLimit = maxWidth;
      current = '';
    }
  }
  push();
}

function breakAtOpportunity(
  token: string,
  current: string,
  lineLimit: number,
  maxWidth: number,
  measure: (s: string) => number,
  tolerance: number,
  lines: string[]
): string | null {
  for (let i = token.length - 1; i > 0; i--) {
    const opportunity = token[i - 1];
    if (!BREAK_OPPORTUNITY.has(opportunity)) continue;
    const tail = token.slice(i);
    if (opportunity === '/' && tail.startsWith('/')) continue;
    const head = token.slice(0, i);
    if (measure(current + head) <= lineLimit + tolerance && measure(tail) <= maxWidth + tolerance) {
      lines.push((current + head).trimEnd());
      return tail;
    }
  }
  return null;
}

function lastBreakIndex(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (!BREAK_OPPORTUNITY.has(text[i])) continue;
    if (text[i] === '/' && text[i + 1] === '/') continue;
    return i;
  }
  return -1;
}

function splitLongToken(
  token: string,
  maxWidth: number,
  measure: (s: string) => number,
  tolerance: number,
  lines: string[]
): void {
  let current = '';
  for (const ch of token) {
    if (current !== '' && measure(current + ch) > maxWidth + tolerance) {
      const last = current[current.length - 1];
      if (NO_BREAK_BEFORE.has(ch) || NO_BREAK_AFTER.has(last)) {
        current += ch;
        continue;
      }
      const splitAt = lastBreakIndex(current);
      const head = splitAt > 0 ? current.slice(0, splitAt + 1) : current;
      const rest = splitAt > 0 ? current.slice(splitAt + 1) : '';
      lines.push(head);
      current = rest + ch;
      continue;
    }
    current += ch;
  }
  if (current !== '') lines.push(current);
}
