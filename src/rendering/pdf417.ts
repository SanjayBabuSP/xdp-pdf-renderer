import pdf417Tables from '../config/pdf417-tables.json';

/**
 * PDF417 encoder (G15a).
 *
 * Built on Adobe's own constant tables, dumped from the shipped
 * `pdf417pmp.dll` (`reference/Adobe-LiveCycle-Designer-11.0/barcode_data/`)
 * using the exact addresses referenced in `reference/decompiled/pdf417pmp_disasm.c`:
 *
 *   cluster 0/3/6 pattern tables : `s_31111136_12b13088` / `s_51111125_12b15138`
 *                                  / `s_21111155_12b171e8`  (929 × 9-byte strings,
 *                                  stride 9 per the decompile's `+ iVar3 * 9`)
 *   Reed-Solomon coefficients    : switch in FUN_12b0bc30 (12b0f668 / 12b0f670 /
 *                                  12b0f680 / 12b0f6a0 / 12b0f6e0 / 12b0f760 /
 *                                  12b0f860 / 12b0fa60 / 12b0fe60), lengths 2..512
 *
 * The algorithm layer follows the decompile:
 *   • `FUN_12b0ba90`  — Reed-Solomon remainder over GF(929) (`% 0x3a1`)
 *   • `FUN_12b0bd80`  — EC level → codeword count (2,4,8,…,512)
 *   • `FUN_12b0ac60`  — pad with 900 then write the symbol-length descriptor
 *                       at codeword 0 (total data codewords, rows*cols - EC)
 *   • `FUN_12b0cc50` / `FUN_12b0cce0` — left/right row-indicator codewords
 *                       (×30 cluster math, identical to ISO 15438)
 *   • `FUN_12b09b30`  — dimensioning limits: cols ≤ 30, rows ≤ 90, rows ≥ 3,
 *                       capacity rows*cols ≤ 928; width = cols*17 + 73 modules
 *   • row painting    — start `81111113`, stop `711311121` + 1-module terminator
 *
 * Defaults come from Adobe's `BarcodeData.xml` pdf417 preset: ECC 5,
 * height/width ratio 2, moduleWidth 0.338mm.
 */

const MOD = 929; // GF(929) — the decompile's `% 0x3a1`

const START_PATTERN = '81111113'; // 17 modules (FUN_12b0c9c0:11917)
const STOP_PATTERN = '711311121'; // 18 modules (FUN_12b0c9c0:12074)
const TERMINATOR = '1'; // 1 module (DAT_12b0f498)

/** Mode / latch codewords (ISO 15438; the decompile uses the same values). */
const LATCH_BYTE = 901;
const LATCH_NUMERIC = 902;
const SHIFT_BYTE = 913;
const PAD = 900;
const PSEUDO = 29; // text-compaction pad value

const TEXT_ALPHA = 0;
const TEXT_LOWER = 1;
const TEXT_MIXED = 2;
const TEXT_PUNCT = 3;

/** Submode latches: Mixed→Alpha uses 28, everything else per ISO Table 2. */
const LATCH_TO_ALPHA = 28;
const LATCH_TO_LOWER = 25;
const LATCH_TO_MIXED = 26;
const LATCH_TO_PUNCT = 29;

/** ISO 15438 text submode character sets (values 0-29 per submode). */
const TEXT_ALPHA_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const TEXT_LOWER_CHARS = 'abcdefghijklmnopqrstuvwxyz ';
const TEXT_MIXED_CHARS =
  '0123456789&\r#()*+,-./:;?@[\\_`~' + "'";
const TEXT_PUNCT_CHARS =
  ";<>=@[\\^_`~!\r\t,:#-.$/\"|*()?{}" + "'";

/** Adobe default EC level — `BarcodeData.xml` pdf417 preset (`documentscanner`). */
export const PDF417_DEFAULT_EC_LEVEL = 5;

/** Adobe hard limits from FUN_12b09b30 / FUN_12b09ef0. */
export const MAX_COLUMNS = 30;
export const MAX_ROWS = 90;
export const MAX_CAPACITY = 928;

export interface Pdf417EncodeOptions {
  /** EC level 0-8 (Adobe default 5). */
  errorCorrectionLevel?: number;
  /** Force a column count (1-30). Otherwise auto-dimensioned. */
  columns?: number;
  /** Force a row count (3-90). Requires `columns` too. */
  rows?: number;
  /** Target width/height of the render box, driving the aspect-driven
   *  dimension search (FUN_12b09b30). */
  aspectRatio?: number;
}

export interface Pdf417Symbol {
  /** One run-length pattern string per row (dark/light alternating, sum 17 modules for codewords). */
  rowPatterns: string[];
  /** Codewords actually painted, for diagnostics/tests. */
  codewords: number[];
  columns: number;
  rows: number;
  ecLevel: number;
}

// ─── Text compaction (ISO submode tables) ────────────────────────────────

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

/** True when the character cannot be expressed in any text submode. */
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
    // Pick the submode that holds the character; latch to it.
    const target =
      submodeIndexOf(TEXT_ALPHA, ch) >= 0 ? TEXT_ALPHA
      : submodeIndexOf(TEXT_LOWER, ch) >= 0 ? TEXT_LOWER
      : submodeIndexOf(TEXT_MIXED, ch) >= 0 ? TEXT_MIXED
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

// ─── Byte compaction ─────────────────────────────────────────────────────

function encodeBytes(bytes: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const remaining = bytes.length - i;
    if (remaining >= 6) {
      // 6 bytes → 5 base-900 codewords.
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
      // Trailing 1-5 bytes: 913 shift per byte (ISO 5.3.3.2).
      for (let k = 0; k < remaining; k++) {
        out.push(SHIFT_BYTE, bytes[i + k]);
      }
      i = bytes.length;
    }
  }
  return out;
}

// ─── Numeric compaction ──────────────────────────────────────────────────

function encodeNumeric(digits: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 44) {
    const chunk = digits.slice(i, i + 44);
    // Prefix '1' so leading zeros survive the base-900 conversion (ISO 5.3.4.2).
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

// ─── Top-level compaction ────────────────────────────────────────────────

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
  // Default: text compaction. The mode after the length descriptor is
  // Alpha submode, so no leading latch is needed (Adobe's pad function
  // overwrites codeword 0 with the descriptor).
  return encodeText(data);
}

/** Heuristic: binary payloads (control chars / extended ASCII) prefer byte mode. */
function isBinaryOnlyHeavy(data: string, bytes: number[]): boolean {
  let binary = 0;
  for (const b of bytes) if (b > 126 || (b < 32 && b !== 13 && b !== 9)) binary++;
  return binary * 3 > data.length;
}

// ─── Reed-Solomon over GF(929) ───────────────────────────────────────────

/** EC codewords per level — FUN_12b0bd80 (2,4,8,…,512). */
export function ecCountForLevel(level: number): number {
  const count = 1 << (level + 1);
  if (count > 512) throw new Error(`PDF417 EC level ${level} out of range (0-8)`);
  return count;
}

function rsGenerator(level: number): number[] {
  const coefficients = (pdf417Tables.rs as Record<string, number[]>)[String(level)];
  if (!coefficients) throw new Error(`PDF417 EC level ${level} has no Adobe coefficients`);
  return coefficients;
}

/**
 * Parity codewords — the decompile's FUN_12b0ba90: polynomial remainder over
 * GF(929) using Adobe's dumped generator coefficients.
 */
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

  // Complement per the decompile's final loop (9865-9873).
  return remainder.map((r) => (MOD - r) % MOD);
}

// ─── Dimensioning ────────────────────────────────────────────────────────

function chooseDimensions(
  messageCount: number,
  options: Pdf417EncodeOptions,
  ecLevel: number,
): { columns: number; rows: number } {
  const ecCount = ecCountForLevel(ecLevel);
  // +1 descriptor; the symbol must hold message + descriptor + EC codewords.
  const needed = messageCount + 1 + ecCount;

  if (options.columns && options.rows) {
    const { columns, rows } = options;
    if (columns < 1 || columns > MAX_COLUMNS) throw new Error('PDF417 columns out of range (1-30)');
    if (rows < 3 || rows > MAX_ROWS) throw new Error('PDF417 rows out of range (3-90)');
    if (columns * rows > MAX_CAPACITY) throw new Error('PDF417 symbol exceeds ISO capacity');
    if (columns * rows < needed) throw new Error('PDF417 symbol too small for message');
    return { columns, rows };
  }

  // FUN_12b09b30: aspect-driven search. Adobe picks the row/column split whose
  // symbol proportions best match the target area; we mirror that by scoring
  // each legal shape against the render box's aspect ratio (row height defaults
  // to 2× module width per BarcodeData.xml `heightwidthratio=2`).
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

// ─── Row indicators (FUN_12b0cc50 / FUN_12b0cce0) ────────────────────────

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

// ─── Row painting (FUN_12b0c9c0) ─────────────────────────────────────────

function clusterFor(row: number): keyof typeof pdf417Tables.clusters {
  return (['cluster0', 'cluster3', 'cluster6'] as const)[row % 3];
}

function patternFor(row: number, codeword: number): string {
  const table = pdf417Tables.clusters[clusterFor(row)];
  const pattern = table[codeword];
  if (!pattern) throw new Error(`PDF417 codeword ${codeword} has no pattern in cluster ${row % 3}`);
  return pattern;
}

/** Total modules in one row: start + left + cols×codeword + right + stop + terminator. */
export function modulesPerRow(columns: number): number {
  return 17 + 17 + columns * 17 + 17 + 18 + 1;
}

/**
 * Encode `data` into a PDF417 symbol.
 *
 * Returns one run-length pattern string per row: alternating dark/light runs
 * (index 0 is a dark run), exactly `modulesPerRow(columns)` modules per row.
 */
export function encodePdf417(data: string, options: Pdf417EncodeOptions = {}): Pdf417Symbol {
  if (!data) throw new Error('PDF417 message is empty');

  const ecLevel = options.errorCorrectionLevel ?? PDF417_DEFAULT_EC_LEVEL;
  const message = compact(data);
  const ecCount = ecCountForLevel(ecLevel);
  const { columns, rows } = chooseDimensions(message.length, options, ecLevel);

  const capacity = columns * rows;
  const dataCount = capacity - ecCount;
  if (message.length > dataCount) throw new Error('PDF417 message does not fit');

  // FUN_12b0ac60: pad with 900, then write the descriptor at codeword 0.
  const codewords = [...message];
  while (codewords.length < dataCount) codewords.push(PAD);
  codewords[0] = dataCount;
  codewords.push(...reedSolomon(codewords, ecLevel));

  // FUN_12b0c9c0: paint one row at a time.
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

/** Paint a run-length pattern row into a boolean module row (true = dark). */
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
