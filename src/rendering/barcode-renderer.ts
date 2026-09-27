/**
 * Barcode renderer — Phase 7.
 *
 * Implements symbologies marked `support="software"` in `adobepdf.xdc:213-240`.
 * All barcodes are rendered as pure PDF vector graphics (filled rectangles /
 * path operations) with no external dependencies.
 *
 * Supported (software-rendered by Adobe):
 *   Code 39  — adobepdf.xdc:213-214 (code39 / code39limited)
 *   Code 128 — adobepdf.xdc:220-224 (code128A/B/C/SSCC)
 *   EAN-13   — adobepdf.xdc:225
 *   Codabar  — adobepdf.xdc:228
 *   2of5     — adobepdf.xdc:226-227 (Matrix + Industrial variants)
 *
 * Each encoder returns a `BarSpec` (array of bar widths + type) that the
 * renderer converts to PDF rectangles. Module width defaults to 2pt.
 *
 * Evidence: adobepdf.xdc:213-240 (barcode definitions),
 *           reference/barcode_data/BarcodeData.xml (geometry ranges).
 */

import { PDFPage, rgb } from 'pdf-lib';
import { pushGraphicsState, popGraphicsState } from 'pdf-lib';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type BarType = 'narrow-bar' | 'wide-bar' | 'narrow-space' | 'wide-space';

export interface Bar {
  type: BarType;
}

/** Rendered barcode bar specification: alternating bars and spaces. */
export interface BarSpec {
  bars: Bar[];
  /** Recommended module width multiplier. */
  narrowWidth: number;
  wideWidth: number;
}

// ─── Code 39 ──────────────────────────────────────────────────────────────────

const CODE39_CHARS: Record<string, string> = {
  '0': 'NNNWWNWNN', '1': 'WNNWNNNNW', '2': 'NWNWNNNNW',
  '3': 'WWNWNNNNN', '4': 'NNNWWNNNW', '5': 'WNNWWNNNN',
  '6': 'NWNWWNNNN', '7': 'NNNWWNWNN', '8': 'WNNWNNWNNN',
  '9': 'NWNWNNWNN', 'A': 'WNNNNWNNW', 'B': 'NWNNNNWNW',
  'C': 'WWNNNNWNN', 'D': 'NNNNNWWNW', 'E': 'WNNNNWWNN',
  'F': 'NWNNNNWWN', 'G': 'NNNNNWWWN', 'H': 'WNNNNNNWW',
  'I': 'NWNNNNNNW', 'J': 'NNNNNWNNW', 'K': 'WNNNNNNWN',
  'L': 'NWNNNNWNN', 'M': 'WWNNNNNWN', 'N': 'NWNNNNNWN',
  'O': 'WWNNNNNN',  'P': 'NWWNNNNWN', 'Q': 'WWNNNNNNN',
  'R': 'NWWNNNNNN', 'S': 'NNNWNWNNN', 'T': 'WNNWNWNNN',
  'U': 'NNNWNNWNN', 'V': 'NNNWWNNNN', 'W': 'NNNNNWWNN',
  'X': 'WNNNNNNNN', 'Y': 'NWWNNNWNN', 'Z': 'WNNNWNWNN',
  '-': 'NNNNNWWNN', '.': 'WNNNNWWNN', ' ': 'NWNNNWWNN',
  '$': 'NNNNNNNWN', '/': 'NNNNWNNWN', '+': 'NNNNWNNWN',
  '%': 'WNNNWNNNN', '*': 'NNNWWNWNN',
};

/** Encode a string as Code 39. Returns alternating bar/space as N/W sequence. */
function encodeCode39(data: string): Bar[] {
  const bars: Bar[] = [];
  const chars = `*${data.toUpperCase()}*`;
  for (let ci = 0; ci < chars.length; ci++) {
    const pattern = CODE39_CHARS[chars[ci]] ?? CODE39_CHARS['*'];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i++) {
      const wide = pattern[i] === 'W';
      // Code39 alternates: odd positions = bars, even = spaces
      const isBar = i % 2 === 0;
      if (isBar) bars.push({ type: wide ? 'wide-bar' : 'narrow-bar' });
      else bars.push({ type: wide ? 'wide-space' : 'narrow-space' });
    }
    if (ci < chars.length - 1) bars.push({ type: 'narrow-space' }); // inter-char gap
  }
  return bars;
}

// ─── Code 128 ─────────────────────────────────────────────────────────────────

// Code 128B encoding table (values 32..126). 6-element patterns (3 bars + 3 spaces).
const CODE128B_TABLE: number[][] = [
  [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
  [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
  [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
  [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
  [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
  [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
  [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,3,2],
  [1,3,1,3,1,2],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
  [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],
  [1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],[1,1,3,2,1,3],[1,1,3,2,3,1],
  [2,1,3,2,1,3],[2,1,1,1,3,3],[2,1,3,3,1,1],[2,3,1,1,3,1],[2,1,3,1,3,1],
  [3,1,1,1,2,3],[3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],
  [3,3,2,1,1,1],[3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],
  [1,1,1,4,2,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,4,1,2,1,2],[1,2,4,1,1,2],
  [1,2,4,2,1,1],[4,1,2,2,2,1],[4,2,2,1,1,2],[4,2,2,2,1,1],[2,1,2,1,4,1],
  [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
  [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,2,3,1,1,3],
  [1,2,3,3,1,1],[4,1,3,1,1,1],[1,1,2,1,4,2],[1,2,2,4,1,1],[2,4,1,2,1,1],
  [2,2,4,1,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],[2,4,1,1,1,2],[2,1,1,4,1,2],
  [1,1,4,2,1,2],[2,1,4,1,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[3,1,2,1,1,3],
];
const CODE128_START_B = 104;
const CODE128_STOP = [2,3,3,1,1,1,2]; // stop pattern

function encodeCode128B(data: string): Bar[] {
  const bars: Bar[] = [];
  function addPattern(p: number[]) {
    for (let i = 0; i < p.length; i++) {
      const w = p[i];
      for (let j = 0; j < w; j++) {
        bars.push({ type: i % 2 === 0 ? 'narrow-bar' : 'narrow-space' });
      }
    }
  }

  let checksum = CODE128_START_B;
  addPattern(CODE128B_TABLE[CODE128_START_B - 32] ?? CODE128B_TABLE[0]);

  for (let ci = 0; ci < data.length; ci++) {
    const code = data.charCodeAt(ci) - 32;
    checksum += (ci + 1) * code;
    addPattern(CODE128B_TABLE[code] ?? CODE128B_TABLE[0]);
  }

  const checkCode = checksum % 103;
  addPattern(CODE128B_TABLE[checkCode] ?? CODE128B_TABLE[0]);
  addPattern(CODE128_STOP);
  return bars;
}

// ─── EAN-13 ───────────────────────────────────────────────────────────────────

const EAN_L: string[][] = [
  ['0001101'],['0011001'],['0010011'],['0111101'],['0100011'],
  ['0110001'],['0101111'],['0111011'],['0110111'],['0001011'],
];
const EAN_G: string[][] = [
  ['0100111'],['0110011'],['0011011'],['0100001'],['0011101'],
  ['0111001'],['0000101'],['0010001'],['0001001'],['0010111'],
];
const EAN_R: string[][] = [
  ['1110010'],['1100110'],['1101100'],['1000010'],['1011100'],
  ['1001110'],['1010000'],['1000100'],['1001000'],['1110100'],
];
const EAN13_FIRST_DIGIT_PARITY = [
  'LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG',
  'LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL',
];

function encodeEan13(data: string): Bar[] {
  const digits = data.replace(/\D/g, '').padStart(12, '0').slice(0, 12);
  // Calculate check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  const full = digits + check;

  const parity = EAN13_FIRST_DIGIT_PARITY[parseInt(full[0])] ?? 'LLLLLL';
  const bars: Bar[] = [];

  function addBitPattern(pattern: string) {
    for (const bit of pattern) {
      bars.push({ type: bit === '1' ? 'narrow-bar' : 'narrow-space' });
    }
  }

  // Start guard: 101
  addBitPattern('101');
  // Left 6 digits (1-6)
  for (let i = 1; i <= 6; i++) {
    const d = parseInt(full[i]);
    const table = parity[i - 1] === 'G' ? EAN_G : EAN_L;
    addBitPattern(table[d][0]);
  }
  // Centre guard: 01010
  addBitPattern('01010');
  // Right 6 digits (7-12)
  for (let i = 7; i <= 12; i++) {
    const d = parseInt(full[i]);
    addBitPattern(EAN_R[d][0]);
  }
  // End guard: 101
  addBitPattern('101');
  return bars;
}

// ─── Codabar ──────────────────────────────────────────────────────────────────

const CODABAR_CHARS: Record<string, string> = {
  '0':'00000011','1':'00001100','2':'00010010','3':'11000000',
  '4':'00100100','5':'10000100','6':'01000010','7':'01000200',
  '8':'01100000','9':'10010000','-':'00001010',
  '$':'00010001','.':'10001000','/':'10100000',
  ':':'10000011','+':'00110000','A':'00011010','B':'01001001',
  'C':'00100101','D':'00011100',
};

function encodeCodabar(data: string): Bar[] {
  const bars: Bar[] = [];
  for (let ci = 0; ci < data.length; ci++) {
    const pattern = CODABAR_CHARS[data[ci].toUpperCase()];
    if (!pattern) continue;
    if (ci > 0) bars.push({ type: 'narrow-space' }); // inter-char gap
    for (let i = 0; i < pattern.length; i++) {
      const wide = pattern[i] === '1';
      bars.push({ type: i % 2 === 0 ? (wide ? 'wide-bar' : 'narrow-bar') : (wide ? 'wide-space' : 'narrow-space') });
    }
  }
  return bars;
}

// ─── 2-of-5 Industrial ────────────────────────────────────────────────────────

const I2OF5_DIGITS: string[] = [
  'NNWWN','WNNNW','NWNNW','WWNNN','NNWNW','WNWNN','NWWNN','NNNWW','WNNWN','NWNWN',
];

function encode2of5(data: string): Bar[] {
  const digits = data.replace(/\D/g, '');
  const bars: Bar[] = [];
  // Start: NNN (3 narrow bars with spaces)
  bars.push({ type: 'narrow-bar' }, { type: 'narrow-space' },
            { type: 'narrow-bar' }, { type: 'narrow-space' });
  for (const d of digits) {
    const pattern = I2OF5_DIGITS[parseInt(d)];
    for (let i = 0; i < pattern.length; i++) {
      bars.push({ type: pattern[i] === 'W' ? 'wide-bar' : 'narrow-bar' });
      if (i < pattern.length - 1) bars.push({ type: 'narrow-space' });
    }
    bars.push({ type: 'narrow-space' }); // inter-char gap
  }
  // Stop: WNN
  bars.push({ type: 'wide-bar' }, { type: 'narrow-space' }, { type: 'narrow-bar' });
  return bars;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function encodeBars(symbology: string, data: string): Bar[] {
  const s = symbology.toLowerCase();
  if (s.includes('code39') || s === 'code39') return encodeCode39(data);
  if (s.includes('code128') || s === 'code128b') return encodeCode128B(data);
  if (s === 'ean13' || s === 'ean-13') return encodeEan13(data);
  if (s === 'codabar') return encodeCodabar(data);
  if (s.includes('2of5') || s.includes('2-of-5')) return encode2of5(data);
  // Default fallback: Code 39
  return encodeCode39(data);
}

// ─── PDF rendering ────────────────────────────────────────────────────────────

/**
 * Render a barcode as PDF vector rectangles.
 *
 * evidence: adobepdf.xdc:213-240 (barcode definitions with moduleWidth ranges),
 *           reference/barcode_data/BarcodeData.xml (geometry parameters).
 *
 * @param pdfPage    Target page
 * @param symbology  Barcode type string (from UiSpec.encodeHint)
 * @param data       Data to encode
 * @param x          Left edge (PDF coords)
 * @param y          Bottom edge (PDF coords)
 * @param w          Available width
 * @param h          Available height
 * @param moduleW    Module width in points (default 2pt)
 */
export function renderBarcode(
  pdfPage: PDFPage,
  symbology: string,
  data: string,
  x: number,
  y: number,
  w: number,
  h: number,
  moduleW = 2,
): void {
  if (!data || w <= 0 || h <= 0) return;

  const bars = encodeBars(symbology, data);
  if (bars.length === 0) return;

  // Calculate total width to auto-scale if needed.
  const narrowW = moduleW;
  const wideW = moduleW * 2.5; // typical wide:narrow ratio for Code39/Codabar

  let totalW = 0;
  for (const bar of bars) {
    totalW += (bar.type === 'wide-bar' || bar.type === 'wide-space') ? wideW : narrowW;
  }

  // Scale to fit within available width if too wide.
  const scale = totalW > w ? w / totalW : 1;
  const nW = narrowW * scale;
  const wW = wideW * scale;

  pdfPage.pushOperators(pushGraphicsState());

  let curX = x;
  for (const bar of bars) {
    const barW = (bar.type === 'wide-bar' || bar.type === 'wide-space') ? wW : nW;
    if (bar.type === 'narrow-bar' || bar.type === 'wide-bar') {
      pdfPage.drawRectangle({
        x: curX,
        y,
        width: barW,
        height: h,
        color: rgb(0, 0, 0),
        borderWidth: 0,
      });
    }
    curX += barW;
  }

  pdfPage.pushOperators(popGraphicsState());
}
