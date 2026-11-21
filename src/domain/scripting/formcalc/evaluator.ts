import {
  Program,
  FormCalcNode,
  IfStmt,
  ForStmt,
  ForEachStmt,
  WhileStmt,
  RepeatStmt,
  VarDecl,
  AssignExpr,
  ExprStmt,
  CallExpr,
  PropAccess,
  FieldRef,
  Literal,
  Identifier,
  CompareExpr,
  ConcatExpr,
  AddExpr,
  MulExpr,
  PowerExpr,
  UnaryExpr,
  OrExpr,
  XorExpr,
  AndExpr,
  NotExpr,
  ReturnStmt,
} from './ast';
import { XfaNode } from '../script-types';
import { FormCalcParser } from './parser';

export const FORMCALC_ERR = {
  SYNTAX: 0x7810,
  PARAMS: 0x7811,
  ARITHMETIC: 0x7812,
  ACCESSOR: 0x7813,
  NOT_IN_LOOP: 0x7815,
  EMPTY_ARGS: 0x7816,
  UNKNOWN_FUNCTION: 0x7820,
} as const;

export class FormCalcError extends Error {
  constructor(
    message: string,
    public code: number = 0x7800,
    public line?: number,
    public column?: number
  ) {
    super(`FormCalc Error: ${message}`);
  }
}

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(public value: unknown) {}
}
class ArithmeticSignal {}

class FormCalcEnv {
  private scopes: Map<string, unknown>[] = [new Map()];

  get(name: string): unknown {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return undefined;
  }

  has(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return true;
    }
    return false;
  }

  set(name: string, value: unknown): void {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        this.scopes[i].set(name, value);
        return;
      }
    }
    this.scopes[this.scopes.length - 1].set(name, value);
  }

  define(name: string, value: unknown): void {
    this.scopes[this.scopes.length - 1].set(name, value);
  }

  pushScope(): void {
    this.scopes.push(new Map());
  }

  popScope(): void {
    this.scopes.pop();
  }
}

export interface FieldAccessor {
  getField(path: string, prefix: '$' | '$$'): unknown;
  setField(path: string, prefix: '$' | '$$', value: unknown): void;
  hasField?(path: string): boolean;
  getCurrentNode(): XfaNode | null;
  getFormData(): unknown;
  setCurrentKey?(key: string | null): void;
  getCurrentKey?(): string | null;
}

export interface FormCalcResult {
  value: unknown;
  modifiedFields: string[];
}

export interface FormCalcEvaluatorOptions {
  strictIdentifiers?: boolean;
}

function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return 0;
    const num = Number(trimmed);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

function numStr(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  let s = n.toPrecision(15);
  if (s.includes('e') || s.includes('E')) {
    const [mant, expStr] = s.split(/[eE]/);
    const exp = parseInt(expStr, 10);
    const neg = mant.startsWith('-');
    const [intPart, fracPart = ''] = (neg ? mant.slice(1) : mant).split('.');
    const digits = intPart + fracPart;
    const pointPos = intPart.length + exp;
    let out: string;
    if (pointPos <= 0) out = '0.' + '0'.repeat(-pointPos) + digits;
    else if (pointPos >= digits.length) out = digits + '0'.repeat(pointPos - digits.length);
    else out = digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
    s = (neg ? '-' : '') + out;
  }
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

function strValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return numStr(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

const SELF_PROPERTY_NAMES = new Set([
  'rawValue',
  'formattedValue',
  'presence',
  'access',
  'x',
  'y',
  'w',
  'h',
  'rotate',
  'name',
  'value',
  'fillColor',
  'fontColor',
  'borderColor',
  'bgColor',
]);

function isSelfProperty(name: string): boolean {
  return SELF_PROPERTY_NAMES.has(name);
}

function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

export function formCalcTruthy(val: unknown): boolean {
  const n = toNumber(val);
  return n !== 0 && !Number.isNaN(n);
}

function coerceScriptVar(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return numStr(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return v;
}

function flattenArgs(args: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const arg of args) {
    if (Array.isArray(arg)) {
      result.push(...arg);
    } else {
      result.push(arg);
    }
  }
  return result;
}

function nonNullValues(args: unknown[]): unknown[] {
  return flattenArgs(args).filter((v) => !isNullish(v));
}

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

function formatWithPicture(d: Date, picture: string, ms = 0): string {
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
          else if (run >= 4) out += MONTHS_FULL[mo - 1];
          else if (run === 3) out += MONTHS_ABBR[mo - 1];
          else if (run === 2) out += pad2(mo);
          else out += String(mo);
          break;
        }
        case 'E':
          if (run >= 4) out += DAYS_FULL[dow];
          else if (run === 3) out += DAYS_ABBR[dow];
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
          out += H < 12 ? 'AM' : 'PM';
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

function dayFromName(name: string): number | null {
  const lower = name.toLowerCase();
  for (let i = 0; i < 7; i++) {
    if (DAYS_FULL[i].toLowerCase() === lower || DAYS_ABBR[i].toLowerCase() === lower) return i;
  }
  return null;
}

function parseDateWithPicture(input: string, picture: string): ParsedDateTime | null {
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
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
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
            for (let k = 0; k < 12; k++) {
              for (const nm of [MONTHS_FULL[k], MONTHS_ABBR[k]]) {
                if (
                  nm.length > bestLen &&
                  s.slice(saved).toLowerCase().startsWith(nm.toLowerCase())
                ) {
                  best = k + 1;
                  bestLen = nm.length;
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
          if (w === null || dayFromName(w) === null) return null;
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
          const m = s.slice(si).match(/^(a\.?m\.?|p\.?m\.?)/i);
          if (m) {
            meridian = m[1][0].toLowerCase() === 'p' ? 'PM' : 'AM';
            si += m[0].length;
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

function numericFromPicture(picture: string, str: string): number | strFallback {
  const cleaned = str.replace(/,/g, '');
  const m = cleaned.match(/-?\d*\.?\d+/);
  if (!m) return str;
  const n = Number(m[0]);
  return isNaN(n) ? str : n;
}
type strFallback = string;

function formatNumericPicture(picture: string, value: unknown): string {
  const num = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.eE+-]/g, ''));
  if (isNaN(num)) return strValue(value);
  const body = picture.replace(/^num\{/i, '').replace(/\}$/, '');
  const decMatch = body.match(/\.([9#zZ]+)/);
  const decimals = decMatch ? decMatch[1].length : 0;
  const negative = num < 0;
  let out = Math.abs(num).toFixed(decimals);
  if (body.includes(',')) {
    const [intp, frac = ''] = out.split('.');
    const grouped = intp.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    out = frac ? `${grouped}.${frac}` : grouped;
  }
  const prefix = body.startsWith('$') ? '$' : '';
  return negative ? `-${prefix}${out}` : `${prefix}${out}`;
}

function applyPictureFormat(picture: string, value: unknown): string {
  if (!picture) return strValue(value);

  const numMatch = picture.match(/^num\{(.+)\}$/i);
  if (numMatch) return formatNumericPicture(numMatch[1], value);
  const dateMatch = picture.match(/^date\{(.+)\}$/i);
  if (dateMatch) return applyDatePicture(dateMatch[1], value);
  const timeMatch = picture.match(/^time\{(.+)\}$/i);
  if (timeMatch) return applyTimePicture(timeMatch[1], value);
  if (/^text\{/i.test(picture)) return strValue(value);

  const kinds = pictureKinds(picture);
  if (kinds.numeric) return formatNumericPicture(picture, value);
  if (kinds.date) return applyDatePicture(picture, value);
  if (kinds.time) return applyTimePicture(picture, value);
  return strValue(value);
}

function coerceToDate(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return xfaDateFromDays(value);
  const str = String(value ?? '');
  const m8 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m8) return new Date(+m8[1], +m8[2] - 1, +m8[3], 12);
  const p = parseDateWithPicture(str, 'YYYY-MM-DD');
  if (p) return new Date(p.y!, p.mo! - 1, p.d!, 12);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function applyDatePicture(picture: string, value: unknown): string {
  const d = coerceToDate(value);
  if (!d) return strValue(value);
  return formatWithPicture(d, picture);
}

function applyTimePicture(picture: string, value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value;
    const h = Math.floor(ms / 3600000) % 24;
    const mi = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    const base = new Date(2000, 0, 1, h, mi, s);
    return formatWithPicture(base, picture, Math.floor(ms) % 1000);
  }
  const p = parseDateWithPicture(String(value ?? ''), picture);
  if (p && p.H !== null) {
    const base = new Date(2000, 0, 1, p.H, p.M ?? 0, p.S ?? 0);
    return formatWithPicture(base, picture, p.ms);
  }
  return strValue(value);
}

function parsePictureFormat(picture: string, str: string): unknown {
  if (!picture) return str;
  const kinds = pictureKinds(picture);
  if (kinds.numeric) {
    const n = numericFromPicture(picture, str);
    return typeof n === 'number' ? n : str;
  }
  const parsed = parseDateWithPicture(str, picture);
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

function anyNull(args: unknown[]): boolean {
  return args.some((a) => a === null || a === undefined);
}

function pmtFormula(pv: number, r: number, n: number): number {
  if (r === 0) return pv / n;
  const growth = Math.pow(1 + r, n);
  return (pv * growth * r) / (growth - 1);
}

function loanWindow(
  principal: number,
  annualRate: number,
  monthlyPayment: number,
  firstMonth: number,
  months: number,
  kind: 'interest' | 'principal'
): number {
  const r = annualRate / 12;
  if (monthlyPayment <= principal * r) return 0;
  let bal = principal;
  const total = Math.trunc(months);
  const start = Math.max(1, Math.trunc(firstMonth));
  let sum = 0;
  const last = start + total;
  for (let m = 1; m < last; m++) {
    if (bal <= 0) break;
    const interest = bal * r;
    const principalPaid = monthlyPayment - interest;
    if (m >= start) {
      sum += kind === 'interest' ? interest : Math.max(0, principalPaid);
    }
    bal -= principalPaid;
  }
  return sum;
}

function pow1p(r: number, n: number): number {
  let acc = 1;
  const nn = Math.trunc(n);
  for (let i = 0; i < nn; i++) acc *= 1 + r;
  return acc;
}

function paymentAt(pv: number, r: number, n: number): number {
  const fv = pow1p(r, n);
  return pv / ((1 - 1 / fv) / r);
}

function aprFormula(principal: number, payment: number, n: number): number {
  const ni = Math.trunc(n);
  const base = principal / ni;
  let x = 0.05;
  let y = paymentAt(principal, x, ni);
  for (let i = 1; i <= 500; i++) {
    if (Number.isNaN(y) || y === base) return 0;
    x = x * ((payment - base) / (y - base));
    y = paymentAt(principal, x, ni);
    if (Math.abs(payment - y) < 0.005) break;
  }
  if (Number.isNaN(y) || y === base) return 0;
  return x * 12;
}

const BUILTIN_FUNCTIONS: Record<string, (args: unknown[], env: FormCalcEnv) => unknown> = {
  abs: (args) => Math.abs(toNumber(args[0])),
  avg: (args) => {
    const nums = nonNullValues(args).map(toNumber);
    if (nums.length === 0) return 0;
    return nums.reduce((s, v) => s + v, 0) / nums.length;
  },
  ceil: (args) => Math.ceil(toNumber(args[0])),
  floor: (args) => Math.floor(toNumber(args[0])),
  round: (args) => {
    const val = toNumber(args[0]);
    let places = 0;
    if (args.length > 1 && args[1] != null) {
      const p = toNumber(args[1]);
      if (Number.isFinite(p)) places = Math.trunc(p);
    }
    if (places < 0) places = 0;
    if (places > 12) places = 12;
    if (places === 0) {
      let r = Math.floor(val + 0.5);
      if (r < 0) r = -r;
      const out = r * (val >= 0 ? 1 : -1);
      return out === 0 ? 0 : out;
    }
    return Number(val.toFixed(places));
  },
  max: (args) => {
    const nums = nonNullValues(args).map(toNumber);
    if (nums.length === 0) return 0;
    return Math.max(...nums);
  },
  min: (args) => {
    const nums = nonNullValues(args).map(toNumber);
    if (nums.length === 0) return 0;
    return Math.min(...nums);
  },
  pow: (args) => Math.pow(toNumber(args[0]), toNumber(args[1])),
  sqrt: (args) => Math.sqrt(toNumber(args[0])),
  sin: (args) => Math.sin(toNumber(args[0])),
  cos: (args) => Math.cos(toNumber(args[0])),
  tan: (args) => Math.tan(toNumber(args[0])),
  asin: (args) => Math.asin(toNumber(args[0])),
  acos: (args) => Math.acos(toNumber(args[0])),
  atan: (args) => Math.atan(toNumber(args[0])),
  atan2: (args) => Math.atan2(toNumber(args[0]), toNumber(args[1])),
  exp: (args) => Math.exp(toNumber(args[0])),
  ln: (args) => Math.log(toNumber(args[0])),
  log: (args) => Math.log(toNumber(args[0])),
  log10: (args) => Math.log10(toNumber(args[0])),
  sign: (args) => Math.sign(toNumber(args[0])),
  random: () => Math.random(),
  mod: (args) => toNumber(args[0]) % toNumber(args[1]),

  sum: (args) => nonNullValues(args).reduce<number>((s, v) => s + toNumber(v), 0),
  count: (args) => nonNullValues(args).length,

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

  date: (args) => {
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
      parsed = parseDateWithPicture(src, strValue(args[1]));
    } else {
      parsed = parseDateWithPicture(src, 'MMM D, YYYY');
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

  frac: (args) => {
    const n = toNumber(args[0]);
    return n - Math.floor(n);
  },
  integer: (args) => Math.floor(toNumber(args[0])),
  float: (args) => toNumber(args[0]),

  hasvalue: (args) => {
    const v = args[0];
    return v !== null && v !== undefined && strValue(v).trim() !== '' ? 1 : 0;
  },
  hasfinish: () => 0,
  isempty: (args) => (isNullish(args[0]) ? 1 : 0),
  isnan: (args) => (Number.isNaN(toNumber(args[0])) && typeof args[0] === 'number' ? 1 : 0),
  isnull: (args) => (args[0] === null || args[0] === undefined ? 1 : 0),
  issigned: () => 0,

  null: () => null,
  appear: (args) => args[0] ?? args[1],
  oneof: (args) => {
    const flat = flattenArgs(args);
    const val = flat[0];
    for (let i = 1; i < flat.length; i++) {
      if (val === flat[i]) return 1;
      if (
        !isNullish(val) &&
        !isNullish(flat[i]) &&
        typeof val !== 'string' &&
        typeof flat[i] !== 'string' &&
        toNumber(val) === toNumber(flat[i]) &&
        !isNullish(flat[i])
      )
        return 1;
    }
    return 0;
  },
  choose: (args) => {
    if (args[0] === null || args[0] === undefined) return null;
    const n = Math.floor(toNumber(args[0]));
    if (n < 1 || n > args.length - 1) return '';
    return args[n];
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

  exists: (args) => (args[0] !== null && args[0] !== undefined ? 1 : 0),
  within: (args) => {
    const val = toNumber(args[0]);
    const low = toNumber(args[1]);
    const high = toNumber(args[2]);
    return val >= low && val <= high ? 1 : 0;
  },

  get: () => '',
  put: () => '',
  post: () => '',

  num2date: (args) => {
    const num = toNumber(args[0]);
    if (!Number.isFinite(num)) return NaN;
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'MMM D, YYYY';
    return formatWithPicture(xfaDateFromDays(num), picture);
  },
  date2num: (args) => {
    const dateStr = strValue(args[0]);
    if (args.length > 1 && args[1] != null) {
      const parsed = parseDateWithPicture(dateStr, strValue(args[1]));
      if (!parsed || parsed.y === null || parsed.mo === null || parsed.d === null) return 0;
      return daysSinceXfaEpoch(parsed.y, parsed.mo, parsed.d);
    }
    const direct = parseDateWithPicture(dateStr, 'MMM D, YYYY');
    if (direct && direct.y !== null && direct.mo !== null && direct.d !== null) {
      return daysSinceXfaEpoch(direct.y, direct.mo, direct.d);
    }
    const d = parseDateHeuristic(dateStr);
    if (!d) return 0;
    return daysSinceXfaEpoch(d.getFullYear(), d.getMonth() + 1, d.getDate());
  },
  num2time: (args) => {
    const num = toNumber(args[0]);
    if (!Number.isFinite(num)) return NaN;
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'H:MM:SS A';
    const h = Math.floor(num / 3600000) % 24;
    const mi = Math.floor(num / 60000) % 60;
    const s = Math.floor(num / 1000) % 60;
    return formatWithPicture(new Date(2000, 0, 1, h, mi, s), picture, Math.floor(num) % 1000);
  },
  time2num: (args) => {
    const timeStr = strValue(args[0]);
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'H:MM:SS A';
    const parsed = parseDateWithPicture(timeStr, picture);
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
  num2gmtime: (args) => {
    const num = toNumber(args[0]);
    if (!Number.isFinite(num)) return NaN;
    const picture = args.length > 1 && args[1] != null ? strValue(args[1]) : 'H:MM:SS A';
    const total = Math.floor(num);
    const epochMs = XFA_EPOCH_UTC + total;
    const u = new Date(epochMs);
    const base = new Date(2000, 0, 1, u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
    let out = formatWithPicture(base, picture, u.getUTCMilliseconds());
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
  datefmt: (args) => {
    const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
    const styles = ['MMM D, YYYY', 'M/D/YY', 'MMM D, YYYY', 'MMMM D, YYYY', 'EEEE, MMMM D, YYYY'];
    return styles[n >= 0 && n < styles.length ? n : 0];
  },
  timefmt: (args) => {
    const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
    const styles = ['h:mm:ss a', 'h:mm a', 'HH:mm:ss', 'HH:mm:ss z', "HH' h 'mm z"];
    return styles[n >= 0 && n < styles.length ? n : 0];
  },
  numfmt: (args) => {
    const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
    const styles = ['999,999.99', '9999', '999,999.999', '999999', '999,999.99'];
    return styles[n >= 0 && n < styles.length ? n : 0];
  },
  datetimefmt: (args) => {
    const n = args.length && args[0] != null ? Math.trunc(toNumber(args[0])) : 0;
    const d = BUILTIN_FUNCTIONS['datefmt']!([n], new FormCalcEnv());
    const t = BUILTIN_FUNCTIONS['timefmt']!([n], new FormCalcEnv());
    return `${d} ${t}`;
  },

  format: (args) => applyPictureFormat(strValue(args[0]), args[1]),
  parse: (args) => parsePictureFormat(strValue(args[0]), strValue(args[1])),

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
  pi: () => Math.PI,
  deg2rad: (args) => (toNumber(args[0]) * Math.PI) / 180,
  rad2deg: (args) => (toNumber(args[0]) * 180) / Math.PI,

  page: () => 1,
  presence: () => 'visible',

  if: (args) => (formCalcTruthy(args[0]) ? args[1] : args.length > 2 ? args[2] : null),

  wordnum: (args) =>
    wordNum(toNumber(args[0]), args.length > 1 && args[1] != null ? toNumber(args[1]) : 0),

  apr: (args) => {
    if (anyNull(args)) return null;
    const principal = toNumber(args[0]);
    const payment = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (principal <= 0 || payment <= 0 || !(Math.trunc(nper) >= 1)) return NaN;
    return aprFormula(principal, payment, nper);
  },
  cterm: (args) => {
    if (anyNull(args)) return null;
    const rate = toNumber(args[0]);
    const fv = toNumber(args[1]);
    const pv = toNumber(args[2]);
    if (rate <= 0 || fv <= 0 || pv <= 0) return NaN;
    return Math.log(fv / pv) / Math.log(1 + rate);
  },
  fv: (args) => {
    if (anyNull(args)) return null;
    const payment = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (payment <= 0 || nper <= 0 || rate < 0) return NaN;
    if (rate === 0) return payment * nper;
    return (payment * (Math.pow(1 + rate, nper) - 1)) / rate;
  },
  ipmt: (args) => {
    if (anyNull(args)) return null;
    const [principal, rate, payment, firstMonth, months] = args.map(toNumber);
    if (principal <= 0 || rate <= 0 || payment <= 0 || firstMonth < 0 || months < 0) return NaN;
    return loanWindow(principal, rate, payment, firstMonth, months, 'interest');
  },
  ppmt: (args) => {
    if (anyNull(args)) return null;
    const [principal, rate, payment, firstMonth, months] = args.map(toNumber);
    if (principal <= 0 || rate <= 0 || payment <= 0 || firstMonth < 0 || months < 0) return NaN;
    return loanWindow(principal, rate, payment, firstMonth, months, 'principal');
  },
  npv: (args) => {
    if (anyNull(args)) return null;
    const rate = toNumber(args[0]);
    if (rate <= 0) return NaN;
    const flows = flattenArgs(args.slice(1));
    let npv = 0;
    for (let i = 0; i < flows.length; i++) {
      npv += toNumber(flows[i]) / Math.pow(1 + rate, i + 1);
    }
    return npv;
  },
  pmt: (args) => {
    if (anyNull(args)) return null;
    const principal = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (principal <= 0 || nper <= 0 || rate < 0) return NaN;
    return pmtFormula(principal, rate, nper);
  },
  pv: (args) => {
    if (anyNull(args)) return null;
    const payment = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (nper <= 0 || rate < 0) return NaN;
    if (rate === 0) return payment * nper;
    return (payment * (1 - Math.pow(1 + rate, -nper))) / rate;
  },
  rate: (args) => {
    if (anyNull(args)) return null;
    const fv = toNumber(args[0]);
    const pv = toNumber(args[1]);
    const nper = toNumber(args[2]);
    if (fv <= 0 || pv <= 0 || nper <= 0) return NaN;
    return Math.pow(fv / pv, 1 / nper) - 1;
  },
  term: (args) => {
    if (anyNull(args)) return null;
    const payment = toNumber(args[0]);
    const rate = toNumber(args[1]);
    const fv = toNumber(args[2]);
    if (payment <= 0 || rate <= 0 || fv <= 0) return NaN;
    return Math.log(1 + (fv * rate) / payment) / Math.log(1 + rate);
  },
};

export class FormCalcEvaluator {
  private env = new FormCalcEnv();
  private fieldAccessor: FieldAccessor;
  private modifiedFields: string[] = [];
  private recursionDepth = 0;
  private lastValue: unknown = undefined;
  private maxRecursionDepth = 50;
  private strictIdentifiers: boolean;

  constructor(fieldAccessor: FieldAccessor, options?: FormCalcEvaluatorOptions) {
    this.fieldAccessor = fieldAccessor;
    this.strictIdentifiers = options?.strictIdentifiers ?? false;
  }

  evaluate(program: Program): FormCalcResult {
    this.modifiedFields = [];
    this.recursionDepth = 0;
    this.lastValue = undefined;
    try {
      this.execBlock(program.body);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        this.lastValue = sanitizeValue(e.value);
      } else if (e instanceof BreakSignal || e instanceof ContinueSignal) {
        throw new FormCalcError('Break/Continue outside of loop', FORMCALC_ERR.NOT_IN_LOOP);
      } else if (e instanceof ArithmeticSignal) {
        this.lastValue = 0;
      } else {
        throw e;
      }
    }
    return { value: sanitizeValue(this.lastValue), modifiedFields: [...this.modifiedFields] };
  }

  evaluateExpression(node: FormCalcNode): unknown {
    return this.evalSafe(node);
  }

  private execBlock(stmts: FormCalcNode[]): void {
    for (const stmt of stmts) {
      this.exec(stmt);
    }
  }

  private exec(node: FormCalcNode): void {
    switch (node.type) {
      case 'ExprStmt':
        this.lastValue = this.evalSafe((node as ExprStmt).expr);
        break;
      case 'IfStmt':
        this.execIf(node as IfStmt);
        break;
      case 'ForStmt':
        this.execFor(node as ForStmt);
        break;
      case 'ForEachStmt':
        this.execForEach(node as ForEachStmt);
        break;
      case 'WhileStmt':
        this.execWhile(node as WhileStmt);
        break;
      case 'RepeatStmt':
        this.execRepeat(node as RepeatStmt);
        break;
      case 'VarDecl':
        this.execVarDecl(node as VarDecl);
        break;
      case 'AssignExpr':
        try {
          this.evalAssign(node as AssignExpr);
        } catch (e) {
          if (!(e instanceof ArithmeticSignal)) throw e;
        }
        break;
      case 'BreakStmt':
        throw new BreakSignal();
      case 'ContinueStmt':
        throw new ContinueSignal();
      case 'ReturnStmt': {
        const rv = node as ReturnStmt;
        throw new ReturnSignal(rv.value ? this.evalSafe(rv.value) : undefined);
      }
      default:
        this.evalSafe(node);
        break;
    }
  }

  private execIf(node: IfStmt): void {
    if (formCalcTruthy(this.evalSafe(node.condition))) {
      this.env.pushScope();
      this.execBlock(node.thenBranch);
      this.env.popScope();
      return;
    }
    for (const elif of node.elseIfBranches) {
      if (formCalcTruthy(this.evalSafe(elif.condition))) {
        this.env.pushScope();
        this.execBlock(elif.body);
        this.env.popScope();
        return;
      }
    }
    if (node.elseBranch) {
      this.env.pushScope();
      this.execBlock(node.elseBranch);
      this.env.popScope();
    }
  }

  private execFor(node: ForStmt): void {
    this.env.pushScope();
    const start = toNumber(this.evalSafe(node.start));
    const end = toNumber(this.evalSafe(node.end));
    const step = node.step ? toNumber(this.evalSafe(node.step)) : node.isDownto ? -1 : 1;

    if (node.isDownto) {
      for (let i = start; i >= end; i += step) {
        this.env.define(node.variable, i);
        try {
          this.execBlock(node.body);
        } catch (e) {
          if (e instanceof BreakSignal) break;
          if (e instanceof ContinueSignal) continue;
          throw e;
        }
      }
    } else {
      for (let i = start; i <= end; i += step) {
        this.env.define(node.variable, i);
        try {
          this.execBlock(node.body);
        } catch (e) {
          if (e instanceof BreakSignal) break;
          if (e instanceof ContinueSignal) continue;
          throw e;
        }
      }
    }
    this.env.popScope();
  }

  private execForEach(node: ForEachStmt): void {
    const iterable = this.evalSafe(node.iterable);
    const items = Array.isArray(iterable) ? iterable : isNullish(iterable) ? [] : [iterable];
    this.env.pushScope();
    for (const item of items) {
      this.env.define(node.variable, item);
      try {
        this.execBlock(node.body);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    }
    this.env.popScope();
  }

  private execWhile(node: WhileStmt): void {
    this.env.pushScope();
    let iterations = 0;
    while (formCalcTruthy(this.evalSafe(node.condition))) {
      if (++iterations > 100000)
        throw new FormCalcError('While loop exceeded maximum iterations', FORMCALC_ERR.ARITHMETIC);
      try {
        this.execBlock(node.body);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    }
    this.env.popScope();
  }

  private execRepeat(node: RepeatStmt): void {
    this.env.pushScope();
    let iterations = 0;
    do {
      if (++iterations > 100000)
        throw new FormCalcError('Repeat loop exceeded maximum iterations', FORMCALC_ERR.ARITHMETIC);
      try {
        this.execBlock(node.body);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    } while (!formCalcTruthy(this.evalSafe(node.condition)));
    this.env.popScope();
  }

  private execVarDecl(node: VarDecl): void {
    const value = node.initializer ? this.evalSafe(node.initializer) : null;
    this.env.define(node.name, coerceScriptVar(value));
  }

  private evalAssign(node: AssignExpr): void {
    const value = this.evalSafe(node.value);
    if (node.target.type === 'FieldRef') {
      const fr = node.target as FieldRef;
      let current = this.fieldAccessor.getField(fr.path, fr.prefix);
      if (fr.index !== undefined) {
        current = undefined;
      }
      const newVal = this.computeAssignedValue(node.operator, current, value);
      if (typeof newVal === 'number' && !Number.isFinite(newVal)) {
        throw new ArithmeticSignal();
      }
      this.fieldAccessor.setField(fr.path, fr.prefix, coerceScriptVar(newVal));
      this.modifiedFields.push(fr.path);
    } else if (node.target.type === 'Identifier') {
      const id = node.target as Identifier;
      if (
        !this.env.has(id.name) &&
        isSelfProperty(id.name) &&
        this.fieldAccessor.getCurrentKey?.()
      ) {
        const current = this.fieldAccessor.getField(`.${id.name}`, '$');
        const newVal = this.computeAssignedValue(node.operator, current, value);
        this.fieldAccessor.setField(`.${id.name}`, '$', coerceScriptVar(newVal));
        this.modifiedFields.push(`.${id.name}`);
        return;
      }
      if (!this.env.has(id.name) && this.fieldAccessor.hasField?.(id.name)) {
        const current = this.fieldAccessor.getField(id.name, '$');
        const newVal = this.computeAssignedValue(node.operator, current, value);
        if (typeof newVal === 'number' && !Number.isFinite(newVal)) {
          throw new ArithmeticSignal();
        }
        this.fieldAccessor.setField(id.name, '$', coerceScriptVar(newVal));
        this.modifiedFields.push(id.name);
      } else {
        const current = this.env.get(id.name);
        const newVal = this.computeAssignedValue(node.operator, current, value);
        if (typeof newVal === 'number' && !Number.isFinite(newVal)) {
          throw new ArithmeticSignal();
        }
        this.env.set(id.name, coerceScriptVar(newVal));
      }
    } else if (node.target.type === 'PropAccess') {
      const pa = node.target as PropAccess;
      const base = this.eval(pa.object);
      if (this.isXfaNodeHandle(base) && (pa.property === 'value' || pa.property === 'rawValue')) {
        const current = this.evalPropAccess(pa.object, pa.property);
        const newVal = this.computeAssignedValue(node.operator, current, value);
        if (typeof newVal === 'number' && !Number.isFinite(newVal)) {
          throw new ArithmeticSignal();
        }
        this.fieldAccessor.setField(base.som, '$', coerceScriptVar(newVal));
        this.modifiedFields.push(base.som);
      }
    }
  }

  private computeAssignedValue(
    operator: AssignExpr['operator'],
    current: unknown,
    value: unknown
  ): unknown {
    switch (operator) {
      case '=':
        return value;
      case '+=':
        return toNumber(current) + toNumber(value);
      case '-=':
        return toNumber(current) - toNumber(value);
      case '*=':
        return toNumber(current) * toNumber(value);
      case '/=':
        return toNumber(current) / toNumber(value);
      case '~=':
      case '&=':
      case '\\=':
        return strValue(current) + strValue(value);
      case '^=':
        return Math.pow(toNumber(current), toNumber(value));
      default:
        return value;
    }
  }

  private evalSafe(node: FormCalcNode): unknown {
    try {
      return sanitizeValue(this.eval(node));
    } catch (e) {
      if (e instanceof ArithmeticSignal) return 0;
      throw e;
    }
  }

  private eval(node: FormCalcNode): unknown {
    switch (node.type) {
      case 'Literal':
        return (node as Literal).value;
      case 'Identifier': {
        const name = (node as Identifier).name;
        if (this.env.has(name)) return this.env.get(name);
        if (isSelfProperty(name) && this.fieldAccessor.getCurrentKey?.()) {
          return this.fieldAccessor.getField(`.${name}`, '$');
        }
        if (this.strictIdentifiers) {
          if (this.fieldAccessor.hasField?.(name)) return this.fieldAccessor.getField(name, '$');
          throw new FormCalcError(`Unknown identifier: ${name}`, FORMCALC_ERR.SYNTAX);
        }
        return this.fieldAccessor.getField(name, '$');
      }
      case 'FieldRef':
        return this.evalFieldRef(node as FieldRef);
      case 'OrExpr': {
        const l = this.eval((node as OrExpr).left);
        const r = this.eval((node as OrExpr).right);
        if (isNullish(l) && isNullish(r)) return null;
        return formCalcTruthy(l) || formCalcTruthy(r) ? 1 : 0;
      }
      case 'XorExpr':
        return formCalcTruthy(this.eval((node as XorExpr).left)) !==
          formCalcTruthy(this.eval((node as XorExpr).right))
          ? 1
          : 0;
      case 'AndExpr': {
        const l = this.eval((node as AndExpr).left);
        const r = this.eval((node as AndExpr).right);
        if (isNullish(l) && isNullish(r)) return null;
        return formCalcTruthy(l) && formCalcTruthy(r) ? 1 : 0;
      }
      case 'NotExpr':
        return formCalcTruthy(this.eval((node as NotExpr).operand)) ? 0 : 1;
      case 'CompareExpr':
        return this.evalCompare(node as CompareExpr);
      case 'ConcatExpr': {
        const l = this.eval((node as ConcatExpr).left);
        const r = this.eval((node as ConcatExpr).right);
        return strValue(l) + strValue(r);
      }
      case 'AddExpr': {
        const ae = node as AddExpr;
        const l = this.eval(ae.left);
        const r = this.eval(ae.right);
        const result = ae.operator === '+' ? addValues(l, r) : toNumber(l) - toNumber(r);
        if (typeof result === 'number' && !Number.isFinite(result)) throw new ArithmeticSignal();
        return result;
      }
      case 'MulExpr': {
        const me = node as MulExpr;
        const l = this.eval(me.left);
        const r = this.eval(me.right);
        let result: number;
        switch (me.operator) {
          case '*':
            result = toNumber(l) * toNumber(r);
            break;
          case '/':
            result = toNumber(l) / toNumber(r);
            break;
          case '\\':
            result = Math.floor(toNumber(l) / toNumber(r));
            break;
          case 'mod':
            result = toNumber(l) % toNumber(r);
            break;
          default:
            result = 0;
        }
        if (!Number.isFinite(result)) throw new ArithmeticSignal();
        return result;
      }
      case 'PowerExpr': {
        const result = Math.pow(
          toNumber(this.eval((node as PowerExpr).base)),
          toNumber(this.eval((node as PowerExpr).exponent))
        );
        if (!Number.isFinite(result)) throw new ArithmeticSignal();
        return result;
      }
      case 'UnaryExpr': {
        const ue = node as UnaryExpr;
        const val = toNumber(this.eval(ue.operand));
        const result = ue.operator === '-' ? -val : val;
        if (!Number.isFinite(result)) throw new ArithmeticSignal();
        return result;
      }
      case 'CallExpr':
        return this.evalCall(node as CallExpr);
      case 'PropAccess': {
        const pa = node as PropAccess;
        return this.evalPropAccess(pa.object, pa.property);
      }
      case 'AssignExpr':
        this.evalAssign(node as AssignExpr);
        return undefined;
      case 'VarDecl':
        this.execVarDecl(node as VarDecl);
        return undefined;
      default:
        return undefined;
    }
  }

  private evalFieldRef(node: FieldRef): unknown {
    return this.fieldAccessor.getField(node.path, node.prefix);
  }

  private isXfaNodeHandle(v: unknown): v is { __xfaNode: true; som: string; value: unknown } {
    return typeof v === 'object' && v !== null && (v as Record<string, unknown>).__xfaNode === true;
  }

  private evalPropAccess(object: FormCalcNode, property: string): unknown {
    const base = this.eval(object);
    if (base == null) return null;
    if (this.isXfaNodeHandle(base)) {
      switch (property) {
        case 'value':
        case 'rawValue':
          return base.value == null ? null : base.value;
        case 'name': {
          const leaf = base.som.split('.').pop() ?? '';
          return leaf.replace(/\[.*\]$/, '');
        }
        case 'presence':
          return 'visible';
        default:
          return null;
      }
    }
    if (typeof base === 'object') {
      const v = (base as Record<string, unknown>)[property];
      return v === undefined ? null : v;
    }
    return null;
  }

  private evalCompare(node: CompareExpr): number {
    let op = node.operator;
    switch (op) {
      case '==':
      case 'eq':
        op = '=';
        break;
      case 'ne':
        op = '<>';
        break;
      case 'gt':
        op = '>';
        break;
      case 'ge':
        op = '>=';
        break;
      case 'lt':
        op = '<';
        break;
      case 'le':
        op = '<=';
        break;
      default:
        break;
    }
    const left = this.eval(node.left);
    const right = this.eval(node.right);

    const lNull = isNullish(left);
    const rNull = isNullish(right);
    if (lNull || rNull) {
      if (lNull && rNull) {
        switch (op) {
          case '=':
          case '<=':
          case '>=':
            return 1;
          case '<>':
            return 0;
          default:
            return 0;
        }
      }
      switch (op) {
        case '=':
        case '<=':
        case '>=':
          return 0;
        case '<>':
          return 1;
        default:
          return 0;
      }
    }

    if (typeof left === 'string' && typeof right === 'string') {
      const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
      if ((op === '=' || op === '<>') && numeric.test(left.trim()) && numeric.test(right.trim())) {
        const equal = Number(left.trim()) === Number(right.trim());
        return op === '=' ? (equal ? 1 : 0) : equal ? 0 : 1;
      }
      switch (op) {
        case '=':
          return left === right ? 1 : 0;
        case '<>':
          return left !== right ? 1 : 0;
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
      }
    }

    const l = toNumber(left);
    const r = toNumber(right);
    const lNaN = Number.isNaN(l);
    const rNaN = Number.isNaN(r);
    if (lNaN || rNaN) {
      const bothNaN = lNaN && rNaN;
      switch (op) {
        case '=':
          return bothNaN ? 1 : 0;
        case '<>':
          return bothNaN ? 0 : 1;
        case '<=':
        case '>=':
          return bothNaN ? 1 : 0;
        default:
          return 0;
      }
    }
    switch (op) {
      case '=':
        return l === r ? 1 : 0;
      case '<>':
        return l !== r ? 1 : 0;
      case '<':
        return l < r ? 1 : 0;
      case '<=':
        return l <= r ? 1 : 0;
      case '>':
        return l > r ? 1 : 0;
      case '>=':
        return l >= r ? 1 : 0;
    }
    return 0;
  }

  private evalCall(node: CallExpr): unknown {
    if (++this.recursionDepth > this.maxRecursionDepth) {
      throw new FormCalcError('Maximum recursion depth exceeded', FORMCALC_ERR.SYNTAX);
    }
    try {
      const funcName = node.name.toLowerCase();
      const args = node.args.map((a) => this.eval(a));

      if (funcName === 'xfa.resolvenode') {
        return this.evalXfaResolveNode(args[0]);
      }

      if (funcName === 'eval') {
        const src = strValue(args[0]);
        const program = new FormCalcParser(src).parse();
        const sub = new FormCalcEvaluator(this.fieldAccessor, { strictIdentifiers: true });
        const result = sub.evaluate(program);
        return sanitizeValue(result.value);
      }

      let builtin = BUILTIN_FUNCTIONS[funcName];
      if (!builtin && funcName.includes('.')) {
        builtin =
          BUILTIN_FUNCTIONS[funcName.replace(/\./g, '')] ??
          BUILTIN_FUNCTIONS[funcName.slice(funcName.lastIndexOf('.') + 1)];
      }
      if (builtin) {
        return builtin(args, this.env);
      }

      throw new FormCalcError(`Unknown function: ${node.name}`, FORMCALC_ERR.UNKNOWN_FUNCTION);
    } finally {
      this.recursionDepth--;
    }
  }

  private evalXfaResolveNode(somArg: unknown): unknown {
    const som = strValue(somArg).trim();
    if (!som) return null;
    let value: unknown;
    try {
      value = this.fieldAccessor.getField(som, '$');
    } catch {
      return null;
    }
    if (value === undefined) return null;
    return { __xfaNode: true as const, som, value };
  }

  private isTruthy(val: unknown): boolean {
    return formCalcTruthy(val);
  }
}

function sanitizeValue(v: unknown): unknown {
  if (typeof v === 'number' && !Number.isFinite(v)) return 0;
  return v;
}

function addValues(l: unknown, r: unknown): unknown {
  const numLike = (v: unknown): boolean => !isNullish(v) && !Number.isNaN(Number(v));
  if (typeof l === 'number' && typeof r === 'number') return l + r;
  if (numLike(l) && numLike(r)) return Number(l) + Number(r);
  if (isNullish(l) && numLike(r)) return Number(r);
  if (isNullish(r) && numLike(l)) return Number(l);
  if (isNullish(l) && isNullish(r)) return 0;
  return strValue(l) + strValue(r);
}
