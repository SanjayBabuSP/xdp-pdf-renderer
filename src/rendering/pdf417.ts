import { createRequire } from 'node:module';

const requireJson = createRequire(__filename);

type Cluster = 'cluster0' | 'cluster3' | 'cluster6';

interface Pdf417Tables {
  rs: Record<string, number[]>;
  clusters: Record<Cluster, string[]>;
}

interface CompactPdf417Tables {
  rs: Record<string, number[]>;
  clusters: Record<Cluster, string>;
}

let tables: Pdf417Tables | undefined;

function decodeCluster(encoded: string): string[] {
  const bytes = Buffer.from(encoded, 'base64');
  const patterns: string[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    patterns.push(`${bytes[i]}${bytes[i + 1]}${bytes[i + 2]}${bytes[i + 3]}`);
  }
  return patterns;
}

export function loadPdf417Tables(): Pdf417Tables {
  if (tables === undefined) {
    const compact = requireJson('../config/pdf417-tables.compact.json') as CompactPdf417Tables;
    tables = {
      rs: compact.rs,
      clusters: {
        cluster0: decodeCluster(compact.clusters.cluster0),
        cluster3: decodeCluster(compact.clusters.cluster3),
        cluster6: decodeCluster(compact.clusters.cluster6),
      },
    };
  }
  return tables;
}

const MOD = 929;

const START_PATTERN = '81111113';
const STOP_PATTERN = '711311121';
const TERMINATOR = '1';

const LATCH_BYTE = 901;
const LATCH_NUMERIC = 902;
const SHIFT_BYTE = 913;
const PAD = 900;
const PSEUDO = 29;

const TEXT_ALPHA = 0;
const TEXT_LOWER = 1;
const TEXT_MIXED = 2;
const TEXT_PUNCT = 3;

const LATCH_TO_ALPHA = 28;
const LATCH_TO_LOWER = 25;
const LATCH_TO_MIXED = 26;
const LATCH_TO_PUNCT = 29;

const TEXT_ALPHA_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const TEXT_LOWER_CHARS = 'abcdefghijklmnopqrstuvwxyz ';
const TEXT_MIXED_CHARS = '0123456789&\r#()*+,-./:;?@[\\_`~' + "'";
const TEXT_PUNCT_CHARS = ';<>=@[\\^_`~!\r\t,:#-.$/"|*()?{}' + "'";

export const PDF417_DEFAULT_EC_LEVEL = 5;

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 90;
export const MAX_CAPACITY = 928;

export interface Pdf417EncodeOptions {
  errorCorrectionLevel?: number;
  columns?: number;
  rows?: number;
  aspectRatio?: number;
}

export interface Pdf417Symbol {
  rowPatterns: string[];
  codewords: number[];
  columns: number;
  rows: number;
  ecLevel: number;
}

function submodeIndexOf(submode: number, ch: string): number {
  switch (submode) {
    case TEXT_ALPHA: {
      const i = TEXT_ALPHA_CHARS.indexOf(ch);
      return i;
    }
    case TEXT_LOWER: {
      return TEXT_LOWER_CHARS.indexOf(ch);
    }
    case TEXT_MIXED: {
      return TEXT_MIXED_CHARS.indexOf(ch);
    }
    default:
      return TEXT_PUNCT_CHARS.indexOf(ch);
  }
}

function isBinaryOnly(ch: string): boolean {
  return (
    submodeIndexOf(TEXT_ALPHA, ch) < 0 &&
    submodeIndexOf(TEXT_LOWER, ch) < 0 &&
    submodeIndexOf(TEXT_MIXED, ch) < 0 &&
    submodeIndexOf(TEXT_PUNCT, ch) < 0
  );
}

function latchFor(from: number, to: number): number | undefined {
  if (from === to) return undefined;
  if (to === TEXT_ALPHA) return LATCH_TO_ALPHA;
  if (to === TEXT_LOWER) return LATCH_TO_LOWER;
  if (to === TEXT_MIXED) return LATCH_TO_MIXED;
  if (to === TEXT_PUNCT) return LATCH_TO_PUNCT;
  return undefined;
}

function encodeText(data: string): number[] {
  const values: number[] = [];
  let submode = TEXT_ALPHA;
  let pair: number[] = [];

  const flushPair = (): void => {
    while (pair.length < 2) pair.push(PSEUDO);
    values.push(pair[0] * 30 + pair[1]);
    pair = [];
  };

  for (const ch of data) {
    if (isBinaryOnly(ch)) {
      flushPair();
      values.push(SHIFT_BYTE, ch.charCodeAt(0) & 0xff);
      continue;
    }
    if (submodeIndexOf(submode, ch) >= 0) {
      pair.push(submodeIndexOf(submode, ch));
      if (pair.length === 2) flushPair();
      continue;
    }
    const target =
      submodeIndexOf(TEXT_ALPHA, ch) >= 0
        ? TEXT_ALPHA
        : submodeIndexOf(TEXT_LOWER, ch) >= 0
          ? TEXT_LOWER
          : submodeIndexOf(TEXT_MIXED, ch) >= 0
            ? TEXT_MIXED
            : TEXT_PUNCT;
    flushPair();
    const latch = latchFor(submode, target);
    if (latch !== undefined) values.push(latch);
    submode = target;
    pair.push(submodeIndexOf(target, ch));
    if (pair.length === 2) flushPair();
  }
  flushPair();
  return values;
}

function encodeBytes(bytes: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const remaining = bytes.length - i;
    if (remaining >= 6) {
      let acc = 0n;
      for (let k = 0; k < 6; k++) acc = (acc << 8n) | BigInt(bytes[i + k]);
      const chunk: number[] = [];
      for (let k = 0; k < 5; k++) {
        chunk.unshift(Number(acc % 900n));
        acc /= 900n;
      }
      out.push(...chunk);
      i += 6;
    } else {
      for (let k = 0; k < remaining; k++) {
        out.push(SHIFT_BYTE, bytes[i + k]);
      }
      i = bytes.length;
    }
  }
  return out;
}

function encodeNumeric(digits: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 44) {
    const chunk = digits.slice(i, i + 44);
    let acc = BigInt(`1${chunk}`);
    const codes: number[] = [];
    while (acc > 0n) {
      codes.unshift(Number(acc % 900n));
      acc /= 900n;
    }
    out.push(...codes);
  }
  return out;
}

function isAllDigits(data: string): boolean {
  return /^\d+$/.test(data);
}

function compact(data: string): number[] {
  const bytes = [...data].map((ch) => ch.charCodeAt(0) & 0xff);
  if (isAllDigits(data) && data.length >= 13) {
    return [LATCH_NUMERIC, ...encodeNumeric(data)];
  }
  if (data.length >= 6 && isBinaryOnlyHeavy(data, bytes)) {
    return [LATCH_BYTE, ...encodeBytes(bytes)];
  }
  return encodeText(data);
}

function isBinaryOnlyHeavy(data: string, bytes: number[]): boolean {
  let binary = 0;
  for (const b of bytes) if (b > 126 || (b < 32 && b !== 13 && b !== 9)) binary++;
  return binary * 3 > data.length;
}

export function ecCountForLevel(level: number): number {
  const count = 1 << (level + 1);
  if (count > 512) throw new Error(`PDF417 EC level ${level} out of range (0-8)`);
  return count;
}

function rsGenerator(level: number): number[] {
  const coefficients = loadPdf417Tables().rs[String(level)];
  if (!coefficients) throw new Error(`PDF417 EC level ${level} has no Adobe coefficients`);
  return coefficients;
}

function reedSolomon(data: number[], level: number): number[] {
  const count = ecCountForLevel(level);
  const coefficients = rsGenerator(level);
  const remainder = new Array<number>(count).fill(0);

  for (const value of data) {
    const temp = (value + remainder[count - 1]) % MOD;
    for (let i = count - 1; i > 0; i--) {
      remainder[i] = (remainder[i - 1] + MOD - ((coefficients[i] * temp) % MOD)) % MOD;
    }
    remainder[0] = (MOD - ((coefficients[0] * temp) % MOD)) % MOD;
  }

  return remainder.map((r) => (MOD - r) % MOD);
}

function chooseDimensions(
  messageCount: number,
  options: Pdf417EncodeOptions,
  ecLevel: number
): { columns: number; rows: number } {
  const ecCount = ecCountForLevel(ecLevel);
  const needed = messageCount + 1 + ecCount;

  if (options.columns && options.rows) {
    const { columns, rows } = options;
    if (columns < 1 || columns > MAX_COLUMNS) throw new Error('PDF417 columns out of range (1-30)');
    if (rows < 3 || rows > MAX_ROWS) throw new Error('PDF417 rows out of range (3-90)');
    if (columns * rows > MAX_CAPACITY) throw new Error('PDF417 symbol exceeds ISO capacity');
    if (columns * rows < needed) throw new Error('PDF417 symbol too small for message');
    return { columns, rows };
  }

  const target = options.aspectRatio ?? 2.5;
  let best: { columns: number; rows: number; score: number } | undefined;
  for (let columns = 1; columns <= MAX_COLUMNS; columns++) {
    const rows = Math.max(3, Math.ceil(needed / columns));
    if (rows > MAX_ROWS) continue;
    if (columns * rows > MAX_CAPACITY) continue;
    const aspect = (columns * 17 + 73) / (rows * 2);
    const score = Math.abs(aspect - target);
    if (!best || score < best.score) best = { columns, rows, score };
  }
  if (!best) throw new Error('PDF417 message too large for maximum symbol size');
  return { columns: best.columns, rows: best.rows };
}

function leftIndicator(row: number, rows: number, columns: number): number {
  const third = Math.floor(row / 3);
  switch (row % 3) {
    case 0:
      return Math.floor((rows - 1) / 3) + third * 30;
    case 1:
      return ((rows - 1) % 3) + (columns + third * 10) * 3;
    default:
      return columns - 1 + third * 30;
  }
}

function rightIndicator(row: number, rows: number, columns: number): number {
  const third = Math.floor(row / 3);
  switch (row % 3) {
    case 0:
      return columns - 1 + third * 30;
    case 1:
      return Math.floor((rows - 1) / 3) + third * 30;
    default:
      return ((rows - 1) % 3) + (columns + third * 10) * 3;
  }
}

function clusterFor(row: number): Cluster {
  return (['cluster0', 'cluster3', 'cluster6'] as const)[row % 3];
}

function patternFor(row: number, codeword: number): string {
  const table = loadPdf417Tables().clusters[clusterFor(row)];
  const pattern = table[codeword];
  if (!pattern) throw new Error(`PDF417 codeword ${codeword} has no pattern in cluster ${row % 3}`);
  return pattern;
}

export function modulesPerRow(columns: number): number {
  return 17 + 17 + columns * 17 + 17 + 18 + 1;
}

export function encodePdf417(data: string, options: Pdf417EncodeOptions = {}): Pdf417Symbol {
  if (!data) throw new Error('PDF417 message is empty');

  const ecLevel = options.errorCorrectionLevel ?? PDF417_DEFAULT_EC_LEVEL;
  const message = compact(data);
  const ecCount = ecCountForLevel(ecLevel);
  const { columns, rows } = chooseDimensions(message.length, options, ecLevel);

  const capacity = columns * rows;
  const dataCount = capacity - ecCount;
  if (message.length > dataCount) throw new Error('PDF417 message does not fit');

  const codewords = [...message];
  while (codewords.length < dataCount) codewords.push(PAD);
  codewords[0] = dataCount;
  codewords.push(...reedSolomon(codewords, ecLevel));

  const rowPatterns: string[] = [];
  let cursor = 0;
  for (let row = 0; row < rows; row++) {
    const parts: string[] = [START_PATTERN, patternFor(row, leftIndicator(row, rows, columns))];
    for (let c = 0; c < columns; c++) {
      parts.push(patternFor(row, codewords[cursor++]));
    }
    parts.push(patternFor(row, rightIndicator(row, rows, columns)), STOP_PATTERN, TERMINATOR);
    rowPatterns.push(parts.join(''));
  }

  return { rowPatterns, codewords, columns, rows, ecLevel };
}

export function rowToModules(pattern: string, width: number): boolean[] {
  const modules = new Array<boolean>(width).fill(false);
  let i = 0;
  let dark = true;
  for (const run of [...pattern].map(Number)) {
    if (dark) modules.fill(true, i, Math.min(i + run, width));
    i += run;
    dark = !dark;
  }
  return modules;
}
