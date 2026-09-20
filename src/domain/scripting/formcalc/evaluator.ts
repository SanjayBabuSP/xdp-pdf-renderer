// ────────────────────────────────────────────────────────────────────────────
// FormCalc Evaluator — Walks the AST and executes FormCalc scripts
// ────────────────────────────────────────────────────────────────────────────

import {
  Program,
  FormCalcNode,
  IfStmt,
  ForStmt,
  WhileStmt,
  RepeatStmt,
  VarDecl,
  AssignExpr,
  ExprStmt,
  CallExpr,
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
  BreakStmt,
  ContinueStmt,
} from './ast';
import { XfaNode } from '../script-types';

export class FormCalcError extends Error {
  constructor(message: string) {
    super(`FormCalc Error: ${message}`);
  }
}

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(public value: unknown) {}
}

/** Environment: a stack of variable scopes */
class FormCalcEnv {
  private scopes: Map<string, unknown>[] = [new Map()];

  get(name: string): unknown {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return undefined;
  }

  set(name: string, value: unknown): void {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        this.scopes[i].set(name, value);
        return;
      }
    }
    // Not found — set in current scope
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
  /** Resolve a SOM expression to a node value */
  getField(path: string, prefix: '$' | '$$'): unknown;
  /** Set a field value by SOM path */
  setField(path: string, prefix: '$' | '$$', value: unknown): void;
  /** Get the current node being scripted */
  getCurrentNode(): XfaNode | null;
  /** Get form-level data */
  getFormData(): unknown;
}

export interface FormCalcResult {
  value: unknown;
  modifiedFields: string[];
}

/** Built-in FormCalc functions */
const BUILTIN_FUNCTIONS: Record<string, (args: unknown[], env: FormCalcEnv) => unknown> = {
  // ─── Math ────────────────────────────────────────────────────────
  abs: (args) => Math.abs(toNumber(args[0])),
  avg: (args) => {
    const arr = flattenArgs(args);
    if (arr.length === 0) return 0;
    return arr.reduce<number>((s, v) => s + toNumber(v), 0) / arr.length;
  },
  ceil: (args) => Math.ceil(toNumber(args[0])),
  floor: (args) => Math.floor(toNumber(args[0])),
  round: (args) => {
    const val = toNumber(args[0]);
    const places = args.length > 1 ? toNumber(args[1]) : 0;
    const factor = Math.pow(10, places);
    return Math.round(val * factor) / factor;
  },
  max: (args) => {
    const arr = flattenArgs(args);
    return Math.max(...arr.map(toNumber));
  },
  min: (args) => {
    const arr = flattenArgs(args);
    return Math.min(...arr.map(toNumber));
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
  log: (args) => Math.log10(toNumber(args[0])),
  sign: (args) => Math.sign(toNumber(args[0])),
  random: () => Math.random(),

  // ─── String ──────────────────────────────────────────────────────
  'string.left': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.substring(0, n);
  },
  'string.right': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.substring(s.length - n);
  },
  'string.mid': (args) => {
    const s = String(args[0] ?? '');
    const start = toNumber(args[1]) - 1; // 1-based in FormCalc
    const len = args.length > 2 ? toNumber(args[2]) : s.length;
    return s.substring(start, start + len);
  },
  'string.length': (args) => String(args[0] ?? '').length,
  'string.lower': (args) => String(args[0] ?? '').toLowerCase(),
  'string.upper': (args) => String(args[0] ?? '').toUpperCase(),
  'string.strip': (args) => String(args[0] ?? '').trim(),
  'string.leftback': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.substring(0, s.length - n);
  },
  'string.rightback': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.substring(n);
  },
  'string.wordnum': (args) => {
    const n = toNumber(args[0]);
    // Simple number-to-words for common cases
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    return String(n);
  },
  'string.apnum': (args) => String(args[0]),
  'string.ltrim': (args) => String(args[0] ?? '').replace(/^\s+/, ''),
  'string.rtrim': (args) => String(args[0] ?? '').replace(/\s+$/, ''),
  'string.num': (args) => {
    const val = args[0];
    const format = args.length > 1 ? String(args[1]) : '';
    if (typeof val === 'number') return val.toString();
    return String(val);
  },
  'string.at': (args) => {
    const s = String(args[0] ?? '');
    const substr = String(args[1] ?? '');
    const pos = s.indexOf(substr);
    return pos === -1 ? 0 : pos + 1; // 1-based in FormCalc
  },
  'string.nameat': (args) => {
    const s = String(args[0] ?? '');
    const pos = toNumber(args[1]) - 1;
    return s.charCodeAt(pos) || 0;
  },
  'string.repeat': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.repeat(n);
  },
  'string.pad': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    const ch = args.length > 2 ? String(args[2]) : ' ';
    return s.padStart(n, ch);
  },
  'string.instr': (args) => {
    const haystack = String(args[0] ?? '');
    const needle = String(args[1] ?? '');
    const start = args.length > 2 ? toNumber(args[2]) - 1 : 0;
    const pos = haystack.indexOf(needle, start);
    return pos === -1 ? 0 : pos + 1;
  },

  // ─── Date/Time ───────────────────────────────────────────────────
  'date': (args) => {
    if (args.length === 0) return formatFormCalcDate(new Date());
    const d = new Date(String(args[0]));
    return isNaN(d.getTime()) ? '' : formatFormCalcDate(d);
  },
  'time': (args) => {
    if (args.length === 0) return formatFormCalcTime(new Date());
    return formatFormCalcTime(new Date());
  },
  'datetime': (args) => {
    if (args.length === 0) return formatFormCalcDateTime(new Date());
    return formatFormCalcDateTime(new Date());
  },
  'date.collapse': (args) => {
    const d = new Date(String(args[0]));
    return isNaN(d.getTime()) ? '' : formatFormCalcDate(d);
  },
  'date.largest': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    return d.getDate();
  },
  'date.month': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    return d.getMonth() + 1;
  },
  'date.year': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    return d.getFullYear();
  },
  'date.weekday': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    return d.getDay() + 1;
  },
  'date.daysinmonth': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  },
  'date.daysinyear': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    const year = d.getFullYear();
    return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;
  },
  'date.dayofyear': (args) => {
    const d = new Date(String(args[0]));
    if (isNaN(d.getTime())) return 0;
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d.getTime() - start.getTime()) / 86400000);
  },

  // ─── Type conversion ─────────────────────────────────────────────
  'frac': (args) => {
    const n = toNumber(args[0]);
    return n - Math.floor(n);
  },
  'integer': (args) => Math.floor(toNumber(args[0])),
  'float': (args) => toNumber(args[0]),

  // ─── Is functions ────────────────────────────────────────────────
  'hasvalue': (args) => args[0] != null && String(args[0]) !== '',
  'hasfinish': () => false, // Not applicable in PDF generation
  'isempty': (args) => args[0] == null || String(args[0]) === '',
  'isnan': (args) => isNaN(toNumber(args[0])),
  'isnull': (args) => args[0] == null,
  'issigned': () => false, // No digital signatures in PDF generation

  // ─── Null handling ───────────────────────────────────────────────
  'null': () => null,
  'appear': (args) => args[0] ?? args[1],
  'oneof': (args) => {
    const val = args[0];
    for (let i = 1; i < args.length; i++) {
      if (val === args[i]) return true;
    }
    return false;
  },
  'choose': (args) => {
    const idx = toNumber(args[0]);
    return args[Math.max(1, Math.min(idx + 1, args.length - 1))];
  },

  // ─── Aggregate functions (with node-list support) ──────────────
  // Reference: jfformcalc.dll aggregate function suite
  'sum': (args) => {
    const arr = flattenArgs(args);
    return arr.reduce<number>((s, v) => s + toNumber(v), 0);
  },

  // ─── String functions (additional) ────────────────────────────
  // Reference: jfformcalc.dll string processing
  'concat': (args) => args.map((a) => String(a ?? '')).join(''),
  'substr': (args) => {
    const s = String(args[0] ?? '');
    const start = toNumber(args[1]) - 1; // 1-based in FormCalc
    const len = args.length > 2 ? toNumber(args[2]) : s.length - start;
    return s.substring(start, start + len);
  },
  'replace': (args) => {
    const s = String(args[0] ?? '');
    const old = String(args[1] ?? '');
    const newStr = String(args[2] ?? '');
    return s.split(old).join(newStr);
  },
  'space': (args) => ' '.repeat(Math.max(0, toNumber(args[0]))),
  'str': (args) => {
    const num = toNumber(args[0]);
    const width = args.length > 1 ? toNumber(args[1]) : 10;
    const precision = args.length > 2 ? toNumber(args[2]) : 0;
    const formatted = num.toFixed(precision);
    return formatted.padStart(width);
  },
  'stuff': (args) => {
    const source = String(args[0] ?? '');
    const start = toNumber(args[1]) - 1; // 1-based
    const count = toNumber(args[2]);
    const insert = String(args[3] ?? '');
    return source.substring(0, start) + insert + source.substring(start + count);
  },
  'uuid': () => {
    // Generate a UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
  'len': (args) => String(args[0] ?? '').length,
  'left': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.substring(0, n);
  },
  'right': (args) => {
    const s = String(args[0] ?? '');
    const n = toNumber(args[1]);
    return s.substring(s.length - n);
  },
  'lower': (args) => String(args[0] ?? '').toLowerCase(),
  'upper': (args) => String(args[0] ?? '').toUpperCase(),
  'ltrim': (args) => String(args[0] ?? '').replace(/^\s+/, ''),
  'rtrim': (args) => String(args[0] ?? '').replace(/\s+$/, ''),
  'at': (args) => {
    const s = String(args[0] ?? '');
    const sub = String(args[1] ?? '');
    const pos = s.indexOf(sub);
    return pos === -1 ? 0 : pos + 1;
  },

  // ─── Unit conversion ─────────────────────────────────────────────
  // Reference: jfformcalc.dll UnitValue function
  'unitvalue': (args) => {
    const value = toNumber(args[0]);
    const toUnit = args.length > 1 ? String(args[1]).toLowerCase() : 'in';
    const fromUnit = args.length > 2 ? String(args[2]).toLowerCase() : 'in';

    // Convert from source unit to points, then to target unit
    const toPt: Record<string, number> = {
      'in': 72, 'cm': 28.3465, 'mm': 2.83465, 'pt': 1, 'px': 0.75,
      'em': 12, 'pc': 12,
    };
    const fromPt = toPt[fromUnit] ?? 1;
    const targetPt = toPt[toUnit] ?? 1;
    return (value * fromPt) / targetPt;
  },

  // ─── Existence / Navigation functions ─────────────────────────────
  // Reference: jfformcalc.dll SOM-aware functions
  'exists': (args) => {
    return args[0] !== null && args[0] !== undefined;
  },
  'within': (args) => {
    const val = toNumber(args[0]);
    const low = toNumber(args[1]);
    const high = toNumber(args[2]);
    return val >= low && val <= high;
  },

  // ─── HTTP stubs (no-op in PDF generation) ─────────────────────────
  // Reference: jfformcalc.dll + jfsoap.dll web service functions
  'get': () => '',
  'put': () => '',
  'post': () => '',

  // ─── Date/Time conversion functions ───────────────────────────────
  // Reference: jfformcalc.dll date/time processing
  'num2date': (args) => {
    const num = toNumber(args[0]);
    // FormCalc dates are days since epoch (Dec 30, 1899 — XFA Julian day 0)
    const epoch = new Date(1899, 11, 30);
    const result = new Date(epoch.getTime() + num * 86400000);
    if (args.length > 1) {
      return formatWithPicture(result, String(args[1]));
    }
    return formatFormCalcDate(result);
  },
  'date2num': (args) => {
    const dateStr = String(args[0] ?? '');
    const format = args.length > 1 ? String(args[1]) : '';
    const d = parseDateWithFormat(dateStr, format);
    if (isNaN(d.getTime())) return 0;
    // Days since Dec 30, 1899
    const epoch = new Date(1899, 11, 30);
    return Math.floor((d.getTime() - epoch.getTime()) / 86400000);
  },
  'num2time': (args) => {
    const num = toNumber(args[0]);
    // FormCalc times are milliseconds since midnight
    const hours = Math.floor(num / 3600000);
    const minutes = Math.floor((num % 3600000) / 60000);
    const seconds = Math.floor((num % 60000) / 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  },
  'time2num': (args) => {
    const timeStr = String(args[0] ?? '');
    const parts = timeStr.split(':').map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return hours * 3600000 + minutes * 60000 + seconds * 1000;
  },
  'isodate2num': (args) => {
    const isoDate = String(args[0] ?? '');
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return 0;
    const epoch = new Date(1899, 11, 30);
    return Math.floor((d.getTime() - epoch.getTime()) / 86400000);
  },
  'isotime2num': (args) => {
    const isoTime = String(args[0] ?? '');
    const parts = isoTime.split(':').map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return hours * 3600000 + minutes * 60000 + seconds * 1000;
  },
  'localdatefmt': (args) => {
    const locale = args.length > 0 ? String(args[0]) : 'en_US';
    // Return common date format for locale
    if (locale.startsWith('de')) return 'DD.MM.YYYY';
    if (locale.startsWith('fr')) return 'DD/MM/YYYY';
    if (locale.startsWith('ja') || locale.startsWith('zh')) return 'YYYY/MM/DD';
    return 'MM/DD/YYYY'; // US default
  },
  'localtimefmt': (args) => {
    const locale = args.length > 0 ? String(args[0]) : 'en_US';
    // Return common time format for locale
    if (locale.startsWith('de') || locale.startsWith('fr')) return 'HH:MM:SS';
    return 'h:MM:SS A'; // US default
  },

  // ─── Formatting / Parsing with picture clauses ────────────────────
  // Reference: jfformcalc.dll picture clause processing
  'format': (args) => {
    const picture = String(args[0] ?? '');
    const value = args[1];
    return applyPictureFormat(picture, value);
  },
  'parse': (args) => {
    const picture = String(args[0] ?? '');
    const str = String(args[1] ?? '');
    return parsePictureFormat(picture, str);
  },

  // ─── PDF-specific ────────────────────────────────────────────────
  'page': () => 1, // Current page number (simplified)
  'count': (args) => flattenArgs(args).length,
  'presence': () => 'visible',

  // ─── Ternary if() function ────────────────────────────────────────
  // Reference: FormCalc supports if(cond, trueVal, falseVal) as a function
  'if': (args) => {
    const cond = args[0];
    const trueVal = args[1];
    const falseVal = args.length > 2 ? args[2] : null;
    if (cond && cond !== 0 && cond !== '' && cond !== false) {
      return trueVal;
    }
    return falseVal;
  },

  // ─── Word number (enhanced) ───────────────────────────────────────
  'wordnum': (args) => {
    const n = toNumber(args[0]);
    return numberToWords(n);
  },
};

export class FormCalcEvaluator {
  private env = new FormCalcEnv();
  private fieldAccessor: FieldAccessor;
  private modifiedFields: string[] = [];
  private recursionDepth = 0;
  private maxRecursionDepth = 50;

  constructor(fieldAccessor: FieldAccessor) {
    this.fieldAccessor = fieldAccessor;
  }

  evaluate(program: Program): FormCalcResult {
    this.modifiedFields = [];
    this.recursionDepth = 0;
    try {
      this.execBlock(program.body);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        // Return from top-level is fine
      } else if (e instanceof BreakSignal || e instanceof ContinueSignal) {
        throw new FormCalcError('Break/Continue outside of loop');
      } else {
        throw e;
      }
    }
    return { value: undefined, modifiedFields: [...this.modifiedFields] };
  }

  evaluateExpression(node: FormCalcNode): unknown {
    return this.eval(node);
  }

  private execBlock(stmts: FormCalcNode[]): void {
    for (const stmt of stmts) {
      this.exec(stmt);
    }
  }

  private exec(node: FormCalcNode): void {
    switch (node.type) {
      case 'ExprStmt':
        this.eval((node as ExprStmt).expr);
        break;
      case 'IfStmt':
        this.execIf(node as IfStmt);
        break;
      case 'ForStmt':
        this.execFor(node as ForStmt);
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
        this.evalAssign(node as AssignExpr);
        break;
      case 'BreakStmt':
        throw new BreakSignal();
      case 'ContinueStmt':
        throw new ContinueSignal();
      case 'ReturnStmt': {
        const rv = node as ReturnStmt;
        throw new ReturnSignal(rv.value ? this.eval(rv.value) : undefined);
      }
      default:
        // Expression statement
        this.eval(node);
        break;
    }
  }

  private execIf(node: IfStmt): void {
    if (this.isTruthy(this.eval(node.condition))) {
      this.env.pushScope();
      this.execBlock(node.thenBranch);
      this.env.popScope();
      return;
    }
    for (const elif of node.elseIfBranches) {
      if (this.isTruthy(this.eval(elif.condition))) {
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
    const start = toNumber(this.eval(node.start));
    const end = toNumber(this.eval(node.end));
    const step = node.step ? toNumber(this.eval(node.step)) : (node.isDownto ? -1 : 1);

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

  private execWhile(node: WhileStmt): void {
    this.env.pushScope();
    let iterations = 0;
    while (this.isTruthy(this.eval(node.condition))) {
      if (++iterations > 100000) throw new FormCalcError('While loop exceeded maximum iterations');
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
      if (++iterations > 100000) throw new FormCalcError('Repeat loop exceeded maximum iterations');
      try {
        this.execBlock(node.body);
      } catch (e) {
        if (e instanceof BreakSignal) break;
        if (e instanceof ContinueSignal) continue;
        throw e;
      }
    } while (!this.isTruthy(this.eval(node.condition)));
    this.env.popScope();
  }

  private execVarDecl(node: VarDecl): void {
    const value = node.initializer ? this.eval(node.initializer) : null;
    this.env.define(node.name, value);
  }

  private evalAssign(node: AssignExpr): void {
    const value = this.eval(node.value);
    if (node.target.type === 'FieldRef') {
      const fr = node.target as FieldRef;
      let current = this.fieldAccessor.getField(fr.path, fr.prefix);
      if (fr.index !== undefined) {
        // Array element access — simplified
        current = undefined;
      }
      let newVal: unknown;
      switch (node.operator) {
        case '=': newVal = value; break;
        case '+=': newVal = toNumber(current) + toNumber(value); break;
        case '-=': newVal = toNumber(current) - toNumber(value); break;
        case '*=': newVal = toNumber(current) * toNumber(value); break;
        case '/=': newVal = toNumber(current) / toNumber(value); break;
        case '~=': case '&=': case '\\=': newVal = String(current ?? '') + String(value ?? ''); break;
        case '^=': newVal = Math.pow(toNumber(current), toNumber(value)); break;
        default: newVal = value;
      }
      this.fieldAccessor.setField(fr.path, fr.prefix, newVal);
      this.modifiedFields.push(fr.path);
    } else if (node.target.type === 'Identifier') {
      const id = node.target as Identifier;
      let current = this.env.get(id.name);
      let newVal: unknown;
      switch (node.operator) {
        case '=': newVal = value; break;
        case '+=': newVal = toNumber(current) + toNumber(value); break;
        case '-=': newVal = toNumber(current) - toNumber(value); break;
        case '*=': newVal = toNumber(current) * toNumber(value); break;
        case '/=': newVal = toNumber(current) / toNumber(value); break;
        case '~=': case '&=': case '\\=': newVal = String(current ?? '') + String(value ?? ''); break;
        case '^=': newVal = Math.pow(toNumber(current), toNumber(value)); break;
        default: newVal = value;
      }
      this.env.set(id.name, newVal);
    }
  }

  private eval(node: FormCalcNode): unknown {
    switch (node.type) {
      case 'Literal':
        return (node as Literal).value;
      case 'Identifier':
        return this.env.get((node as Identifier).name);
      case 'FieldRef':
        return this.evalFieldRef(node as FieldRef);
      case 'OrExpr':
        return this.isTruthy(this.eval((node as OrExpr).left)) || this.isTruthy(this.eval((node as OrExpr).right));
      case 'XorExpr':
        return this.isTruthy(this.eval((node as XorExpr).left)) !== this.isTruthy(this.eval((node as XorExpr).right));
      case 'AndExpr':
        return this.isTruthy(this.eval((node as AndExpr).left)) && this.isTruthy(this.eval((node as AndExpr).right));
      case 'NotExpr':
        return !this.isTruthy(this.eval((node as NotExpr).operand));
      case 'CompareExpr':
        return this.evalCompare(node as CompareExpr);
      case 'ConcatExpr':
        return String(this.eval((node as ConcatExpr).left) ?? '') + String(this.eval((node as ConcatExpr).right) ?? '');
      case 'AddExpr': {
        const ae = node as AddExpr;
        const l = this.eval(ae.left);
        const r = this.eval(ae.right);
        return ae.operator === '+' ? toNumber(l) + toNumber(r) : toNumber(l) - toNumber(r);
      }
      case 'MulExpr': {
        const me = node as MulExpr;
        const l = this.eval(me.left);
        const r = this.eval(me.right);
        switch (me.operator) {
          case '*': return toNumber(l) * toNumber(r);
          case '/': return toNumber(l) / toNumber(r);
          case '\\': return Math.floor(toNumber(l) / toNumber(r));
          case 'mod': return toNumber(l) % toNumber(r);
          default: return 0;
        }
      }
      case 'PowerExpr':
        return Math.pow(toNumber(this.eval((node as PowerExpr).base)), toNumber(this.eval((node as PowerExpr).exponent)));
      case 'UnaryExpr': {
        const ue = node as UnaryExpr;
        const val = toNumber(this.eval(ue.operand));
        return ue.operator === '-' ? -val : val;
      }
      case 'CallExpr':
        return this.evalCall(node as CallExpr);
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

  private evalCompare(node: CompareExpr): boolean {
    const left = this.eval(node.left);
    const right = this.eval(node.right);
    // Null comparison: null = null is true, null <> anything is true (except null)
    if (left === null || right === null) {
      switch (node.operator) {
        case '=': return left === right;
        case '<>': return left !== right;
        case '<': return false;
        case '<=': return left === null && right === null;
        case '>': return false;
        case '>=': return left === null && right === null;
      }
    }
    // String comparison if both are strings
    if (typeof left === 'string' && typeof right === 'string') {
      switch (node.operator) {
        case '=': return left === right;
        case '<>': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
    }
    // Numeric comparison
    const l = toNumber(left);
    const r = toNumber(right);
    switch (node.operator) {
      case '=': return l === r;
      case '<>': return l !== r;
      case '<': return l < r;
      case '<=': return l <= r;
      case '>': return l > r;
      case '>=': return l >= r;
    }
    return false;
  }

  private evalCall(node: CallExpr): unknown {
    if (++this.recursionDepth > this.maxRecursionDepth) {
      throw new FormCalcError('Maximum recursion depth exceeded');
    }
    try {
      const funcName = node.name.toLowerCase();
      const args = node.args.map((a) => this.eval(a));

      // Check built-in functions
      const builtin = BUILTIN_FUNCTIONS[funcName] ?? BUILTIN_FUNCTIONS[funcName.replace(/\./g, '')];
      if (builtin) {
        return builtin(args, this.env);
      }

      throw new FormCalcError(`Unknown function: ${node.name}`);
    } finally {
      this.recursionDepth--;
    }
  }

  private isTruthy(val: unknown): boolean {
    if (val === null || val === undefined || val === false || val === 0 || val === '') return false;
    if (val === true) return true;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val !== '';
    return true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function formatFormCalcDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatFormCalcTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${min}:${s}`;
}

function formatFormCalcDateTime(d: Date): string {
  return `${formatFormCalcDate(d)}T${formatFormCalcTime(d)}`;
}

function formatWithPicture(d: Date, picture: string): string {
  return picture
    .replace(/YYYY/g, String(d.getFullYear()))
    .replace(/YY/g, String(d.getFullYear()).substring(2))
    .replace(/MMMM/g, d.toLocaleString('en', { month: 'long' }))
    .replace(/MMM/g, d.toLocaleString('en', { month: 'short' }))
    .replace(/MM/g, String(d.getMonth() + 1).padStart(2, '0'))
    .replace(/M(?!\w)/g, String(d.getMonth() + 1))
    .replace(/DD/g, String(d.getDate()).padStart(2, '0'))
    .replace(/D(?!\w)/g, String(d.getDate()))
    .replace(/HH/g, String(d.getHours()).padStart(2, '0'))
    .replace(/H(?!\w)/g, String(d.getHours()))
    .replace(/mm/g, String(d.getMinutes()).padStart(2, '0'))
    .replace(/ss/g, String(d.getSeconds()).padStart(2, '0'));
}

function parseDateWithFormat(dateStr: string, _format: string): Date {
  // Try ISO format first
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  // Try common formats
  const parts = dateStr.split(/[\/\-\.]/);
  if (parts.length === 3) {
    const nums = parts.map(Number);
    // Try YYYY-MM-DD
    if (nums[0] > 31) return new Date(nums[0], nums[1] - 1, nums[2]);
    // Try MM/DD/YYYY
    if (nums[2] > 31) return new Date(nums[2], nums[0] - 1, nums[1]);
    // Try DD/MM/YYYY
    return new Date(nums[2], nums[1] - 1, nums[0]);
  }
  return new Date(dateStr);
}

function applyPictureFormat(picture: string, value: unknown): string {
  if (!picture) return String(value ?? '');

  // Handle numeric picture clauses: num{zzzz,zz9.99}
  const numMatch = picture.match(/^num\{(.+)\}$/i);
  if (numMatch) {
    const pattern = numMatch[1];
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num)) return String(value ?? '');
    // Count decimal places from pattern
    const decMatch = pattern.match(/\.(\d+|9+|z+)/);
    const decimals = decMatch ? decMatch[1].length : 0;
    const formatted = num.toFixed(decimals);
    // Handle thousand separators
    if (pattern.includes(',')) {
      const parts = formatted.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }
    return formatted;
  }

  // Handle date picture clauses: date{YYYY-MM-DD}
  const dateMatch = picture.match(/^date\{(.+)\}$/i);
  if (dateMatch) {
    const d = value instanceof Date ? value : new Date(String(value));
    if (isNaN(d.getTime())) return String(value ?? '');
    return formatWithPicture(d, dateMatch[1]);
  }

  // Handle text picture clauses: text{AAAA}
  const textMatch = picture.match(/^text\{(.+)\}$/i);
  if (textMatch) {
    return String(value ?? '');
  }

  // Fallback: return as string
  return String(value ?? '');
}

function parsePictureFormat(picture: string, str: string): unknown {
  if (!picture || !str) return str;

  // Handle numeric picture: extract number from formatted string
  const numMatch = picture.match(/^num\{(.+)\}$/i);
  if (numMatch) {
    const cleaned = str.replace(/[,\s$€£¥]/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? str : num;
  }

  // Handle date picture: parse date from formatted string
  const dateMatch = picture.match(/^date\{(.+)\}$/i);
  if (dateMatch) {
    const d = new Date(str);
    return isNaN(d.getTime()) ? str : formatFormCalcDate(d);
  }

  return str;
}

/** Convert a number to English words (supports up to millions) */
function numberToWords(n: number): string {
  if (n === 0) return 'Zero';
  if (n < 0) return 'Negative ' + numberToWords(-n);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convert(num: number): string {
    if (num === 0) return '';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + convert(num % 100) : '');
    if (num < 1000000) return convert(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convert(num % 1000) : '');
    if (num < 1000000000) return convert(Math.floor(num / 1000000)) + ' Million' + (num % 1000000 ? ' ' + convert(num % 1000000) : '');
    return convert(Math.floor(num / 1000000000)) + ' Billion' + (num % 1000000000 ? ' ' + convert(num % 1000000000) : '');
  }

  const intPart = Math.floor(Math.abs(n));
  const fracPart = Math.round((Math.abs(n) - intPart) * 100);

  let result = convert(intPart);
  if (fracPart > 0) {
    result += ' and ' + convert(fracPart) + '/100';
  }

  return result;
}
