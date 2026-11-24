import type { XfaNode } from '../../script-types';
import { normalizeLocale } from '../../../../lib/locale-format';

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

export class BreakSignal {}
export class ContinueSignal {}
export class ReturnSignal {
  constructor(public value: unknown) {}
}
export class ArithmeticSignal {}

export class FormCalcEnv {
  private scopes: Map<string, unknown>[] = [new Map()];
  readonly locale?: string;

  constructor(locale?: string) {
    this.locale = normalizeLocale(locale);
  }

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
  locale?: string;
}

export type BuiltinFunction = (args: unknown[], env: FormCalcEnv) => unknown;
export type BuiltinFunctionMap = Record<string, BuiltinFunction>;

export function toNumber(val: unknown): number {
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

export function numStr(n: number): string {
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

export function strValue(v: unknown): string {
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

export function isSelfProperty(name: string): boolean {
  return SELF_PROPERTY_NAMES.has(name);
}

export function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

export function formCalcTruthy(val: unknown): boolean {
  const n = toNumber(val);
  return n !== 0 && !Number.isNaN(n);
}

export function coerceScriptVar(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return numStr(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return v;
}

export function flattenArgs(args: unknown[]): unknown[] {
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

export function nonNullValues(args: unknown[]): unknown[] {
  return flattenArgs(args).filter((v) => !isNullish(v));
}

export function anyNull(args: unknown[]): boolean {
  return args.some((a) => a === null || a === undefined);
}

export function sanitizeValue(v: unknown): unknown {
  if (typeof v === 'number' && !Number.isFinite(v)) return 0;
  return v;
}

export function addValues(l: unknown, r: unknown): unknown {
  const numLike = (v: unknown): boolean => !isNullish(v) && !Number.isNaN(Number(v));
  if (typeof l === 'number' && typeof r === 'number') return l + r;
  if (numLike(l) && numLike(r)) return Number(l) + Number(r);
  if (isNullish(l) && numLike(r)) return Number(r);
  if (isNullish(r) && numLike(l)) return Number(l);
  if (isNullish(l) && isNullish(r)) return 0;
  return strValue(l) + strValue(r);
}
