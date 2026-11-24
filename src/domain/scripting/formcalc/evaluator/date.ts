import {
  getMeridiem,
  getMonthNames,
  getNumberSeparators,
  getWeekdayNames,
} from '../../../../lib/locale-format';
import { strValue, toNumber } from './shared';
import type { BuiltinFunctionMap } from './shared';

const XFA_EPOCH_UTC = Date.UTC(1899, 11, 31);

const MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function monthNamesFor(locale: string | undefined, style: 'long' | 'short'): string[] {
  if (!locale) return style === 'long' ? MONTHS_FULL : MONTHS_ABBR;
  return getMonthNames(locale, style);
}

function weekdayNamesFor(locale: string | undefined, style: 'long' | 'short'): string[] {
  if (!locale) return style === 'long' ? DAYS_FULL : DAYS_ABBR;
  return getWeekdayNames(locale, style);
}

function daysSinceXfaEpoch(y: number, m1: number, d: number): number {
  return Math.round((Date.UTC(y, m1 - 1, d) - XFA_EPOCH_UTC) / 86400000);
}

function xfaDateFromDays(n: number): Date {
  const u = new Date(XFA_EPOCH_UTC + Math.trunc(n) * 86400000);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 12, 0, 0, 0);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m1: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m1 - 1];
}

function formatISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatISOTime(h: number, m: number, s: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface ParsedDateTime {
  y: number | null;
  mo: number | null;
  d: number | null;
  H: number | null;
  M: number | null;
  S: number | null;
  ms: number;
}

type PictureKind = { date: boolean; time: boolean; numeric: boolean; text: boolean };

function pictureKinds(picture: string): PictureKind {
  const p = picture.replace(/'[^']*'/g, '');
  const numeric = /^num\{/i.test(p) || (/[9#]/.test(p) && !/[YMD]/i.test(p));
  if (numeric) return { date: false, time: false, numeric: true, text: false };
  const date = /[YDJEGW]/i.test(p) || /D/.test(p);
  const time = /[hH]/.test(p) || /[sS]/.test(p) || /A/.test(p) || /z/.test(p);
  if (date || time) return { date, time, numeric: false, text: !date && !time };
  return { date: false, time: false, numeric: false, text: true };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoWeek(d: Date): number {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const week1 = new Date(t.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(((t.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  );
}

function formatWithPicture(d: Date, picture: string, ms = 0, locale?: string): string {
  const bare = picture.replace(/'[^']*'/g, '');
  const hasDateSym = /[YDJEGW]/i.test(bare) || /D/.test(bare);
  const hasTimeSym = /[hH]/.test(bare) || /[sS]/.test(bare) || /A/.test(bare) || /z/.test(bare);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const dow = d.getDay();
  const doy =
    Math.round((new Date(y, mo - 1, day).getTime() - new Date(y, 0, 1).getTime()) / 86400000) + 1;
  const H = d.getHours();
  const Mi = d.getMinutes();
  const S = d.getSeconds();
  let hourSeen = false;
  let out = '';
  let i = 0;
  const p = picture;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "'") {
      i++;
      while (i < p.length && p[i] !== "'") out += p[i++];
      if (i < p.length) i++;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < p.length && p[j] === ch) j++;
      const run = j - i;
      i = j;
      if (ch === 'h' || ch === 'H' || ch === 'k' || ch === 'K') {
        hourSeen = true;
        if (ch === 'h') {
          const h12 = H % 12 || 12;
          out += run >= 2 ? pad2(h12) : String(h12);
        } else if (ch === 'H') {
          out += run >= 2 ? pad2(H) : String(H);
        } else if (ch === 'k') {
          const hk = H % 12;
          out += run >= 2 ? pad2(hk) : String(hk);
        } else {
          const hK = H + 1;
          out += run >= 2 ? pad2(hK) : String(hK);
        }
        continue;
      }
      switch (ch.toUpperCase()) {
        case 'Y':
          out += run >= 4 ? String(y).padStart(run, '0') : pad2(y % 100);
          break;
        case 'D':
          out += run >= 2 ? pad2(day) : String(day);
          break;
        case 'J':
          out += String(doy).padStart(run, '0');
          break;
        case 'M': {
          const minute = hasTimeSym && (!hasDateSym || hourSeen);
          if (minute) out += run >= 2 ? pad2(Mi) : String(Mi);
          else if (run >= 4) out += monthNamesFor(locale, 'long')[mo - 1];
          else if (run === 3) out += monthNamesFor(locale, 'short')[mo - 1];
          else if (run === 2) out += pad2(mo);
          else out += String(mo);
          break;
        }
        case 'E':
          if (run >= 4) out += weekdayNamesFor(locale, 'long')[dow];
          else if (run === 3) out += weekdayNamesFor(locale, 'short')[dow];
          else out += String(dow + 1);
          break;
        case 'W':
          out += pad2(isoWeek(d));
          break;
        case 'w':
          out += String(Math.floor((day - 1) / 7) + 1);
          break;
        case 'G':
          out += 'AD';
          break;
        case 'S':
          out += run >= 3 ? String(ms).padStart(3, '0') : run >= 2 ? pad2(S) : String(S);
          break;
        case 'F':
          out += String(ms).padStart(3, '0');
          break;
        case 'A':
          out += getMeridiem(locale, H >= 12);
          break;
        case 'Z':
          out += 'GMT';
          break;
        case 'z':
          break;
        default:
          out += ch;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function dayFromName(name: string, locale?: string): number | null {
  const lower = name.toLocaleLowerCase(locale);
  for (let i = 0; i < 7; i++) {
    const full = weekdayNamesFor(locale, 'long')[i].toLocaleLowerCase(locale);
    const abbr = weekdayNamesFor(locale, 'short')[i].toLocaleLowerCase(locale);
    if (full === lower || abbr === lower) return i;
  }
  return null;
}

function parseDateWithPicture(
  input: string,
  picture: string,
  locale?: string
): ParsedDateTime | null {
  const s = input;
  let si = 0;
  const res: ParsedDateTime = { y: null, mo: null, d: null, H: null, M: null, S: null, ms: 0 };
  let hourSeen = false;
  let meridian: 'AM' | 'PM' | null = null;
  const bare = picture.replace(/'[^']*'/g, '');
  const hasDateSym = /[YDJEGW]/i.test(bare) || /D/.test(bare);
  const hasTimeSym = /[hH]/.test(bare) || /[sS]/.test(bare) || /A/.test(bare) || /z/.test(bare);

  const skipWs = () => {
    while (si < s.length && /\s/.test(s[si])) si++;
  };
  const readDigits = (min: number, max: number): number | null => {
    skipWs();
    let j = si;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
    if (j - si < min) return null;
    const take = Math.min(j - si, max);
    const v = parseInt(s.slice(si, si + take), 10);
    si += take;
    return v;
  };
  const readWord = (): string | null => {
    skipWs();
    let j = si;
    while (j < s.length && /\p{L}/u.test(s[j])) j++;
    if (j === si) return null;
    const w = s.slice(si, j);
    si = j;
    return w;
  };
  const expectLiteral = (lit: string): boolean => {
    if (lit.trim() === '') {
      while (si < s.length && /\s/.test(s[si])) si++;
      return true;
    }
    skipWs();
    if (s.startsWith(lit, si)) {
      si += lit.length;
      return true;
    }
    if (!/[A-Za-z0-9]/.test(lit) && si < s.length && !/[A-Za-z0-9]/.test(s[si])) {
      si++;
      return true;
    }
    if (s.length > si && s[si].toLowerCase() === lit.toLowerCase()) {
      si += lit.length;
      return true;
    }
    return false;
  };

  let i = 0;
  const p = picture;
  while (i < p.length) {
    const ch = p[i];
    if (ch === "'") {
      i++;
      let lit = '';
      while (i < p.length && p[i] !== "'") lit += p[i++];
      if (i < p.length) i++;
      if (!expectLiteral(lit)) return null;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < p.length && p[j] === ch) j++;
      const run = j - i;
      i = j;
      if (ch === 'h' || ch === 'H' || ch === 'k' || ch === 'K') {
        hourSeen = true;
        const h = readDigits(1, 2);
        if (h === null) return null;
        res.H = h;
        continue;
      }
      switch (ch.toUpperCase()) {
        case 'Y': {
          const v = readDigits(run >= 4 ? 4 : 2, run >= 4 ? 4 : 2);
          if (v === null) return null;
          res.y = run >= 4 ? v : v <= 29 ? 2000 + v : 1900 + v;
          break;
        }
        case 'D': {
          const v = readDigits(run >= 2 ? 2 : 1, 2);
          if (v === null) return null;
          res.d = v;
          break;
        }
        case 'J': {
          const v = readDigits(1, 3);
          if (v === null) return null;
          break;
        }
        case 'M': {
          const minute = hasTimeSym && (!hasDateSym || hourSeen);
          if (minute) {
            const v = readDigits(1, 2);
            if (v === null) return null;
            res.M = v;
          } else if (run >= 3) {
            const saved = si;
            let best: number | null = null;
            let bestLen = -1;
            const fullNames = monthNamesFor(locale, 'long');
            const shortNames = monthNamesFor(locale, 'short');
            const tail = s.slice(saved).toLocaleLowerCase(locale);
            for (let k = 0; k < 12; k++) {
              for (const nm of [fullNames[k], shortNames[k]]) {
                const candidate = nm.toLocaleLowerCase(locale);
                if (candidate.length > bestLen && tail.startsWith(candidate)) {
                  best = k + 1;
                  bestLen = candidate.length;
                }
              }
            }
            if (best === null) return null;
            si = saved + bestLen;
            res.mo = best;
          } else {
            const v = readDigits(run >= 2 ? 2 : 1, 2);
            if (v === null) return null;
            res.mo = v;
          }
          break;
        }
        case 'E': {
          const w = readWord();
          if (w === null || dayFromName(w, locale) === null) return null;
          break;
        }
        case 'G': {
          const w = readWord();
          if (w === null) return null;
          break;
        }
        case 'S': {
          const v = readDigits(1, 2);
          if (v === null) return null;
          res.S = v;
          break;
        }
        case 'F': {
          const v = readDigits(1, 3);
          if (v === null) return null;
          res.ms = v;
          break;
        }
        case 'A': {
          skipWs();
          const tail = s.slice(si);
          const lowerTail = tail.toLocaleLowerCase(locale);
          const candidates: Array<[string, 'AM' | 'PM']> = [
            [getMeridiem(locale, false), 'AM'],
            [getMeridiem(locale, true), 'PM'],
          ];
          let matched: 'AM' | 'PM' | null = null;
          let matchedLength = 0;
          for (const [label, value] of candidates) {
            const lower = label.toLocaleLowerCase(locale);
            if (lower.length > matchedLength && lowerTail.startsWith(lower)) {
              matched = value;
              matchedLength = label.length;
            }
          }
          if (!matched) {
            const m = tail.match(/^(a\.?m\.?|p\.?m\.?)/i);
            if (m) {
              matched = m[1][0].toLowerCase() === 'p' ? 'PM' : 'AM';
              matchedLength = m[0].length;
            }
          }
          if (matched) {
            meridian = matched;
            si += matchedLength;
          }
          break;
        }
        case 'Z':
        case 'z': {
          skipWs();
          const m = s.slice(si).match(/^(GMT|Z|[+-]\d{2}:?\d{2})/i);
          if (m) si += m[0].length;
          break;
        }
        default:
          return null;
      }
      continue;
    }
    if (!expectLiteral(ch)) return null;
    i++;
  }
  skipWs();
  if (si < s.length) return null;
  if (meridian !== null && res.H !== null) {
    if (meridian === 'PM' && res.H < 12) res.H += 12;
    else if (meridian === 'AM' && res.H === 12) res.H = 0;
  }
  const isDatePic = hasDateSym;
  if (isDatePic) {
    if (res.y === null || res.mo === null || res.d === null) return null;
    if (res.mo < 1 || res.mo > 12) return null;
    if (res.d < 1 || res.d > daysInMonth(res.y, res.mo)) return null;
  }
  if (res.H !== null && (res.H < 0 || res.H > 23)) return null;
  if (res.M !== null && (res.M < 0 || res.M > 59)) return null;
  if (res.S !== null && (res.S < 0 || res.S > 59)) return null;
  return res;
}

function parseDateHeuristic(dateStr: string): Date | null {
  const str = dateStr.trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  const parts = str.split(/[/-]/);
  if (parts.length === 3 && parts.every((x) => /^\d+$/.test(x))) {
    const nums = parts.map(Number);
    if (nums[0] > 31) return new Date(nums[0], nums[1] - 1, nums[2], 12);
    if (nums[2] > 31) {
      return new Date(nums[2], nums[0] - 1, nums[1], 12);
    }
    return new Date(nums[2], nums[0] - 1, nums[1], 12);
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return null;
}

type strFallback = string;

function numericFromPicture(picture: string, str: string, locale?: string): number | strFallback {
  const { group, decimal } = getNumberSeparators(locale);
  const cleaned = str.split(group).join('').split(decimal).join('.');
  const m = cleaned.match(/-?\d*\.?\d+/);
  if (!m) return str;
  const n = Number(m[0]);
  return isNaN(n) ? str : n;
}

function formatNumericPicture(picture: string, value: unknown, locale?: string): string {
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.eE+-]/g, ''));
  if (isNaN(num)) return strValue(value);
  const body = picture.replace(/^num\{/i, '').replace(/\}$/, '');
  const { group, decimal } = getNumberSeparators(locale);
  const decMatch = body.match(/\.([9#zZ]+)/);
  const decimals = decMatch ? decMatch[1].length : 0;
  const negative = num < 0;
  let out = Math.abs(num).toFixed(decimals);
  if (body.includes(',')) {
    const [intp, frac = ''] = out.split('.');
    const grouped = intp.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    out = frac ? `${grouped}${decimal}${frac}` : grouped;
  }
  const prefix = body.startsWith('$') ? '$' : '';
  return negative ? `-${prefix}${out}` : `${prefix}${out}`;
}

function applyPictureFormat(picture: string, value: unknown, locale?: string): string {
  if (!picture) return strValue(value);

  const numMatch = picture.match(/^num\{(.+)\}$/i);
  if (numMatch) return formatNumericPicture(numMatch[1], value, locale);
  const dateMatch = picture.match(/^date\{(.+)\}$/i);
  if (dateMatch) return applyDatePicture(dateMatch[1], value, locale);
  const timeMatch = picture.match(/^time\{(.+)\}$/i);
  if (timeMatch) return applyTimePicture(timeMatch[1], value, locale);
  if (/^text\{/i.test(picture)) return strValue(value);

  const kinds = pictureKinds(picture);
  if (kinds.numeric) return formatNumericPicture(picture, value, locale);
  if (kinds.date) return applyDatePicture(picture, value, locale);
  if (kinds.time) return applyTimePicture(picture, value, locale);
  return strValue(value);
}

function coerceToDate(value: unknown, locale?: string): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return xfaDateFromDays(value);
  const str = String(value ?? '');
  const m8 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return new Date(+m8[1], +m8[2] - 1, +m8[3], 12);
  const p = parseDateWithPicture(str, 'YYYY-MM-DD', locale);
  if (p) return new Date(p.y!, p.mo! - 1, p.d!, 12);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function applyDatePicture(picture: string, value: unknown, locale?: string): string {
  const d = coerceToDate(value, locale);
  if (!d) return strValue(value);
  return formatWithPicture(d, picture, 0, locale);
}

function applyTimePicture(picture: string, value: unknown, locale?: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value;
    const h = Math.floor(ms / 3600000) % 24;
    const mi = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const base = new Date(2000, 0, 1, h, mi, s);
    return formatWithPicture(base, picture, Math.floor(ms) % 1000, locale);
  }
  const p = parseDateWithPicture(String(value ?? ''), picture, locale);
  if (p && p.H !== null) {
    const base = new Date(2000, 0, 1, p.H, p.M ?? 0, p.S ?? 0);
    return formatWithPicture(base, picture, p.ms, locale);
  }
  return strValue(value);
}

function parsePictureFormat(picture: string, str: string, locale?: string): unknown {
  if (!picture) return str;
  const kinds = pictureKinds(picture);
  if (kinds.numeric) {
    const n = numericFromPicture(picture, str, locale);
    return typeof n === 'number' ? n : str;
  }
  const parsed = parseDateWithPicture(str, picture, locale);
  if (!parsed) return str;
  if (kinds.date && kinds.time) {
    if (parsed.y === null || parsed.mo === null || parsed.d === null) return str;
    return `${formatISODate(new Date(parsed.y, parsed.mo - 1, parsed.d))}T${formatISOTime(parsed.H ?? 0, parsed.M ?? 0, parsed.S ?? 0)}`;
  }
  if (kinds.date) {
    if (parsed.y === null || parsed.mo === null || parsed.d === null) return str;
    return formatISODate(new Date(parsed.y, parsed.mo - 1, parsed.d));
  }
  if (kinds.time) {
    return formatISOTime(parsed.H ?? 0, parsed.M ?? 0, parsed.S ?? 0);
  }
  return str;
}

function dateFmt(args: unknown[]): string {
  const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
  const styles = ['MMM D, YYYY', 'M/D/YY', 'MMM D, YYYY', 'MMMM D, YYYY', 'EEEE, MMMM D, YYYY'];
  return styles[n >= 0 && n < styles.length ? n : 0];
}

function timeFmt(args: unknown[]): string {
  const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
  const styles = ['h:mm:ss a', 'h:mm a', 'HH:mm:ss', 'HH:mm:ss z', "HH' h 'mm z"];
  return styles[n >= 0 && n < styles.length ? n : 0];
}

export const DATE_FUNCTIONS: BuiltinFunctionMap = {
  date: (args, env) => {
    if (args.length === 0) {
      const now = new Date();
      return daysSinceXfaEpoch(now.getFullYear(), now.getMonth() + 1, now.getDate());
    }
    if (args.length >= 3) {
      return daysSinceXfaEpoch(toNumber(args[0]), toNumber(args[1]), toNumber(args[2]));
    }
    const src = strValue(args[0]);
    let parsed: ParsedDateTime | null;
    if (args.length > 1 && args[1] != null) {
      parsed = parseDateWithPicture(src, strValue(args[1]), env.locale);
    } else {
      parsed = parseDateWithPicture(src, 'MMM D, YYYY', env.locale);
      if (!parsed) {
        const d = parseDateHeuristic(src);
        if (d)
          parsed = {
            y: d.getFullYear(),
            mo: d.getMonth() + 1,
            d: d.getDate(),
            H: null,
            M: null,
            S: null,
            ms: 0,
          };
      }
    }
    if (!parsed || parsed.y === null || parsed.mo === null || parsed.d === null) return 0;
    return daysSinceXfaEpoch(parsed.y, parsed.mo, parsed.d);
  },
  time: () => {
    const now = new Date();
    return (
      ((now.getUTCHours() * 60 + now.getUTCMinutes()) * 60 + now.getUTCSeconds()) * 1000 +
      now.getUTCMilliseconds()
    );
  },
  datetime: () => {
    const now = new Date();
    return `${formatISODate(now)}T${formatISOTime(now.getHours(), now.getMinutes(), now.getSeconds())}`;
  },
  'date.collapse': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    return d ? formatISODate(d) : '';
  },
  'date.largest': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    if (!d) return 0;
    return daysInMonth(d.getFullYear(), d.getMonth() + 1);
  },
  'date.month': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    return d ? d.getMonth() + 1 : 0;
  },
  'date.year': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    return d ? d.getFullYear() : 0;
  },
  'date.weekday': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    return d ? d.getDay() + 1 : 0;
  },
  'date.daysinmonth': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    if (!d) return 0;
    return daysInMonth(d.getFullYear(), d.getMonth() + 1);
  },
  'date.daysinyear': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    if (!d) return 0;
    return isLeap(d.getFullYear()) ? 366 : 365;
  },
  'date.dayofyear': (args) => {
    const d = parseDateHeuristic(strValue(args[0]));
    if (!d) return 0;
    const start = new Date(d.getFullYear(), 0, 1);
    return (
      Math.floor(
        (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) /
          86400000
      ) + 1
    );
  },

  num2date: (args, env) => {
    const num = toNumber(args[0]);
    if (!Number.isFinite(num)) return NaN;
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'MMM D, YYYY';
    return formatWithPicture(xfaDateFromDays(num), picture, 0, env.locale);
  },
  date2num: (args, env) => {
    const dateStr = strValue(args[0]);
    if (args.length > 1 && args[1] != null) {
      const parsed = parseDateWithPicture(dateStr, strValue(args[1]), env.locale);
      if (!parsed || parsed.y === null || parsed.mo === null || parsed.d === null) return 0;
      return daysSinceXfaEpoch(parsed.y, parsed.mo, parsed.d);
    }
    const direct = parseDateWithPicture(dateStr, 'MMM D, YYYY', env.locale);
    if (direct && direct.y !== null && direct.mo !== null && direct.d !== null) {
      return daysSinceXfaEpoch(direct.y, direct.mo, direct.d);
    }
    const d = parseDateHeuristic(dateStr);
    if (!d) return 0;
    return daysSinceXfaEpoch(d.getFullYear(), d.getMonth() + 1, d.getDate());
  },
  num2time: (args, env) => {
    const num = toNumber(args[0]);
    if (!Number.isFinite(num)) return NaN;
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'H:MM:SS A';
    const h = Math.floor(num / 3600000) % 24;
    const mi = Math.floor(num / 60000) % 60;
    const s = Math.floor(num / 1000) % 60;
    return formatWithPicture(
      new Date(2000, 0, 1, h, mi, s),
      picture,
      Math.floor(num) % 1000,
      env.locale
    );
  },
  time2num: (args, env) => {
    const timeStr = strValue(args[0]);
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'H:MM:SS A';
    const parsed = parseDateWithPicture(timeStr, picture, env.locale);
    if (!parsed || parsed.H === null) return 0;
    return ((parsed.H * 60 + (parsed.M ?? 0)) * 60 + (parsed.S ?? 0)) * 1000 + parsed.ms;
  },
  isodate2num: (args) => {
    const iso = strValue(args[0]);
    const m = iso.match(/^(\d{4})(?:-?(\d{2}))?(?:-?(\d{2}))?/);
    if (!m) return 0;
    const y = parseInt(m[1], 10);
    const mo = m[2] ? parseInt(m[2], 10) : 1;
    const d = m[3] ? parseInt(m[3], 10) : 1;
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return 0;
    return daysSinceXfaEpoch(y, mo, d);
  },
  isotime2num: (args) => {
    const iso = strValue(args[0]);
    const m = iso.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return 0;
    return (
      parseInt(m[1], 10) * 3600000 +
      parseInt(m[2], 10) * 60000 +
      (m[3] ? parseInt(m[3], 10) * 1000 : 0)
    );
  },
  num2gmtime: (args, env) => {
    const num = toNumber(args[0]);
    if (!Number.isFinite(num)) return NaN;
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'H:MM:SS A';
    const total = Math.floor(num);
    const epochMs = XFA_EPOCH_UTC + total;
    const u = new Date(epochMs);
    const base = new Date(2000, 0, 1, u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
    let out = formatWithPicture(base, picture, u.getUTCMilliseconds(), env.locale);
    if (/[Zz]/.test(picture) && !/GMT/.test(out)) out += out ? ' GMT' : 'GMT';
    return out;
  },
  localdatefmt: (args) => {
    const locale = args.length && args[0] != null ? strValue(args[0]) : 'en_US';
    if (locale.startsWith('de')) return 'DD.MM.YYYY';
    if (locale.startsWith('fr')) return 'DD/MM/YYYY';
    if (locale.startsWith('ja') || locale.startsWith('zh')) return 'YYYY/MM/DD';
    return 'MM/DD/YYYY';
  },
  localtimefmt: (args) => {
    const locale = args.length && args[0] != null ? strValue(args[0]) : 'en_US';
    if (locale.startsWith('de') || locale.startsWith('fr')) return 'HH:MM:SS';
    return 'h:MM:SS A';
  },
  datefmt: (args) => dateFmt(args),
  timefmt: (args) => timeFmt(args),
  numfmt: (args) => {
    const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
    const styles = ['999,999.99', '9999', '999,999.999', '999999', '999,999.99'];
    return styles[n >= 0 && n < styles.length ? n : 0];
  },
  datetimefmt: (args) => {
    const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
    const d = dateFmt([n]);
    const t = timeFmt([n]);
    return `${d} ${t}`;
  },

  format: (args, env) => applyPictureFormat(strValue(args[0]), args[1], env.locale),
  parse: (args, env) => parsePictureFormat(strValue(args[0]), strValue(args[1]), env.locale),
};
