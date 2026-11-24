import {
  ArithmeticSignal,
  BreakSignal,
  ContinueSignal,
  FORMCALC_ERR,
  FormCalcEnv,
  FormCalcError,
  ReturnSignal,
  addValues,
  coerceScriptVar,
  formCalcTruthy,
  isNullish,
  isSelfProperty,
  sanitizeValue,
  strValue,
  toNumber,
} from './shared';
import type { FieldAccessor, FormCalcEvaluatorOptions, FormCalcResult } from './shared';
import type {
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
} from '../ast';
import { FormCalcParser } from '../parser';
import { BUILTIN_FUNCTIONS } from './builtins';

export class FormCalcEvaluator {
  private fieldAccessor: FieldAccessor;
  private modifiedFields: string[] = [];
  private recursionDepth = 0;
  private lastValue: unknown = undefined;
  private maxRecursionDepth = 50;
  private strictIdentifiers: boolean;
  private env: FormCalcEnv;

  constructor(fieldAccessor: FieldAccessor, options?: FormCalcEvaluatorOptions) {
    this.fieldAccessor = fieldAccessor;
    this.strictIdentifiers = options?.strictIdentifiers ?? false;
    this.env = new FormCalcEnv(options?.locale);
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
        const sub = new FormCalcEvaluator(this.fieldAccessor, {
          strictIdentifiers: true,
          locale: this.env.locale,
        });
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
