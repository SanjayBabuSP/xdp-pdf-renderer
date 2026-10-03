/**
 * Run flow — measure and wrap a sequence of styled runs (rich text) with a
 * per-run font and size, so `<span>` sizing/weight changes survive wrapping
 * instead of being flattened by `stripHtml`.
 *
 * Wrapping rules mirror `line-breaker.ts` (0.5pt tolerance, break
 * prohibition) but the unit of measurement is a styled token rather than a
 * plain string: a word may straddle several runs, so it is measured run by
 * run and drawn the same way (no kerning across the run seam).
 */

import type { PDFFont } from 'pdf-lib';
import type { RgbColor } from '../../types';
import { defaultAscent, defaultLineAdvance, fontAscent, type VerticalAlign } from './line-metrics';
import {
  LINE_BREAK_TOLERANCE,
  NO_BREAK_AFTER,
  NO_BREAK_BEFORE,
} from './line-breaker';
import { JUST_H, type JustHCode } from './justifier';

/** A run of text sharing one font, size and colour. */
export interface StyledRun {
  text: string;
  size: number;
  font: PDFFont;
  color?: RgbColor;
}

/** One drawn piece of a line: text at an x offset from the line origin. */
export interface RunSegment {
  text: string;
  x: number;
  /** Index into the input runs — carries font/size/colour. */
  run: number;
}

/** Paragraph box controls for a run of styled text. */
export interface RunParagraphOptions {
  /** Explicit line advance, points; defaults to 1.2 × the largest run size. */
  lineAdvance?: number;
  /** Left inset of the paragraph text block, points. */
  marginLeft?: number;
  /** Right inset of the paragraph text block, points. */
  marginRight?: number;
  /** First-line indent, points, applied to each paragraph’s first line. */
  firstLineIndent?: number;
  /**
   * Horizontal justification for the line. Codes 4/5 redistribute the line’s
   * unused width across its space-class glyphs; the other codes only affect
   * the caller’s line origin. evidence: jftext_disasm.c:73245.
   */
  justify?: JustHCode;
}

export interface RunLine {
  segments: RunSegment[];
  /** Natural width — sum of the drawn pieces (segments are drawn separately). */
  width: number;
  /**
   * First-line indent consumed while wrapping this line. The renderer adds it
   * to the line origin; it is not included in `width`.
   */
  indent: number;
  /** Line box height: 1.2 × the largest run size on the line (font:10517). */
  advance: number;
  /** Largest run ascent on the line, box top → baseline. */
  ascent: number;
  /** Closes a hard-break paragraph (`\n`), or is the final line of the text. */
  paragraphEnd: boolean;
}

export interface RunLineOptions {
  maxWidth: number;
  /** Width of `text` as rendered by run `run` (kerning on, as drawn). */
  measure: (text: string, run: number) => number;
  /** Size used for blank lines produced by consecutive line breaks. */
  baseSize: number;
  /** Allowed overshoot before a forced break; default 0.5. */
  tolerance?: number;
  /** Paragraph insets, first-line indent, and explicit line advance. */
  paragraph?: RunParagraphOptions;
}

interface Piece {
  text: string;
  run: number;
}

interface WordToken {
  kind: 'word';
  pieces: Piece[];
  width: number;
}

interface SpaceToken {
  kind: 'space';
  pieces: Piece[];
  width: number;
}

interface NewlineToken {
  kind: 'nl';
}

type Token = WordToken | SpaceToken | NewlineToken;

/**
 * Wrap `runs` into lines no wider than `maxWidth` (plus tolerance).
 *
 * Lines carry their own `advance`/`ascent` so a 16pt run inside an 8pt
 * paragraph grows that line's box, and each segment keeps the x offset it
 * must be drawn at from the line origin.
 */
export function layoutRunLines(runs: StyledRun[], opts: RunLineOptions): RunLine[] {
  const tolerance = opts.tolerance ?? LINE_BREAK_TOLERANCE;
  const measure = opts.measure;
  const marginLeft = Math.max(opts.paragraph?.marginLeft ?? 0, 0);
  const marginRight = Math.max(opts.paragraph?.marginRight ?? 0, 0);
  const firstLineIndent = Math.max(opts.paragraph?.firstLineIndent ?? 0, 0);
  const contentWidth = Math.max(opts.maxWidth - marginLeft - marginRight, 0);
  const lineWidthFor = (isFirstLine: boolean): number =>
    Math.max(contentWidth - (isFirstLine ? firstLineIndent : 0), 0);
  const tokens = tokenize(runs, measure);
  const lines: RunLine[] = [];

  let current: Token[] = [];
  let width = 0;
  let wordCount = 0;
  let startsParagraph = true;

  const pushLine = (paragraphEnd: boolean): void => {
    // Trailing whitespace is trimmed off the end of a line (line-breaker.ts).
    while (current.length > 0 && current[current.length - 1].kind === 'space') {
      width -= (current.pop() as SpaceToken).width;
    }
    lines.push(
      buildLine(current, runs, measure, paragraphEnd, opts, startsParagraph)
    );
    current = [];
    width = 0;
    wordCount = 0;
    startsParagraph = paragraphEnd;
  };

  const addWord = (pieces: Piece[], w: number): void => {
    if (wordCount === 0) {
      // Leading whitespace never starts a line (line-breaker.ts skips it).
      while (current.length > 0 && current[current.length - 1].kind === 'space') {
        width -= (current.pop() as SpaceToken).width;
      }
    }
    current.push({ kind: 'word', pieces, width: w });
    width += w;
    wordCount += 1;
  };

  const placeWord = (token: WordToken, isFirstLine: boolean): void => {
    if (token.width <= lineWidthFor(isFirstLine) + tolerance) {
      addWord(token.pieces, token.width);
      return;
    }
    // A single word wider than the frame is split by characters
    // (line-breaker.ts `splitLongToken`). Only the first chunk of a
    // paragraph’s first line is narrowed by the indent.
    const chunks = hardSplit(
      token,
      (chunkIndex) => lineWidthFor(isFirstLine && chunkIndex === 0),
      measure,
      tolerance
    );
    for (let i = 0; i < chunks.length - 1; i++) {
      addWord(chunks[i].pieces, chunks[i].width);
      pushLine(false);
    }
    const last = chunks[chunks.length - 1];
    if (last) addWord(last.pieces, last.width);
  };

  for (const token of tokens) {
    if (token.kind === 'nl') {
      pushLine(true);
      continue;
    }
    if (token.kind === 'space') {
      current.push(token);
      width += token.width;
      continue;
    }

    // Pending spaces become interior once the word follows, so the candidate
    // width includes them; pushLine trims them if the line ends there.
    // `startsParagraph` stays true for every token on the current first line and
    // is cleared when that line is committed.
    const fits = width + token.width <= lineWidthFor(startsParagraph) + tolerance;
    if (fits) {
      addWord(token.pieces, token.width);
      continue;
    }
    if (wordCount > 0) pushLine(false);
    placeWord(token, startsParagraph);
  }
  pushLine(true);

  return lines;
}

/**
 * Baselines for `lines` stacked inside `[box.bottom, box.top]` — same
 * alignment rules as `layoutLines`, but each line steps by its own advance.
 */
export function layoutRunBaselines(
  lines: RunLine[],
  box: { top: number; bottom: number },
  align: VerticalAlign = 'top'
): number[] {
  const blockHeight = lines.reduce((sum, line) => sum + line.advance, 0);
  const boxHeight = box.top - box.bottom;

  let blockTop: number;
  if (align === 'bottom') {
    blockTop = box.bottom + blockHeight;
  } else if (align === 'middle') {
    blockTop = box.bottom + (boxHeight + blockHeight) / 2;
  } else {
    blockTop = box.top;
  }

  const baselines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    baselines.push(
      i === 0 ? blockTop - lines[0].ascent : baselines[i - 1] - lines[i - 1].advance
    );
  }
  return baselines;
}

/** Total height of the laid-out block — for the overflow-clip test. */
export function runBlockHeight(lines: RunLine[]): number {
  return lines.reduce((sum, line) => sum + line.advance, 0);
}

// ── Internals ────────────────────────────────────────────────────────────────

function tokenize(runs: StyledRun[], measure: (text: string, run: number) => number): Token[] {
  const tokens: Token[] = [];
  let word: Piece[] = [];
  let space: Piece[] = [];

  const pieceWidth = (pieces: Piece[]): number =>
    pieces.reduce((sum, piece) => sum + measure(piece.text, piece.run), 0);

  const appendChar = (bucket: Piece[], ch: string, run: number): Piece[] => {
    const last = bucket[bucket.length - 1];
    if (last && last.run === run) last.text += ch;
    else bucket.push({ text: ch, run });
    return bucket;
  };

  const flushWord = (): void => {
    if (word.length === 0) return;
    tokens.push({ kind: 'word', pieces: word, width: pieceWidth(word) });
    word = [];
  };
  const flushSpace = (): void => {
    if (space.length === 0) return;
    tokens.push({ kind: 'space', pieces: space, width: pieceWidth(space) });
    space = [];
  };

  for (let run = 0; run < runs.length; run++) {
    const text = runs[run].text;
    for (const ch of text) {
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r') continue;
        flushWord();
        flushSpace();
        tokens.push({ kind: 'nl' });
        continue;
      }
      if (/\s/.test(ch)) {
        flushWord();
        appendChar(space, ' ', run);
        continue;
      }
      flushSpace();
      appendChar(word, ch, run);
    }
  }
  flushWord();
  flushSpace();
  return tokens;
}

function buildLine(
  tokens: Token[],
  runs: StyledRun[],
  measure: (text: string, run: number) => number,
  paragraphEnd: boolean,
  opts: RunLineOptions,
  paragraphStart: boolean
): RunLine {
  const justify = opts.paragraph?.justify ?? JUST_H.unset;
  const indent = paragraphStart
    ? Math.max(opts.paragraph?.firstLineIndent ?? 0, 0)
    : 0;
  const rawSegments: Array<RunSegment & { spacesBefore: number }> = [];
  let x = 0;
  let maxSize = 0;
  let ascent = 0;
  let pendingSpaces = 0;
  let gapCount = 0;

  for (const token of tokens) {
    if (token.kind === 'space') {
      const spaces = token.pieces.reduce((count, piece) => count + piece.text.length, 0);
      x += token.width;
      pendingSpaces += spaces;
      gapCount += spaces;
      continue;
    }
    if (token.kind === 'nl') continue;
    for (const piece of token.pieces) {
      rawSegments.push({ text: piece.text, x, run: piece.run, spacesBefore: pendingSpaces });
      const run = runs[piece.run];
      x += measure(piece.text, piece.run);
      if (run.size > maxSize) {
        maxSize = run.size;
        ascent = fontAscent(run.font, run.size);
      }
      pendingSpaces = 0;
    }
  }

  // jftext Justify distributes unused width across space-class glyphs while
  // preserving each styled piece; code 4 skips a paragraph’s final line.
  const justifyLine =
    (justify === JUST_H.justifyAll || (justify === JUST_H.justify && !paragraphEnd)) &&
    gapCount > 0 &&
    rawSegments.length > 0;
  let segments: RunSegment[] = rawSegments.map(({ text, x, run }) => ({ text, x, run }));
  if (justifyLine) {
    const marginLeft = Math.max(opts.paragraph?.marginLeft ?? 0, 0);
    const marginRight = Math.max(opts.paragraph?.marginRight ?? 0, 0);
    const availableWidth = Math.max(opts.maxWidth - marginLeft - marginRight - indent, 0);
    const slack = availableWidth - x;
    if (slack > 0) {
      const extra = slack / gapCount;
      segments = rawSegments.map(({ text, x: naturalX, run, spacesBefore: gaps }) => ({
        text,
        x: naturalX + gaps * extra,
        run,
      }));
    }
  }

  if (segments.length === 0) {
    return {
      segments,
      width: 0,
      indent,
      advance: opts.paragraph?.lineAdvance ?? defaultLineAdvance(opts.baseSize),
      ascent: defaultAscent(opts.baseSize),
      paragraphEnd,
    };
  }
  return {
    segments,
    width: x,
    indent,
    advance: opts.paragraph?.lineAdvance ?? defaultLineAdvance(maxSize),
    ascent,
    paragraphEnd,
  };
}

interface Chunk {
  pieces: Piece[];
  width: number;
}

/**
 * Split an over-wide word into chunks. The width limit can vary by chunk so a
 * paragraph’s first-line indent applies only to its first chunk.
 */
function hardSplit(
  token: WordToken,
  maxLineWidth: number | ((chunkIndex: number) => number),
  measure: (text: string, run: number) => number,
  tolerance: number
): Chunk[] {
  const chunks: Chunk[] = [];
  let pieces: Piece[] = [];
  let width = 0;

  const flush = (): void => {
    if (pieces.length > 0) chunks.push({ pieces, width });
    pieces = [];
    width = 0;
  };

  for (const piece of token.pieces) {
    for (const ch of piece.text) {
      const chWidth = measure(ch, piece.run);
      const maxWidth = typeof maxLineWidth === 'function' ? maxLineWidth(chunks.length) : maxLineWidth;
      if (pieces.length > 0 && width + chWidth > maxWidth + tolerance) {
        const lastChar = pieces[pieces.length - 1].text.slice(-1);
        // Prohibited breaks let the line stretch (line-breaker.ts).
        if (NO_BREAK_BEFORE.has(ch) || NO_BREAK_AFTER.has(lastChar)) {
          appendCharTo(pieces, ch, piece.run);
          width += chWidth;
          continue;
        }
        flush();
      }
      appendCharTo(pieces, ch, piece.run);
      width += chWidth;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [{ pieces: token.pieces, width: token.width }];
}

function appendCharTo(bucket: Piece[], ch: string, run: number): void {
  const last = bucket[bucket.length - 1];
  if (last && last.run === run) last.text += ch;
  else bucket.push({ text: ch, run });
}
