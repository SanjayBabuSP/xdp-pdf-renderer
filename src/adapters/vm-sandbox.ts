import * as vm from 'vm';

export interface Sandbox<T extends object> {
  globals: T;
  context: vm.Context;
}

export interface SandboxRunOptions {
  filename: string;
  timeout: number;
}

interface HostRealm {
  Object: object;
  Function: object;
  Array: object;
  Date: object;
  RegExp: object;
  objectProto: object;
  functionProto: object;
  arrayProto: object;
  dateProto: object;
  regexpProto: object;
}

const BRIDGE_SOURCE = `(() => {
  const seen = new WeakMap();
  const proto = {
    object: Object.prototype,
    function: Function.prototype,
    array: Array.prototype,
    date: Date.prototype,
    regexp: RegExp.prototype,
  };
  const host = __hostRealm;
  const intrinsics = new Map([
    [host.Object, Object],
    [host.Function, Function],
    [host.Array, Array],
    [host.Date, Date],
    [host.RegExp, RegExp],
    [host.objectProto, proto.object],
    [host.functionProto, proto.function],
    [host.arrayProto, proto.array],
    [host.dateProto, proto.date],
    [host.regexpProto, proto.regexp],
  ]);
  const protoOf = (value) => {
    if (typeof value === 'function') return proto.function;
    if (Array.isArray(value)) return proto.array;
    if (value instanceof Date) return proto.date;
    if (value instanceof RegExp) return proto.regexp;
    return proto.object;
  };
  const sandboxProtos = new Set([proto.object, proto.function, proto.array, proto.date, proto.regexp]);
  const bridge = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (seen.has(value)) return seen.get(value);
    if (intrinsics.has(value)) return intrinsics.get(value);
    if (sandboxProtos.has(Object.getPrototypeOf(value))) return value;
    const wrapped = new Proxy(value, {
      get(target, key, receiver) {
        return bridge(Reflect.get(target, key, receiver));
      },
      set(target, key, next, receiver) {
        return Reflect.set(target, key, next, receiver);
      },
    });
    seen.set(value, wrapped);
    Object.setPrototypeOf(value, protoOf(value));
    return wrapped;
  };
  return bridge;
})()`;

type Bridge = (value: unknown) => unknown;

function hostRealm(): HostRealm {
  return {
    Object,
    Function,
    Array,
    Date,
    RegExp,
    objectProto: Object.prototype,
    functionProto: Function.prototype,
    arrayProto: Array.prototype,
    dateProto: Date.prototype,
    regexpProto: RegExp.prototype,
  };
}

export function createSandbox<T extends object>(globals: T): Sandbox<T> {
  Object.setPrototypeOf(globals, null);
  const target = globals as T & { __hostRealm?: HostRealm };
  target.__hostRealm = hostRealm();
  const context = vm.createContext(globals, {
    codeGeneration: { strings: false, wasm: false },
  });
  const bridge = vm.runInContext(BRIDGE_SOURCE, context) as Bridge;
  delete target.__hostRealm;

  for (const key of Reflect.ownKeys(globals)) {
    const value = Reflect.get(globals, key);
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
    const bridged = bridge(value);
    if (bridged !== value) {
      Reflect.set(globals, key, bridged);
    }
  }

  return { globals, context };
}

export function runInSandbox<T extends object>(
  sandbox: Sandbox<T>,
  script: string,
  options: SandboxRunOptions
): void {
  vm.runInContext(script, sandbox.context, options);
}
