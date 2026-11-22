import { JavaScriptEngine } from '../../../../src/domain/scripting/js-engine/javascript-engine';
import { createFieldAccessor } from '../../../../src/domain/scripting/xfa-object-model';
import type { ScriptableNode } from '../../../../src/domain/scripting/script-types';

const DATA = { flag: 'yes' };

function engineFor(): JavaScriptEngine {
  const nodes = new Map<string, ScriptableNode>();
  return new JavaScriptEngine(createFieldAccessor(nodes, DATA), { enableConsole: true });
}

function run(engine: JavaScriptEngine, script: string): unknown {
  return engine.execute(script, null, 'initialize', DATA).value;
}

describe('JavaScriptEngine — sandbox isolation', () => {
  it.each([
    'xfa.constructor.constructor("return typeof process")()',
    'console.log.constructor("return process.version")()',
    'xfa.form.constructor.constructor("return typeof process")()',
    'Function("return typeof process")()',
    'eval("typeof process")',
    '[].constructor.constructor("return typeof process")()',
    'new Date().constructor.constructor("return typeof process")()',
  ])('blocks code generation through %s', (script) => {
    const engine = engineFor();
    expect(() => run(engine, script)).toThrow(/Code generation from strings disallowed/);
  });

  it('still evaluates ordinary scripts and globals', () => {
    const engine = engineFor();
    expect(run(engine, 'returnValue = [1, 2].map((n) => n * 2).join(",");')).toBe('2,4');
    expect(run(engine, 'returnValue = new Date(0).getTime();')).toBe(0);
  });
});
