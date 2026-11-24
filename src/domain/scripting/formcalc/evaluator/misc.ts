import { FormCalcError, strValue } from './shared';
import type { BuiltinFunctionMap } from './shared';

const HTML_NAMED_DECODE: Record<string, string> = {
  AElig: 'Æ',
  Aacute: 'Á',
  Acirc: 'Â',
  Agrave: 'À',
  AMP: '&',
  amp: '&',
  apos: "'",
  Aring: 'Å',
  Atilde: 'Ã',
  Auml: 'Ä',
  brvbar: '¦',
  ccedil: 'ç',
  cedil: '¸',
  cent: '¢',
  copy: '©',
  curren: '¤',
  deg: '°',
  divide: '÷',
  eacute: 'é',
  ecirc: 'ê',
  egrave: 'è',
  eth: 'ð',
  euml: 'ë',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  gt: '>',
  iacute: 'í',
  icirc: 'î',
  iexcl: '¡',
  igrave: 'ì',
  iquest: '¿',
  iuml: 'ï',
  laquo: '«',
  lt: '<',
  macr: '¯',
  middot: '·',
  nbsp: '\u00a0',
  not: '¬',
  ntilde: 'ñ',
  ordf: 'ª',
  ordm: 'º',
  para: '¶',
  plusmn: '±',
  pound: '£',
  quot: '"',
  raquo: '»',
  reg: '®',
  sect: '§',
  shy: '\u00ad',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  szlig: 'ß',
  thorn: 'þ',
  times: '×',
  uacute: 'ú',
  ucirc: 'û',
  ugrave: 'ù',
  uml: '¨',
  uuml: 'ü',
  yen: '¥',
  Yacute: 'Ý',
  yuml: 'ÿ',
};

function encodeString(s: string, mode: string): string {
  switch (mode) {
    case 'html': {
      let out = '';
      for (const ch of s) {
        switch (ch) {
          case '&':
            out += '&amp;';
            break;
          case '<':
            out += '&lt;';
            break;
          case '>':
            out += '&gt;';
            break;
          case '"':
            out += '&quot;';
            break;
          case "'":
            out += '&#39;';
            break;
          default: {
            const code = ch.codePointAt(0)!;
            out += code > 127 ? `&#x${code.toString(16)};` : ch;
          }
        }
      }
      return out;
    }
    case 'xml': {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }
    case 'url':
    default:
      return encodeUrl(s);
  }
}

function encodeUrl(s: string): string {
  const safe = /^[A-Za-z0-9!$'()*,\-.]$/;
  const hex = '0123456789abcdef';
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const bytes: number[] = [];
    if (cp <= 0x7f) bytes.push(cp);
    else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp <= 0xffff)
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    for (const b of bytes) {
      const c = String.fromCharCode(b);
      if (b >= 0x20 && b <= 0x7f && safe.test(c)) out += c;
      else out += '%' + hex[b >> 4] + hex[b & 15];
    }
  }
  return out;
}

function decodeString(s: string, mode: string): string {
  switch (mode) {
    case 'html':
    case 'xml': {
      return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
        if (body[0] === '#') {
          const isHex = body[1] === 'x' || body[1] === 'X';
          const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
          if (!isNaN(code)) {
            try {
              return String.fromCodePoint(code);
            } catch {
              return whole;
            }
          }
          return whole;
        }
        const named = HTML_NAMED_DECODE[body] ?? HTML_NAMED_DECODE[body.toLowerCase()];
        return named ?? whole;
      });
    }
    case 'url':
    default: {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
      } catch {
        return s;
      }
    }
  }
}

const UNIT_TO_PT: Record<string, number> = {
  in: 72,
  mm: 72 / 25.4,
  cm: 720 / 25.4,
  pt: 1,
  mp: 0.001,
};

const UNIT_ALIASES: Record<string, string> = {
  '': 'in',
  in: 'in',
  inches: 'in',
  inch: 'in',
  mm: 'mm',
  millimeters: 'mm',
  millimeter: 'mm',
  millimetres: 'mm',
  cm: 'cm',
  centimeters: 'cm',
  centimeter: 'cm',
  centimetres: 'cm',
  pt: 'pt',
  points: 'pt',
  point: 'pt',
  picas: 'pt',
  pica: 'pt',
  mp: 'mp',
  millipoints: 'mp',
  millipoint: 'mp',
};

function parseUnitSpan(s: string): { value: number; unit: string } | null {
  const str = String(s).trim();
  const m = str.match(/^(.*?)([a-zA-Z]+)$/);
  if (!m) {
    if (str === '') return null;
    const v = Number(str);
    if (isNaN(v)) return null;
    return { value: v, unit: 'in' };
  }
  const numPart = m[1].trim();
  const unitWord = m[2].toLowerCase();
  const unit = UNIT_ALIASES[unitWord];
  if (unit === undefined) return null;
  if (numPart === '') return { value: 1, unit };
  const v = Number(numPart);
  if (isNaN(v)) return null;
  return { value: v, unit };
}

export const MISC_FUNCTIONS: BuiltinFunctionMap = {
  get: () => '',
  put: () => '',
  post: () => '',

  encode: (args) =>
    encodeString(
      strValue(args[0]),
      args.length > 1 && args[1] != null ? strValue(args[1]).toLowerCase() : 'url'
    ),
  decode: (args) =>
    decodeString(
      strValue(args[0]),
      args.length > 1 && args[1] != null ? strValue(args[1]).toLowerCase() : 'url'
    ),

  throw: (args) => {
    throw new FormCalcError(strValue(args[0]), 0x7800);
  },
  messagebox: () => null,
  ref: (args) => args[0] ?? null,

  page: () => 1,
  presence: () => 'visible',

  unitvalue: (args) => {
    const raw = args[0];
    let value: number;
    let fromUnit: string;
    if (typeof raw === 'number') {
      value = raw;
      fromUnit = 'in';
    } else {
      const span = parseUnitSpan(strValue(raw));
      if (!span) return 0;
      value = span.value;
      fromUnit = span.unit;
    }
    let toUnit = fromUnit;
    if (args.length > 1 && args[1] !== undefined && args[1] !== null) {
      const target = UNIT_ALIASES[strValue(args[1]).trim().toLowerCase()];
      toUnit = target === undefined ? 'in' : target;
    }
    const fromPt = UNIT_TO_PT[fromUnit] ?? 72;
    const toPt = UNIT_TO_PT[toUnit] ?? 72;
    return (value * fromPt) / toPt;
  },
  unittype: (args) => {
    const span = parseUnitSpan(strValue(args[0]));
    return span ? span.unit : 'in';
  },
};
