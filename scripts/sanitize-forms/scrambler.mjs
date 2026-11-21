
import { createHmac } from 'node:crypto';

const LATIN_CLASSES = [
  'ilj', 'ftr', 'ckvxyzs', 'abdeghnopqu', 'mw',
  'IJ', 'FLTZ', 'ABEKPSVXY', 'CDHNRU', 'GOQ', 'MW',
  'àáâãäåèéêëòóôõöùúûüñ', 'ìíîï', 'çýÿ', 'ß',
  'ÀÁÂÃÄÅÈÉÊËÝ', 'ÇÑÙÚÛÜ', 'ÒÓÔÕÖ', 'ÌÍÎÏ',
  'αβγδεζηθικλμνξοπρστυφχψως', 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ',
  'абвгдежзийклмнопрстуфхцчшщъыьэюя', 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン',
];
const POOL_OF = new Map();
for (const pool of LATIN_CLASSES) for (const ch of pool) POOL_OF.set(ch, [...pool]);

const HAN = [
  ...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黑断线',
];

export const URL_ALLOWLIST = [
  'w3.org', 'xfa.org', 'xfa.com', 'ns.adobe.com', 'purl.org', 'aiim.org', 'iptc.org', 'npes.org',
  'xmlns.com', 'example.com', 'example.org', 'schemas.openxmlformats.org', 'schemas.microsoft.com',
  'schemas.xmlsoap.org', 'docs.oasis-open.org',
];

export function hostOf(url) {
  const m = /^(?:[a-z][\w+.-]*:\/\/)?([^/\s?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

export function isAllowedUrl(url) {
  if (/^file:/i.test(url)) return false;
  const host = hostOf(url);
  return URL_ALLOWLIST.some((d) => host === d || host.endsWith(`.${d}`));
}

const SENSITIVE_SOURCES = [
  String.raw`(?<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)`,
  String.raw`(?<url>\b(?:https?|ftp|file):\/\/[^\s"'<>]+|\bwww\.[\w-]+(?:\.[\w-]+)+[^\s"'<>]*)`,
  String.raw`(?<winpath>(?:\b[A-Za-z]:\\|\\\\[\w.$-]+\\|\.{1,2}\\)[^\r\n"'<>|?*]*)`,
];
const VALUE_SOURCES = [
  String.raw`(?<uuid>\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b)`,
  String.raw`(?<iso>\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b)`,
  String.raw`(?<dmy>\b\d{1,2}(?<sep>[./])\d{1,2}\k<sep>(?:\d{4}|\d{2})\b)`,
  String.raw`(?<cjk>\d{4}年\d{1,2}月\d{1,2}日)`,
  String.raw`(?<time>\b\d{1,2}:\d{2}(?::\d{2})?\b)`,
  String.raw`(?<word>[\p{L}\p{M}]+)`,
  String.raw`(?<num>[0-9０-９]+)`,
];
const SENSITIVE = new RegExp(SENSITIVE_SOURCES.join('|'), 'gu');
const EVERYTHING = new RegExp([...SENSITIVE_SOURCES, ...VALUE_SOURCES].join('|'), 'gu');
const LETTER = /\p{L}/u;

const INT_RANGES = {
  byte: [-128n, 127n],
  short: [-32768n, 32767n],
  int: [-2147483648n, 2147483647n],
  long: [-(2n ** 63n), 2n ** 63n - 1n],
  unsignedByte: [0n, 255n],
  unsignedShort: [0n, 65535n],
  unsignedInt: [0n, 4294967295n],
  unsignedLong: [0n, 2n ** 64n - 1n],
  integer: [null, null],
  positiveInteger: [1n, null],
  nonNegativeInteger: [0n, null],
  negativeInteger: [null, -1n],
  nonPositiveInteger: [null, 0n],
};
const FLOAT_TYPES = new Set(['float', 'double', 'decimal']);
const DATE_TYPES = new Set(['date', 'dateTime', 'time']);

export function wordsOf(s, { camel = true } = {}) {
  const out = [];
  for (const run of s.match(/\p{L}+/gu) ?? []) {
    out.push(run.toLowerCase());
    if (!camel) continue;
    const parts = run.match(/\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{L}+/gu) ?? [];
    if (parts.length > 1) for (const p of parts) out.push(p.toLowerCase());
  }
  return out;
}

export function createScrambler({ salt, controlValues = new Set(), controlNumbers = new Set() }) {
  const replacedValues = new Set();
  const replacedWords = new Set();
  const wordCache = new Map();
  const numCache = new Map();

  const isControl = (v) =>
    controlValues.has(v) || (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v) && controlNumbers.has(Number(v)));

  function rng(key) {
    let block = 0;
    let buf = null;
    let pos = 32;
    return (n) => {
      if (pos + 4 > 32) {
        buf = createHmac('sha256', salt).update(`${key}\u0000${block++}`).digest();
        pos = 0;
      }
      const v = buf.readUInt32LE(pos);
      pos += 4;
      return v % n;
    };
  }

  function hex(key, length) {
    return createHmac('sha256', salt).update(key).digest('hex').slice(0, length);
  }

  function noteWords(s) {
    for (const w of wordsOf(s, { camel: false })) if (w.length >= 5) replacedWords.add(w);
  }

  function noteValue(s) {
    const v = s.trim();
    if (v.length >= 4 && LETTER.test(v)) replacedValues.add(v);
  }

  function mapChar(ch, next) {
    const pool = POOL_OF.get(ch);
    if (pool) return pool[next(pool.length)];
    if (/\p{Script=Han}/u.test(ch)) return HAN[next(HAN.length)];
    if (/\p{Script=Hangul}/u.test(ch)) return String.fromCharCode(0xac00 + next(11172));
    const code = ch.codePointAt(0);
    if (code >= 0xff21 && code <= 0xff3a) return String.fromCharCode(0xff21 + next(26));
    if (code >= 0xff41 && code <= 0xff5a) return String.fromCharCode(0xff41 + next(26));
    if (/\p{M}/u.test(ch)) return ch;
    return /\p{Lu}/u.test(ch) ? 'X' : 'x';
  }

  function word(w) {
    let out = wordCache.get(w);
    if (out === undefined) {
      for (let attempt = 0; attempt < 8 && (out === undefined || out === w); attempt++) {
        const next = rng(`w:${w.toLowerCase()}${attempt ? `#${attempt}` : ''}`);
        out = '';
        for (const ch of w) out += mapChar(ch, next);
      }
      wordCache.set(w, out);
    }
    if (w.length >= 5) replacedWords.add(w.toLowerCase());
    return out;
  }

  function digits(run) {
    let out = numCache.get(run);
    if (out === undefined) {
      for (let attempt = 0; attempt < 8 && (out === undefined || out === run); attempt++) {
        const next = rng(`n:${run}${attempt ? `#${attempt}` : ''}`);
        out = '';
        for (const ch of run) {
          if (ch >= '1' && ch <= '9') out += String(1 + next(9));
          else if (ch >= '１' && ch <= '９') out += String.fromCharCode(0xff11 + next(9));
          else out += ch;
        }
      }
      numCache.set(run, out);
    }
    return out;
  }

  const digitsIn = (s) => s.replace(/[0-9０-９]+/g, digits);
  const pad = (n, width) => String(n).padStart(width, '0');

  function fakeYear(next, width) {
    return width === 2 ? pad(19 + next(7), 2) : String(2019 + next(7));
  }

  function isoDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(.*))?$/.exec(s);
    if (!m) return null;
    const [, y, mo, d, h, mi, sec, frac, tz] = m;
    if (+y < 1 || +mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    if (h !== undefined && (+h > 23 || +mi > 59 || (sec !== undefined && +sec > 59))) return null;
    const next = rng(`d:${s}`);
    let out = `${fakeYear(next, 4)}-${pad(1 + next(12), 2)}-${pad(1 + next(28), 2)}`;
    if (h !== undefined) {
      out += `T${pad(next(24), 2)}:${pad(next(60), 2)}`;
      if (sec !== undefined) out += `:${pad(next(60), 2)}${frac ? `.${digits(frac.slice(1))}` : ''}`;
      out += tz ?? '';
    }
    return out;
  }

  function dayMonthYear(s, sep) {
    const [d, mo, y] = s.split(sep);
    const ambiguous = sep === '/';
    const valid = +d >= 1 && +mo >= 1 && (ambiguous ? +d <= 31 && +mo <= 31 : +d <= 31 && +mo <= 12);
    if (!valid) return null;
    const next = rng(`dmy:${s}`);
    const part = (width, max) => (width === 1 ? String(1 + next(9)) : pad(1 + next(max), 2));
    return [part(d.length, ambiguous ? 12 : 28), part(mo.length, 12), fakeYear(next, y.length)].join(sep);
  }

  function cjkDate(s) {
    const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
    const next = rng(`cjk:${s}`);
    const part = (width, max) => (width === 1 ? String(1 + next(9)) : pad(1 + next(max), 2));
    return `${fakeYear(next, 4)}年${part(m[2].length, 12)}月${part(m[3].length, 28)}日`;
  }

  function time(s) {
    if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) return null;
    const parts = s.split(':');
    if (+parts[0] > 23 || +parts[1] > 59 || (parts[2] !== undefined && +parts[2] > 59)) return null;
    const next = rng(`t:${s}`);
    const hour = parts[0].length === 1 ? String(next(10)) : pad(next(24), 2);
    return [hour, ...parts.slice(1).map(() => pad(next(60), 2))].join(':');
  }

  function email(e) {
    if (/@example\.(com|org)$/i.test(e)) return e;
    return `user-${hex(`e:${e.toLowerCase()}`, 6)}@example.com`;
  }

  function path(p, keepName = false) {
    const trimmed = p.replace(/\s+$/, '');
    const base = trimmed.split(/[\\/]+/).filter(Boolean).pop() ?? '';
    const ext = /\.\w{1,5}$/.exec(base)?.[0] ?? '';
    let next;
    if (keepName && /^[\w.-]+\.\w{1,5}$/.test(base)) {
      noteWords(trimmed.slice(0, trimmed.length - base.length));
      next = base;
    } else {
      noteWords(trimmed);
      next = scrambleAll(base.slice(0, base.length - ext.length)) + ext;
    }
    return next + p.slice(trimmed.length);
  }

  function url(u) {
    if (isAllowedUrl(u)) return u;
    if (/^file:/i.test(u)) return path(u.replace(/^file:\/*/i, ''));
    const prefix = /^www\./i.test(u) ? 'www.' : u.startsWith('http:') ? 'http://' : 'https://';
    return `${prefix}example.com/${hex(`u:${u}`, 8)}`;
  }

  function uuid(u) {
    const h = hex(`id:${u.toLowerCase()}`, 32);
    const out = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    return /[A-F]/.test(u) ? out.toUpperCase() : out;
  }

  function replaceMatch(m, groups) {
    if (groups.winpath) return path(m);
    if (groups.email || groups.url) {
      const out = groups.email ? email(m) : url(m);
      if (out !== m) noteWords(m);
      return out;
    }
    if (groups.uuid) return uuid(m);
    if (groups.iso) return isoDate(m) ?? digitsIn(m);
    if (groups.dmy) return dayMonthYear(m, groups.sep) ?? digitsIn(m);
    if (groups.cjk) return cjkDate(m) ?? digitsIn(m);
    if (groups.time) return time(m) ?? digitsIn(m);
    if (groups.word) return word(m);
    return digits(m);
  }

  function scrambleAll(s) {
    return s.replace(EVERYTHING, (m, ...args) => replaceMatch(m, args[args.length - 1]));
  }

  function text(value) {
    const trimmed = value.trim();
    if (!trimmed || isControl(trimmed)) return value;
    const out = scrambleAll(value);
    if (out !== value) noteValue(trimmed);
    return out;
  }

  function sensitive(value) {
    return value.replace(SENSITIVE, (m, ...args) => {
      const groups = args[args.length - 1];
      const out = replaceMatch(m, groups);
      if (out !== m) noteValue(m);
      return out;
    });
  }

  function integer(value, trimmed, type) {
    const m = /^([+-]?)(\d+)$/.exec(trimmed);
    if (!m) return text(value);
    const [, sign, run] = m;
    if (run.length === 1) return value;
    if (run[0] === '0') return value.replace(run, digits(run));
    const [min, max] = INT_RANGES[type];
    const lo = 10n ** BigInt(run.length - 1);
    let hi = 10n ** BigInt(run.length) - 1n;
    const bound = sign === '-' ? (min === null ? null : -min) : max;
    if (bound !== null && bound < hi) hi = bound;
    if (hi < lo) return value.replace(run, digits(run));
    const next = rng(`i:${trimmed}`);
    let rand = 0n;
    for (let k = 0; k < 3; k++) rand = (rand << 32n) | BigInt(next(2 ** 32));
    const span = hi - lo + 1n;
    let n = lo + (rand % span);
    if (n === BigInt(run) && span > 1n) n = lo + ((n - lo + 1n) % span);
    return value.replace(trimmed, sign + n.toString());
  }

  function typed(value, type = 'string') {
    const trimmed = value.trim();
    if (!trimmed || isControl(trimmed)) return value;
    let out;
    if (type in INT_RANGES) {
      out = integer(value, trimmed, type);
    } else if (FLOAT_TYPES.has(type)) {
      const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([eE][+-]?\d+)?$/.exec(trimmed);
      out = m ? value.replace(trimmed, digitsIn(m[1]) + (m[2] ?? '')) : text(value);
    } else if (DATE_TYPES.has(type)) {
      const fake = /^\d{4}-/.test(trimmed) ? isoDate(trimmed) : time(trimmed);
      out = fake ? value.replace(trimmed, fake) : text(value);
    } else if (type === 'boolean') {
      out = /^(true|false|0|1)$/i.test(trimmed) ? value : text(value);
    } else if (type === 'anyURI') {
      out = /^[a-z][\w+.-]*:|^www\.|\\/i.test(trimmed) ? value.replace(trimmed, url(trimmed)) : text(value);
    } else {
      out = text(value);
    }
    if (out !== value) noteValue(trimmed);
    return out;
  }

  function digest(value) {
    const b64 = createHmac('sha256', salt).update(`h:${value}`).digest('base64');
    return (b64.repeat(Math.ceil(value.length / b64.length) + 1)).slice(0, value.length);
  }

  return {
    text,
    typed,
    sensitive,
    word,
    path,
    uuid,
    digest,
    isoDate,
    scrambleAll,
    replacedValues,
    replacedWords,
  };
}
