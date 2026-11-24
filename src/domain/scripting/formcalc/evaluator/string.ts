import { numStr, strValue, toNumber } from './shared';
import type { BuiltinFunctionMap } from './shared';

function integerToWords(num: number, useAnd: boolean): string {
  if (num === 0) return 'Zero';
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];
  const convert = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) {
      const rest = n % 10;
      return tens[Math.floor(n / 10)] + (rest ? '-' + ones[rest].toLowerCase() : '');
    }
    if (n < 1000) {
      const rest = n % 100;
      const join = useAnd ? ' and ' : ' ';
      return ones[Math.floor(n / 100)] + ' Hundred' + (rest ? join + convert(rest) : '');
    }
    if (n < 1000000) {
      const rest = n % 1000;
      return convert(Math.floor(n / 1000)) + ' Thousand' + (rest ? ' ' + convert(rest) : '');
    }
    if (n < 1000000000) {
      const rest = n % 1000000;
      return convert(Math.floor(n / 1000000)) + ' Million' + (rest ? ' ' + convert(rest) : '');
    }
    const rest = n % 1000000000;
    return convert(Math.floor(n / 1000000000)) + ' Billion' + (rest ? ' ' + convert(rest) : '');
  };
  return convert(num);
}

function wordNum(n: number, fmt: number): string {
  if (isNaN(n)) return '*'.repeat(8);
  const intPart = Math.trunc(n);
  if (intPart < 0 || intPart > Number.MAX_SAFE_INTEGER) {
    return '*'.repeat(Math.max(1, String(Math.abs(intPart)).length));
  }
  const useAnd = fmt !== 2;
  const base = integerToWords(intPart, useAnd);
  if (fmt === 1) return `${base} Dollars`;
  if (fmt === 2) {
    const cents = Math.round((Math.abs(n) - Math.abs(intPart)) * 100);
    let out = `${base} Dollars`;
    if (cents > 0) out += ` And ${integerToWords(cents, false)} Cents`;
    return out;
  }
  return `${base} Dollars`;
}

export const STRING_FUNCTIONS: BuiltinFunctionMap = {
  'string.left': (args) => {
    const s = strValue(args[0]);
    const n = toNumber(args[1]);
    return s.substring(0, Math.max(0, n));
  },
  'string.right': (args) => {
    const s = strValue(args[0]);
    const n = toNumber(args[1]);
    if (n <= 0) return '';
    return s.substring(s.length - n);
  },
  'string.mid': (args) => {
    const s = strValue(args[0]);
    const start = toNumber(args[1]) - 1;
    const len = args.length > 2 ? toNumber(args[2]) : s.length;
    return s.substring(Math.max(0, start), Math.max(0, start) + Math.max(0, len));
  },
  'string.length': (args) => strValue(args[0]).length,
  'string.lower': (args) => strValue(args[0]).toLowerCase(),
  'string.upper': (args) => strValue(args[0]).toUpperCase(),
  'string.strip': (args) => strValue(args[0]).trim(),
  'string.leftback': (args) => {
    const s = strValue(args[0]);
    const n = toNumber(args[1]);
    return s.substring(0, Math.max(0, s.length - n));
  },
  'string.rightback': (args) => {
    const s = strValue(args[0]);
    const n = toNumber(args[1]);
    return s.substring(Math.min(s.length, Math.max(0, n)));
  },
  'string.wordnum': (args) => wordNum(toNumber(args[0]), args.length > 1 ? toNumber(args[1]) : 0),
  'string.apnum': (args) => strValue(args[0]),
  'string.ltrim': (args) => strValue(args[0]).replace(/^\s+/, ''),
  'string.rtrim': (args) => strValue(args[0]).replace(/\s+$/, ''),
  'string.num': (args) => {
    const val = args[0];
    if (typeof val === 'number') return numStr(val);
    return strValue(val);
  },
  'string.at': (args) => {
    const s = strValue(args[0]);
    const substr = strValue(args[1]);
    const pos = s.indexOf(substr);
    return pos === -1 ? 0 : pos + 1;
  },
  'string.nameat': (args) => {
    const s = strValue(args[0]);
    const pos = toNumber(args[1]) - 1;
    return s.charCodeAt(pos) || 0;
  },
  'string.repeat': (args) => {
    const s = strValue(args[0]);
    const n = Math.max(0, Math.trunc(toNumber(args[1])));
    return s.repeat(n);
  },
  'string.pad': (args) => {
    const s = strValue(args[0]);
    const n = toNumber(args[1]);
    const ch = args.length > 2 ? strValue(args[2]) : ' ';
    return s.padStart(n, ch);
  },
  'string.instr': (args) => {
    const haystack = strValue(args[0]);
    const needle = strValue(args[1]);
    const start = args.length > 2 ? Math.max(0, toNumber(args[2]) - 1) : 0;
    const pos = haystack.indexOf(needle, start);
    return pos === -1 ? 0 : pos + 1;
  },

  concat: (args) => args.map((a) => strValue(a)).join(''),
  substr: (args) => {
    const s = strValue(args[0]);
    let start = toNumber(args[1]);
    if (start < 1) start = 1;
    const len = args.length > 2 ? toNumber(args[2]) : s.length;
    if (len <= 0) return '';
    const idx = start - 1;
    return s.substring(idx, Math.min(s.length, idx + len));
  },
  replace: (args) => {
    const s = strValue(args[0]);
    const old = strValue(args[1]);
    const newStr = args.length > 3 || args[2] !== undefined ? strValue(args[2]) : '';
    if (old === '') return s;
    return s.split(old).join(newStr);
  },
  space: (args) => ' '.repeat(Math.max(0, Math.trunc(toNumber(args[0])))),
  str: (args) => {
    const num = toNumber(args[0]);
    const width = args.length > 1 && args[1] != null ? toNumber(args[1]) : 10;
    const precision = args.length > 2 && args[2] != null ? Math.trunc(toNumber(args[2])) : 0;
    const formatted = num.toFixed(Math.max(0, precision));
    if (formatted.length > width) return '*'.repeat(Math.max(0, Math.trunc(width)));
    return formatted;
  },
  stuff: (args) => {
    const source = strValue(args[0]);
    let start = toNumber(args[1]);
    if (start < 1) start = 1;
    if (start > source.length) start = Math.max(1, source.length);
    const count = Math.max(0, toNumber(args[2]));
    const insert = args.length > 3 ? strValue(args[3]) : '';
    const idx = start - 1;
    return source.substring(0, idx) + insert + source.substring(idx + count);
  },
  uuid: (args) => {
    const dashed = args.length && args[0] != null && toNumber(args[0]) === 1;
    const hex = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < 32; i++) {
      if (dashed && (i === 8 || i === 12 || i === 16 || i === 20)) out += '-';
      out += hex[(Math.random() * 16) | 0];
    }
    if (dashed)
      out = out.replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    return out;
  },
  len: (args) => {
    const v = args[0];
    if (Array.isArray(v)) return strValue(v[0] ?? '').length;
    return strValue(v).length;
  },
  left: (args) => {
    const s = strValue(args[0]);
    const n = Math.max(0, toNumber(args[1]));
    return s.substring(0, n);
  },
  right: (args) => {
    const s = strValue(args[0]);
    const n = toNumber(args[1]);
    if (n <= 0) return '';
    return s.substring(s.length - n);
  },
  lower: (args) => strValue(args[0]).toLowerCase(),
  upper: (args) => strValue(args[0]).toUpperCase(),
  ltrim: (args) => strValue(args[0]).replace(/^\s+/, ''),
  rtrim: (args) => strValue(args[0]).replace(/\s+$/, ''),
  at: (args) => {
    const s = strValue(args[0]);
    const sub = strValue(args[1]);
    const pos = s.indexOf(sub);
    return pos === -1 ? 0 : pos + 1;
  },

  wordnum: (args) =>
    wordNum(toNumber(args[0]), args.length > 1 && args[1] != null ? toNumber(args[1]) : 0),
};
