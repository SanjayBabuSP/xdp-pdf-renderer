import { JavaScriptEngine } from '../../../../src/domain/scripting/js-engine/javascript-engine';
import { createFieldAccessor } from '../../../../src/domain/scripting/xfa-object-model';
import type { ScriptableNode } from '../../../../src/domain/scripting/script-types';

const DATA = { flag: 'yes' };

const CODE_GENERATION_PROBES = [
  'xfa.constructor.constructor("return typeof process")()',
  'console.log.constructor("return process.version")()',
  'xfa.form.constructor.constructor("return typeof process")()',
  'Function("return typeof process")()',
  'eval("typeof process")',
  '[].constructor.constructor("return typeof process")()',
  'new Date().constructor.constructor("return typeof process")()',
  '(function(){ return this })().constructor.constructor("return typeof process")()',
  'globalThis.constructor.constructor("return typeof process")()',
  'Object.getPrototypeOf(globalThis).constructor.constructor("return typeof process")()',
  'app.constructor.constructor("return typeof process")()',
  'util.constructor.constructor("return typeof process")()',
  'FormCalc.constructor.constructor("return typeof process")()',
  'console.constructor.constructor("return typeof process")()',
  'event.constructor.constructor("return typeof process")()',
  'host.constructor.constructor("return typeof process")()',
  'xfa.datasets.constructor.constructor("return typeof process")()',
  'xfa.layout.constructor.constructor("return typeof process")()',
];

const BLOCKED_PROBES = [
  '$.constructor.constructor("return typeof process")()',
  'this.constructor.constructor("return typeof process")()',
  'xfa.record.constructor.constructor("return typeof process")()',
  'xfa.template.constructor.constructor("return typeof process")()',
];

function engineFor(): JavaScriptEngine {
  const nodes = new Map<string, ScriptableNode>();
  return new JavaScriptEngine(createFieldAccessor(nodes, DATA), { enableConsole: true });
}

function run(engine: JavaScriptEngine, script: string): unknown {
  return engine.execute(script, null, 'initialize', DATA).value;
}

describe('JavaScriptEngine — sandbox isolation', () => {
  it.each(CODE_GENERATION_PROBES)('blocks code generation through %s', (script) => {
    const engine = engineFor();
    expect(() => run(engine, script)).toThrow(/Code generation from strings disallowed/);
  });

  it.each(BLOCKED_PROBES)('blocks host access through %s', (script) => {
    const engine = engineFor();
    expect(() => run(engine, script)).toThrow();
  });

  it('uses a null-prototype or sandbox-realm global object', () => {
    const engine = engineFor();
    const script = `const p = Object.getPrototypeOf(globalThis);
      returnValue = p === null || Object.getPrototypeOf(p) === Object.prototype;`;
    expect(run(engine, script)).toBe(true);
  });

  it('still evaluates ordinary scripts and globals', () => {
    const engine = engineFor();
    expect(run(engine, 'returnValue = [1, 2].map((n) => n * 2).join(",");')).toBe('2,4');
    expect(run(engine, 'returnValue = new Date(0).getTime();')).toBe(0);
  });
});
