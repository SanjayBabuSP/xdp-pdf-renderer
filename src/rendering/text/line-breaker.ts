/**
 * Line breaker — greedy wrap matching the engine's line-breaking rules
 * (jftext:65339 wrap limit = frame − margins − first-line indent, tolerance
 * 0.5pt, :49545 break prohibition, :120422 hyphenation off by default).
 *
 * Hard line breaks (\n) always split. Soft wrap breaks at whitespace, allows
 * `tolerance` overshoot before forcing a break, splits words that alone
 * exceed the limit, and avoids breaking immediately before closing
 * punctuation or immediately after opening punctuation.
 */

/** Break tolerance in points (jftext:65339). */
export const LINE_BREAK_TOLERANCE = 0.5;

/** Never begin a line with these (break-after is forced instead). */
export const NO_BREAK_BEFORE = new Set([
  '.', ',', ';', ':', '!', '?', ')', ']', '}', '%', "'", '"', '’', '”', '…', '。', '，', '、',
]);

/** Never end a line with these. */
export const NO_BREAK_AFTER = new Set(['(', '[', '{', '«', '“', '‘']);

export interface LineBreakOptions {
  /** Allowed overshoot before a forced break; default 0.5. */
  tolerance?: number;
}

/** A wrapped line plus whether it closes its source paragraph. */
export interface TextLine {
  text: string;
  /**
   * Last line of a hard-break paragraph (the line the `\n` terminated, or
   * the final line of the text). JustH 4 leaves these left-aligned while
   * code 5 distributes every line (jftext:73387-73400).
   */
  paragraphEnd: boolean;
}

/**
 * Break `text` into lines no wider than `maxWidth` (plus tolerance),
 * measured by `measure`, keeping paragraph-end flags.
 */
export function breakLinesInfo(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  opts: LineBreakOptions = {}
): TextLine[] {
  const tolerance = opts.tolerance ?? LINE_BREAK_TOLERANCE;
  const info: TextLine[] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    const chunk: string[] = [];
    wrapParagraph(paragraph, maxWidth, measure, tolerance, chunk);
    for (let i = 0; i < chunk.length; i++) {
      info.push({ text: chunk[i], paragraphEnd: i === chunk.length - 1 });
    }
  }

  if (info.length === 0) return [{ text, paragraphEnd: true }];
  return info;
}

/**
 * Break `text` into lines no wider than `maxWidth` (plus tolerance),
 * measured by `measure`. Returns at least one line for non-empty input.
 */
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
  lines: string[]
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

  const push = (): void => {
    if (current !== '') lines.push(current.trimEnd());
    current = '';
  };

  for (const token of tokens) {
    if (token === '') continue;
    if (/^\s+$/.test(token)) {
      if (current !== '') current += token;
      continue;
    }
    const candidate = current + token;
    if (measure(candidate) <= maxWidth + tolerance) {
      current = candidate;
      continue;
    }
    // Overflows: break before this token unless the break is prohibited —
    // a prohibited break lets the line stretch (jftext:49545).
    const firstChar = token[0];
    if (current.trim() !== '' && NO_BREAK_BEFORE.has(firstChar)) {
      current = candidate;
      continue;
    }
    push();
    const trimmed = token.trimStart();
    if (measure(trimmed) <= maxWidth + tolerance) {
      current = trimmed;
    } else {
      // Single token wider than the limit — split by characters.
      splitLongToken(trimmed, maxWidth, measure, tolerance, lines);
      current = '';
    }
  }
  push();
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
      // Prohibited breaks (after opener / before closer) let the line stretch.
      if (NO_BREAK_BEFORE.has(ch) || NO_BREAK_AFTER.has(last)) {
        current += ch;
        continue;
      }
      lines.push(current);
      current = ch;
      continue;
    }
    current += ch;
  }
  if (current !== '') lines.push(current);
}
