import type { PDFFont } from 'pdf-lib';
import type { RgbColor } from '../../types';
import { defaultAscent, defaultLineAdvance, fontAscent, type VerticalAlign } from './line-metrics';
import {
  BREAK_OPPORTUNITY,
  LINE_BREAK_TOLERANCE,
  NO_BREAK_AFTER,
  NO_BREAK_BEFORE,
} from './line-breaker';
import { JUST_H, type JustHCode } from './justifier';

export interface StyledRun {
  text: string;
  size: number;
  font: PDFFont;
  color?: RgbColor;
  underline?: boolean;
  scale?: number;
  lineAdvance?: number;
  marginTop?: number;
  marginBottom?: number;
  spacerOnly?: boolean;
}

export interface RunSegment {
  text: string;
  x: number;
  run: number;
}

export interface RunParagraphOptions {
  lineAdvance?: number;
  marginLeft?: number;
  marginRight?: number;
  firstLineIndent?: number;
  justify?: JustHCode;
}

export interface RunLine {
  segments: RunSegment[];
  width: number;
  indent: number;
  advance: number;
  ascent: number;
  paragraphEnd: boolean;
}

export interface RunLineOptions {
  maxWidth: number;
  measure: (text: string, run: number) => number;
  baseSize: number;
  tolerance?: number;
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
    while (current.length && current[current.length - 1].kind === 'space') {
      width -= (current.pop() as SpaceToken).width;
    }
    lines.push(buildLine(current, runs, measure, paragraphEnd, opts, startsParagraph));
    current = [];
    width = 0;
    wordCount = 0;
    startsParagraph = paragraphEnd;
  };

  const addWord = (pieces: Piece[], w: number): void => {
    if (wordCount === 0) {
      while (current.length && current[current.length - 1].kind === 'space') {
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
    baselines.push(i === 0 ? blockTop - lines[0].ascent : baselines[i - 1] - lines[i].advance);
  }
  return baselines;
}

export function runBlockHeight(lines: RunLine[]): number {
  return lines.reduce((sum, line) => sum + line.advance, 0);
}

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
      if (ch === ' ') {
        flushSpace();
        appendChar(word, ch, run);
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
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
  const indent = paragraphStart ? Math.max(opts.paragraph?.firstLineIndent ?? 0, 0) : 0;
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

  const justifyLine =
    (justify === JUST_H.justifyAll || (justify === JUST_H.justify && !paragraphEnd)) &&
    gapCount > 0 &&
    rawSegments.length;
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

  const advance = resolveAdvance(
    segments,
    runs,
    opts,
    segments.length ? maxSize : opts.baseSize,
    paragraphStart,
    paragraphEnd
  );
  if (segments.length === 0) {
    return {
      segments,
      width: 0,
      indent,
      advance,
      ascent: defaultAscent(opts.baseSize),
      paragraphEnd,
    };
  }
  return {
    segments,
    width: x,
    indent,
    advance,
    ascent,
    paragraphEnd,
  };
}

function resolveAdvance(
  segments: RunSegment[],
  runs: StyledRun[],
  opts: RunLineOptions,
  fallbackSize: number,
  paragraphStart: boolean,
  paragraphEnd: boolean
): number {
  let authored: number | undefined;
  for (const segment of segments) {
    const value = runs[segment.run].lineAdvance;
    if (value !== undefined) {
      authored = value;
      break;
    }
  }
  const firstRun = segments.length ? runs[segments[0].run] : undefined;
  const top = paragraphStart ? (firstRun?.marginTop ?? 0) : 0;
  const bottom = paragraphEnd ? (firstRun?.marginBottom ?? 0) : 0;
  return (
    (authored ?? opts.paragraph?.lineAdvance ?? defaultLineAdvance(fallbackSize)) + top + bottom
  );
}

interface Chunk {
  pieces: Piece[];
  width: number;
}

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
    if (pieces.length) chunks.push({ pieces, width });
    pieces = [];
    width = 0;
  };

  for (const piece of token.pieces) {
    for (const ch of piece.text) {
      const chWidth = measure(ch, piece.run);
      const maxWidth =
        typeof maxLineWidth === 'function' ? maxLineWidth(chunks.length) : maxLineWidth;
      if (pieces.length && width + chWidth > maxWidth + tolerance) {
        const lastChar = pieces[pieces.length - 1].text.slice(-1);
        if (NO_BREAK_BEFORE.has(ch) || NO_BREAK_AFTER.has(lastChar)) {
          appendCharTo(pieces, ch, piece.run);
          width += chWidth;
          continue;
        }
        const split = splitAtOpportunity(pieces, measure);
        if (split) {
          chunks.push({ pieces: split.head, width: split.headWidth });
          pieces = split.tail;
          width = split.tailWidth;
        } else {
          flush();
        }
      }
      appendCharTo(pieces, ch, piece.run);
      width += chWidth;
    }
  }
  flush();
  return chunks.length ? chunks : [{ pieces: token.pieces, width: token.width }];
}

interface OpportunitySplit {
  head: Piece[];
  tail: Piece[];
  headWidth: number;
  tailWidth: number;
}

function splitAtOpportunity(
  pieces: Piece[],
  measure: (text: string, run: number) => number
): OpportunitySplit | undefined {
  for (let p = pieces.length - 1; p >= 0; p--) {
    const piece = pieces[p];
    for (let c = piece.text.length - 1; c >= 0; c--) {
      const ch = piece.text[c];
      if (!BREAK_OPPORTUNITY.has(ch)) continue;
      if (ch === '/' && piece.text[c + 1] === '/') continue;
      const head: Piece[] = pieces.slice(0, p);
      const headText = piece.text.slice(0, c + 1);
      const tailText = piece.text.slice(c + 1);
      if (headText) head.push({ text: headText, run: piece.run });
      const tail: Piece[] = [];
      if (tailText) tail.push({ text: tailText, run: piece.run });
      for (let q = p + 1; q < pieces.length; q++) tail.push({ ...pieces[q] });
      if (!head.length || !tail.length) continue;
      let headWidth = 0;
      for (const hp of head) headWidth += measure(hp.text, hp.run);
      let tailWidth = 0;
      for (const tp of tail) tailWidth += measure(tp.text, tp.run);
      return { head, tail, headWidth, tailWidth };
    }
  }
  return undefined;
}

function appendCharTo(bucket: Piece[], ch: string, run: number): void {
  const last = bucket[bucket.length - 1];
  if (last && last.run === run) last.text += ch;
  else bucket.push({ text: ch, run });
}
