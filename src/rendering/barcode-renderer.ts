
import { PDFPage, rgb } from 'pdf-lib';
import { pushGraphicsState, popGraphicsState } from 'pdf-lib';
import {
  encodePdf417,
  modulesPerRow,
  PDF417_DEFAULT_EC_LEVEL,
  rowToModules,
} from './pdf417';

export type BarType =
  | 'narrow-bar'
  | 'wide-bar'
  | 'narrow-space'
  | 'wide-space'
  |  'tall-bar'
  |  'short-bar'
  | 'module-row';

export interface Bar {
  type: BarType;
  rowPattern?: string;
  rowWidth?: number;
}

export interface BarSpec {
  bars: Bar[];
  narrowWidth: number;
  wideWidth: number;
}

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

function encodeCode39(data: string): Bar[] {
  const bars: Bar[] = [];
  const chars = `*${data.toUpperCase()}*`;
  for (let ci = 0; ci < chars.length; ci++) {
    const pattern = CODE39_CHARS[chars[ci]] ?? CODE39_CHARS['*'];
    if (!pattern) continue;
    for (let i = 0; i < pattern.length; i++) {
      const wide = pattern[i] === 'W';
      const isBar = i % 2 === 0;
      if (isBar) bars.push({ type: wide ? 'wide-bar' : 'narrow-bar' });
      else bars.push({ type: wide ? 'wide-space' : 'narrow-space' });
    }
    if (ci < chars.length - 1) bars.push({ type: 'narrow-space' });
  }
  return bars;
}

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
const CODE128_START_A = 103;
const CODE128_START_B = 104;
const CODE128_START_C = 105;
const CODE128_STOP = [2, 3, 3, 1, 1, 1, 2];

const CODE128_START_WIDTHS: Record<'A' | 'B' | 'C', number[]> = {
  A: [2, 1, 1, 4, 1, 2],
  B: [2, 1, 1, 2, 1, 4],
  C: [2, 1, 1, 2, 3, 2],
};

function emitRuns(bars: Bar[], widths: number[]): void {
  for (let i = 0; i < widths.length; i++) {
    for (let j = 0; j < widths[i]; j++) {
      bars.push({ type: i % 2 === 0 ? 'narrow-bar' : 'narrow-space' });
    }
  }
}

function emitCode128(
  subset: 'A' | 'B' | 'C',
  symbolValues: number[],
): Bar[] {
  const bars: Bar[] = [];
  const startValue = subset === 'A' ? CODE128_START_A : subset === 'B' ? CODE128_START_B : CODE128_START_C;
  emitRuns(bars, CODE128_START_WIDTHS[subset]);

  let checksum = startValue;
  symbolValues.forEach((value, index) => {
    checksum += (index + 1) * value;
    emitRuns(bars, CODE128B_TABLE[value] ?? CODE128B_TABLE[0]);
  });

  emitRuns(bars, CODE128B_TABLE[checksum % 103] ?? CODE128B_TABLE[0]);
  emitRuns(bars, CODE128_STOP);
  return bars;
}

function encodeCode128B(data: string): Bar[] {
  const symbols: number[] = [];
  for (const ch of data) {
    const code = ch.charCodeAt(0);
    symbols.push(code >= 32 && code <= 127 ? code - 32 : '?'.charCodeAt(0) - 32);
  }
  return emitCode128('B', symbols);
}

function encodeCode128A(data: string): Bar[] {
  const codes = [...data].map((ch) => ch.charCodeAt(0));
  if (codes.some((c) => c > 95)) return encodeCode128B(data);
  return emitCode128('A', codes);
}

function encodeCode128C(data: string): Bar[] {
  const digits = data.replace(/\D/g, '');
  if (digits.length < 2 || digits.length % 2 !== 0) return encodeCode128B(digits || data);
  const symbols: number[] = [];
  for (let i = 0; i < digits.length; i += 2) symbols.push(parseInt(digits.slice(i, i + 2), 10));
  return emitCode128('C', symbols);
}

function encodeCode128Sscc(data: string): Bar[] {
  const digits = data.replace(/\D/g, '').padStart(18, '0').slice(-18);
  return encodeCode128C(digits);
}

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

  addBitPattern('101');
  for (let i = 1; i <= 6; i++) {
    const d = parseInt(full[i]);
    const table = parity[i - 1] === 'G' ? EAN_G : EAN_L;
    addBitPattern(table[d][0]);
  }
  addBitPattern('01010');
  for (let i = 7; i <= 12; i++) {
    const d = parseInt(full[i]);
    addBitPattern(EAN_R[d][0]);
  }
  addBitPattern('101');
  return bars;
}

function encodeEan8(data: string): Bar[] {
  const digits = data.replace(/\D/g, '').padStart(7, '0').slice(0, 7);
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += parseInt(digits[i]) * (i % 2 === 0 ? 3 : 1);
  const full = digits + ((10 - (sum % 10)) % 10);

  const bars: Bar[] = [];
  const addBitPattern = (pattern: string): void => {
    for (const bit of pattern) bars.push({ type: bit === '1' ? 'narrow-bar' : 'narrow-space' });
  };
  addBitPattern('101');
  for (let i = 0; i < 4; i++) addBitPattern(EAN_L[parseInt(full[i])][0]);
  addBitPattern('01010');
  for (let i = 4; i < 8; i++) addBitPattern(EAN_R[parseInt(full[i])][0]);
  addBitPattern('101');
  return bars;
}

function encodeUpcA(data: string): Bar[] {
  const digits = data.replace(/\D/g, '').padStart(11, '0').slice(0, 11);
  return encodeEan13(`0${digits}`);
}

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
    if (ci > 0) bars.push({ type: 'narrow-space' });
    for (let i = 0; i < pattern.length; i++) {
      const wide = pattern[i] === '1';
      bars.push({ type: i % 2 === 0 ? (wide ? 'wide-bar' : 'narrow-bar') : (wide ? 'wide-space' : 'narrow-space') });
    }
  }
  return bars;
}

const I2OF5_DIGITS: string[] = [
  'NNWWN','WNNNW','NWNNW','WWNNN','NNWNW','WNWNN','NWWNN','NNNWW','WNNWN','NWNWN',
];

type TwoOfFiveVariant = 'industrial' | 'interleaved' | 'matrix';

function encode2of5(data: string, variant: TwoOfFiveVariant = 'industrial'): Bar[] {
  const digits = data.replace(/\D/g, '');
  const bars: Bar[] = [];

  if (variant === 'interleaved') {
    bars.push({ type: 'narrow-bar' }, { type: 'narrow-space' },
              { type: 'narrow-bar' }, { type: 'narrow-space' });
    const padded = digits.length % 2 === 1 ? `0${digits}` : digits;
    for (let i = 0; i < padded.length; i += 2) {
      const a = I2OF5_DIGITS[parseInt(padded[i])];
      const b = I2OF5_DIGITS[parseInt(padded[i + 1])];
      for (let j = 0; j < 5; j++) {
        bars.push({ type: a[j] === 'W' ? 'wide-bar' : 'narrow-bar' });
        bars.push({ type: b[j] === 'W' ? 'wide-space' : 'narrow-space' });
      }
    }
    bars.push({ type: 'wide-bar' }, { type: 'narrow-space' },
              { type: 'wide-bar' }, { type: 'narrow-space' }, { type: 'narrow-bar' });
    return bars;
  }

  if (variant === 'matrix') {
    bars.push({ type: 'narrow-bar' }, { type: 'narrow-space' });
    for (const d of digits) {
      const pattern = I2OF5_DIGITS[parseInt(d)];
      for (let i = 0; i < pattern.length; i++) {
        const wide = pattern[i] === 'W';
        const isBar = i % 2 === 0;
        bars.push({ type: wide ? (isBar ? 'wide-bar' : 'wide-space') : (isBar ? 'narrow-bar' : 'narrow-space') });
      }
      bars.push({ type: 'narrow-space' });
    }
    bars.push({ type: 'narrow-bar' }, { type: 'narrow-space' }, { type: 'narrow-bar' });
    return bars;
  }

  bars.push({ type: 'narrow-bar' }, { type: 'narrow-space' },
            { type: 'narrow-bar' }, { type: 'narrow-space' });
  for (const d of digits) {
    const pattern = I2OF5_DIGITS[parseInt(d)];
    for (let i = 0; i < pattern.length; i++) {
      bars.push({ type: pattern[i] === 'W' ? 'wide-bar' : 'narrow-bar' });
      if (i < pattern.length - 1) bars.push({ type: 'narrow-space' });
    }
    bars.push({ type: 'narrow-space' });
  }
  bars.push({ type: 'wide-bar' }, { type: 'narrow-space' }, { type: 'narrow-bar' });
  return bars;
}

const CODE93_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

const CODE93_PATTERNS: number[][] = [
  [1,3,1,1,1,2],[1,1,1,2,1,3],[1,1,1,3,1,2],[1,1,1,4,1,1],
  [1,2,1,1,1,3],[1,2,1,2,1,2],[1,2,1,3,1,1],[1,1,1,1,1,4],
  [1,3,1,2,1,1],[1,4,1,1,1,1],[2,1,1,1,1,3],[2,1,1,2,1,2],
  [2,1,1,3,1,1],[2,2,1,1,1,2],[2,2,1,2,1,1],[2,3,1,1,1,1],
  [1,1,2,1,1,3],[1,1,2,2,1,2],[1,1,2,3,1,1],[1,2,2,1,1,2],
  [1,3,2,1,1,1],[1,1,1,1,2,3],[1,1,1,2,2,2],[1,1,1,3,2,1],
  [1,2,1,1,2,2],[1,3,1,1,2,1],[2,1,2,1,1,2],[2,1,2,2,1,1],
  [2,1,1,1,2,2],[2,1,1,2,2,1],[2,2,1,1,2,1],[2,2,2,1,1,1],
  [1,1,2,1,2,2],[1,1,2,2,2,1],[1,2,2,1,2,1],[1,2,3,1,1,1],
  [1,2,1,1,3,1],[3,1,1,1,1,2],[3,1,1,2,1,1],[3,2,1,1,1,1],
  [1,1,2,1,3,1],[2,1,1,1,1,3],[1,1,1,2,3,1],[1,2,1,1,1,4],
  [1,2,1,2,2,1],[3,1,2,1,1,1],[3,1,1,1,2,1],[1,2,2,2,1,1],
];

const CODE93_START_STOP_VALUE = 47;

function code93CheckValues(values: number[]): number[] {
  const weighted = (list: number[], maxWeight: number): number => {
    let sum = 0;
    let weight = 1;
    for (let i = list.length - 1; i >= 0; i--) {
      sum += list[i] * weight;
      weight = weight === maxWeight ? 1 : weight + 1;
    }
    return sum % 47;
  };
  const c = weighted(values, 20);
  const k = weighted([...values, c], 15);
  return [c, k];
}

function encodeCode93(data: string): Bar[] {
  const bars: Bar[] = [];
  const emit = (value: number): void => emitRuns(bars, CODE93_PATTERNS[value]);

  const values: number[] = [];
  for (const ch of data.toUpperCase()) {
    const value = CODE93_ALPHABET.indexOf(ch);
    if (value >= 0) values.push(value);
  }
  emit(CODE93_START_STOP_VALUE);
  for (const v of values) emit(v);
  for (const check of code93CheckValues(values)) emit(check);
  emit(CODE93_START_STOP_VALUE);
  bars.push({ type: 'narrow-bar' });
  return bars;
}

const UPCE_PARITY = [
  'EEEOOO','EEOEOO','EEOOEO','EEOOOE','EOEEOO','EOOEEO','EOOOEE','EOEOEO','EOEOOE','EOOEOE',
];

function expandUpcE(numberSystem: string, body: string): string {
  const d = body.padStart(6, '0').slice(-6);
  const [d1, d2, d3, d4, d5, d6] = d;
  switch (d6) {
    case '0':
    case '1':
    case '2':
      return `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
    case '3':
      return `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}`;
    case '4':
      return `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}`;
    default:
      return `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
}

function encodeUpcE(data: string): Bar[] {
  const digits = data.replace(/\D/g, '');
  const numberSystem = digits.length >= 7 ? digits[0] : '0';
  const body = digits.length >= 7 ? digits.slice(1, 7) : digits.padStart(6, '0').slice(-6);

  const upcA = expandUpcE(numberSystem, body);
  let sum = 0;
  for (let i = 0; i < upcA.length; i++) sum += Number(upcA[i]) * (i % 2 === 0 ? 3 : 1);
  const check = (10 - (sum % 10)) % 10;

  let parity = UPCE_PARITY[check];
  if (numberSystem === '1') parity = parity.replace(/[EO]/g, (c) => (c === 'E' ? 'O' : 'E'));

  const bars: Bar[] = [];
  const addBits = (p: string): void => {
    for (const b of p) bars.push({ type: b === '1' ? 'narrow-bar' : 'narrow-space' });
  };
  addBits('101');
  for (let i = 0; i < 6; i++) {
    const digit = Number(body[i]);
    addBits(parity[i] === 'E' ? EAN_G[digit][0] : EAN_L[digit][0]);
  }
  addBits('010101');
  return bars;
}

const MSI_DIGITS: Record<string, string> = {
  '0': '100100100100', '1': '100100100110', '2': '100100110100', '3': '100100110110',
  '4': '100110100100', '5': '100110100110', '6': '100110110100', '7': '100110110110',
  '8': '110100100100', '9': '110100100110',
};

function msiCheckDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    const value = Number(digits[i]) * (double ? 2 : 1);
    sum += Math.floor(value / 10) + (value % 10);
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

function encodeMsi(data: string): Bar[] {
  const digits = data.replace(/\D/g, '');
  const full = digits + msiCheckDigit(digits);
  const bars: Bar[] = [];
  const addBits = (bits: string): void => {
    for (const b of bits) bars.push({ type: b === '1' ? 'narrow-bar' : 'narrow-space' });
  };
  addBits('110');
  for (const d of full) addBits(MSI_DIGITS[d] ?? MSI_DIGITS['0']);
  addBits('1001');
  return bars;
}

const POSTNET_TALL: Record<string, string> = {
  '0': '11000', '1': '00011', '2': '00101', '3': '00110', '4': '01001',
  '5': '01010', '6': '01100', '7': '10001', '8': '10010', '9': '10100',
};

function checkDigit(digits: string): number {
  const sum = [...digits].reduce((n, c) => n + Number(c), 0);
  return (10 - (sum % 10)) % 10;
}

function barsForDigit(digit: string, planet: boolean): Bar[] {
  const pattern = POSTNET_TALL[digit] ?? POSTNET_TALL['0'];
  const bars: Bar[] = [];
  for (const bit of pattern) {
    const tall = planet ? bit === '0' : bit === '1';
    bars.push({ type: tall ? 'tall-bar' : 'short-bar' });
    bars.push({ type: 'narrow-space' });
  }
  return bars;
}

function encodeUsps(data: string, planet: boolean): Bar[] {
  const digits = data.replace(/\D/g, '');
  const payload = digits.length ? digits : '0';
  const full = payload + String(checkDigit(payload));
  const bars: Bar[] = [{ type: 'tall-bar' }, { type: 'narrow-space' }];
  for (const digit of full) bars.push(...barsForDigit(digit, planet));
  bars.push({ type: 'tall-bar' });
  return bars;
}

function encodePostnet(data: string): Bar[] {
  return encodeUsps(data, false);
}

function encodePlanet(data: string): Bar[] {
  return encodeUsps(data, true);
}

export function normalizeSymbology(symbology: string): string {
  const s = (symbology || '').toLowerCase().replace(/[\s_-]/g, '');
  if (s === '' ) return 'code39';
  if (s.includes('code3of9') || s === 'code39' || s.includes('code39limited') || s === 'logmars') return 'code39';
  if (s.includes('code93')) return 'code93';
  if (s.includes('code11')) return 'code11';
  if (s.includes('code128sscc') || s === 'ucc128sscc') return 'code128sscc';
  if (s.includes('code128a')) return 'code128a';
  if (s.includes('code128c')) return 'code128c';
  if (s.includes('code128b') || s === 'code128' || s.includes('ucc128')) return 'code128b';
  if (s.includes('ean13')) return 'ean13';
  if (s.includes('ean8')) return 'ean8';
  if (s.includes('upca')) return 'upca';
  if (s.includes('upce')) return 'upce';
  if (s.includes('codabar')) return 'codabar';
  if (s.includes('2of5interleaved') || s === '2of5i') return '2of5interleaved';
  if (s.includes('postus5zip') || s === 'postnet5') return 'postus5zip';
  if (s.includes('postusdpbc')) return 'postusdpbc';
  if (s.includes('postusstandard') || s.includes('postus')) return 'postusstandard';
  if (s.includes('planet')) return 'planet';
  if (s.includes('2of5matrix')) return '2of5matrix';
  if (s.includes('2of5standard')) return '2of5standard';
  if (s.includes('2of5industrial')) return '2of5industrial';
  if (s.includes('msi') || s.includes('plessey')) return 'msi';
  if (s.includes('code49')) return 'code49';
  if (s.includes('pdf417')) return 'pdf417';
  if (s.includes('qrcode') || s === 'codeqr') return 'qrcode';
  if (s.includes('datamatrix')) return 'datamatrix';
  if (s.includes('aztec')) return 'aztec';
  return 'code39';
}

export const SUPPORTED_SYMBOLOGIES = [
  'code39', 'code93', 'msi',
  'code128a', 'code128b', 'code128c', 'code128sscc',
  'ean13', 'ean8', 'upca', 'upce', 'codabar',
  '2of5interleaved', '2of5matrix', '2of5industrial', '2of5standard',
  'pdf417', 'postus5zip', 'postusstandard', 'postusdpbc', 'planet',
] as const;

export const PENDING_SYMBOLOGIES = [
  'code11', 'logmars', 'code49',
  'qrcode', 'datamatrix', 'aztec',
  'postAUSStandard', 'postAUSCust2', 'postAUSCust3', 'postAUSReplyPaid',
  'postUSImb', 'postUKRM4SCC', 'postJapan',
] as const;

function encodePdf417ToBars(data: string, options: EncodeBarsOptions): Bar[] {
  const symbol = encodePdf417(data, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? PDF417_DEFAULT_EC_LEVEL,
    columns: options.columns,
    rows: options.rows,
    aspectRatio: options.aspectRatio,
  });
  return symbol.rowPatterns.map((rowPattern) => ({
    type: 'module-row' as const,
    rowPattern,
    rowWidth: modulesPerRow(symbol.columns),
  }));
}

interface EncodeBarsOptions {
  errorCorrectionLevel?: number;
  columns?: number;
  rows?: number;
  aspectRatio?: number;
}

function encodeBars(symbology: string, data: string, options: EncodeBarsOptions = {}): Bar[] {
  switch (normalizeSymbology(symbology)) {
    case 'ean13': return encodeEan13(data);
    case 'ean8': return encodeEan8(data);
    case 'upca': return encodeUpcA(data);
    case 'codabar': return encodeCodabar(data);
    case '2of5interleaved': return encode2of5(data, 'interleaved');
    case '2of5industrial': return encode2of5(data, 'industrial');
    case '2of5matrix': return encode2of5(data, 'matrix');
    case 'code128a': return encodeCode128A(data);
    case 'code128b': return encodeCode128B(data);
    case 'code128c': return encodeCode128C(data);
    case 'code128sscc': return encodeCode128Sscc(data);
    case 'code93': return encodeCode93(data);
    case 'msi': return encodeMsi(data);
    case 'upce': return encodeUpcE(data);
    case '2of5standard': return encode2of5(data, 'industrial');
    case 'pdf417': return encodePdf417ToBars(data, options);
    case 'postus5zip':
    case 'postusstandard':
    case 'postusdpbc':
      return encodePostnet(data);
    case 'planet': return encodePlanet(data);
    default: return encodeCode39(data);
}
}

export function encodeBarcode(
  symbology: string,
  data: string,
  options: EncodeBarsOptions = {},
): Bar[] {
  return encodeBars(symbology, data, options);
}

export interface RenderBarcodeOptions {
  errorCorrectionLevel?: number;
  columns?: number;
  rows?: number;
  aspectRatio?: number;
}

export function renderBarcode(
  pdfPage: PDFPage,
  symbology: string,
  data: string,
  x: number,
  y: number,
  w: number,
  h: number,
  moduleW = 2,
  align: 'left' | 'center' | 'right' = 'center',
  wideNarrowRatio = 2.5,
  options: RenderBarcodeOptions = {},
): void {
  if (!data || w <= 0 || h <= 0) return;

  const bars = encodeBars(symbology, data, { ...options, aspectRatio: w / h });
  if (bars.length === 0) return;
  if (bars[0]?.type === 'module-row') {
    renderBarcode2D(pdfPage, bars, x, y, w, h);
    return;
  }

  const narrowW = moduleW;
  const wideW = moduleW * wideNarrowRatio;

  let totalW = 0;
  for (const bar of bars) {
    totalW += (bar.type === 'wide-bar' || bar.type === 'wide-space') ? wideW : narrowW;
  }

  const scale = totalW > w ? w / totalW : 1;
  const nW = narrowW * scale;
  const wW = wideW * scale;

  const drawnW = totalW * scale;
  const startX =
    align === 'center' ? x + Math.max((w - drawnW) / 2, 0)
    : align === 'right' ? x + Math.max(w - drawnW, 0)
    : x;

  pdfPage.pushOperators(pushGraphicsState());

  let curX = startX;
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
    } else if (bar.type === 'tall-bar' || bar.type === 'short-bar') {
      pdfPage.drawRectangle({
        x: curX,
        y,
        width: barW,
        height: bar.type === 'tall-bar' ? h : h * 0.4,
        color: rgb(0, 0, 0),
        borderWidth: 0,
      });
    }
    curX += barW;
  }

  pdfPage.pushOperators(popGraphicsState());
}

function renderBarcode2D(
  pdfPage: PDFPage,
  bars: Bar[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const rows = bars.length;
  if (rows === 0) return;
  const rowHeight = h / rows;

  pdfPage.pushOperators(pushGraphicsState());

  bars.forEach((bar, rowIndex) => {
    const pattern = bar.rowPattern ?? '';
    const modules = rowToModulesLocal(pattern, bar.rowWidth ?? 0);
    if (modules.length === 0) return;
    const moduleW = w / modules.length;
    const rowY = y + h - (rowIndex + 1) * rowHeight;
    let i = 0;
    while (i < modules.length) {
      if (!modules[i]) {
        i++;
        continue;
      }
      let run = 1;
      while (i + run < modules.length && modules[i + run]) run++;
      pdfPage.drawRectangle({
        x: x + i * moduleW,
        y: rowY,
        width: run * moduleW,
        height: rowHeight,
        color: rgb(0, 0, 0),
        borderWidth: 0,
      });
      i += run;
    }
  });

  pdfPage.pushOperators(popGraphicsState());
}

function rowToModulesLocal(pattern: string, width: number): boolean[] {
  return rowToModules(pattern, width);
}

