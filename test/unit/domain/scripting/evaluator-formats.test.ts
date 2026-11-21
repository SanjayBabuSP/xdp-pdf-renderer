import {
  FormCalcError,
  FormCalcEvaluator,
  type FieldAccessor,
} from '../../../../src/domain/scripting/formcalc';
import { FormCalcParser } from '../../../../src/domain/scripting/formcalc/parser';
import type { FormCalcNode } from '../../../../src/domain/scripting/formcalc/ast';

function evaluateSource(
  src: string,
  fields: Record<string, unknown> = {},
  options?: { strictIdentifiers?: boolean }
): unknown {
  const accessor: FieldAccessor = {
    getField: (path: string) => fields[path],
    setField: (path: string, _prefix: string, value: unknown) => {
      fields[path] = value;
    },
    hasField: (path: string) => path in fields,
    getCurrentNode: () => null,
    getFormData: () => fields,
    setCurrentKey: () => {},
    getCurrentKey: () => null,
  };
  return new FormCalcEvaluator(accessor, options).evaluate(new FormCalcParser(src).parse()).value;
}

function evalNode(node: FormCalcNode, fields: Record<string, unknown> = {}): unknown {
  const accessor: FieldAccessor = {
    getField: (path: string) => fields[path],
    setField: () => {},
    hasField: (path: string) => path in fields,
    getCurrentNode: () => null,
    getFormData: () => fields,
  };
  return new FormCalcEvaluator(accessor).evaluateExpression(node);
}

function literal(value: string | number | boolean | null): FormCalcNode {
  const dataType =
    typeof value === 'number'
      ? 'number'
      : typeof value === 'boolean'
        ? 'boolean'
        : value === null
          ? 'null'
          : 'string';
  return { type: 'Literal', value, dataType };
}

function call(name: string, ...args: FormCalcNode[]): FormCalcNode {
  return { type: 'CallExpr', name, args };
}

describe('FormCalcEvaluator — number coercion and formatting', () => {
  it('renders NaN, infinities, signed zero and exponent notation', () => {
    expect(evaluateSource('string.num(Sqrt(-1))')).toBe('NaN');
    expect(evaluateSource('string.num("Infinity")')).toBe('Infinity');
    expect(evaluateSource('string.num("-Infinity")')).toBe('-Infinity');
    expect(evalNode(call('string.num', literal(-0)))).toBe('0');
    expect(evalNode(call('string.num', literal(1e-10)))).toBe('0.0000000001');
    expect(evalNode(call('string.num', literal(1e20)))).toBe('100000000000000000000');
    expect(evalNode(call('string.num', literal(-1.234e3)))).toBe('-1234');
  });

  it('coerces blank strings and non-primitive values to zero', () => {
    expect(evaluateSource('Abs("  ")')).toBe(0);
    expect(evaluateSource('Abs(obj)', { obj: {} })).toBe(0);
  });

  it('flattens array arguments and treats plain text pictures as text', () => {
    expect(evaluateSource('Sum(items)', { items: [1, 2, 3] })).toBe(6);
    expect(evaluateSource('Format("abc", "x")')).toBe('x');
    expect(evaluateSource('Format("", 5)')).toBe('5');
    expect(evaluateSource('Parse("9999", "abc")')).toBe('abc');
    expect(evaluateSource('Format("9999", "abc")')).toBe('0');
  });

  it('formats numbers with braced date, time and text pictures', () => {
    expect(evaluateSource('Format("date{YYYY-MM-DD}", "1996-03-15")')).toBe('1996-03-15');
    expect(evaluateSource('Format("time{HH:MM}", "12:30")')).toBe('12:30');
    expect(evaluateSource('Format("text{999-AA}", "123AB")')).toBe('123AB');
    expect(evaluateSource('Format("num{9999}", "12")')).toBe('12');
    expect(evaluateSource('Format("YYYY", 35138)')).toMatch(/^\d{4}$/);
    expect(evaluateSource('Format("YYYY", "19960315")')).toBe('1996');
  });

  it('formats date and time picture tokens', () => {
    const date = new Date(1996, 2, 15, 15, 30, 45, 123);
    const picture = 'qYYYY|JJ|MMMM|MMM|MM|M|EEEE|EEE|E|WW|w|G|HH|hh|H|h|k|K|SSS|F|A|Z|z';
    const formatted = evaluateSource(`Format("${picture}", d)`, { d: date }) as string;
    expect(formatted).toContain('1996');
    expect(formatted).toContain('March');
    expect(formatted).toContain('Friday');
    expect(formatted).toContain('AD');
    expect(formatted).toContain('GMT');
    expect(formatted).toContain('PM');
    expect(evaluateSource('Num2Time(45223123, "SSS")')).toBe('123');
    expect(evaluateSource('Format("YYYY", "not a date")')).toBe('not a date');
    expect(evaluateSource('Format("YYYY", invalidDate)', { invalidDate: new Date('bad') })).toBe(
      'Invalid Date'
    );
  });

  it('parses date picture tokens and rejects invalid values', () => {
    expect(evaluateSource('Parse("EEEE, MMMM D, YYYY", "Friday, March 15, 1996")')).toBe(
      '1996-03-15'
    );
    expect(evaluateSource('Parse("EEE D MMM YY", "Fri 15 Mar 96")')).toBe('1996-03-15');
    expect(evaluateSource('Parse("YYYY-MM-DD G", "1996-03-15 AD")')).toBe('1996-03-15');
    expect(evaluateSource('Parse("YYYY-JJJ", "1996-075")')).toBe('1996-075');
    expect(evaluateSource('Parse("YYYY-MM-DD SSS F", "1996-03-15 45 123")')).toBe(
      '1996-03-15T00:00:45'
    );
    expect(evaluateSource('Parse("HH:MM:SS A", "03:30:45 PM")')).toBe('15:30:45');
    expect(evaluateSource('Parse("HH:MM:SS A", "12:30:45 AM")')).toBe('00:30:45');
    expect(evaluateSource('Parse("YYYY/MM/DD", "1996-03-15")')).toBe('1996-03-15');
    expect(evaluateSource('Parse("\'lit\' YYYY-MM-DD", "lit 1996-03-15")')).toBe('1996-03-15');
    expect(evaluateSource('Parse("HH:MM:SS", "25:30:45")')).toBe('25:30:45');
    expect(evaluateSource('Parse("YYYY-MM-DD", "1996-13-01")')).toBe('1996-13-01');
    expect(evaluateSource('Parse("YYYY-MM-DD", "1996-02-31")')).toBe('1996-02-31');
    expect(evaluateSource('Parse("YYYY-MM-DD", "1996-03-15 extra")')).toBe('1996-03-15 extra');
    expect(evaluateSource('Parse("YYYY-MM-DD HH:MM:SS", "1996-03-15 12:30:45")')).toBe(
      '1996-03-15T12:30:45'
    );
  });

  it('parses dates heuristically and through timezone literals', () => {
    expect(evaluateSource('Date.collapse("1996/03/15")')).toBe('1996-03-15');
    expect(evaluateSource('Date.collapse("March 15, 1996")')).toBe('1996-03-15');
    expect(evaluateSource('Parse("YYYY-MM-DD z", "1996-03-15 GMT")')).toBe('1996-03-15T00:00:00');
    expect(evaluateSource('Parse("YYYY-MM-DD z", "1996-03-15 +02:00")')).toBe(
      '1996-03-15T00:00:00'
    );
  });
});

describe('FormCalcEvaluator — remaining built-in branches', () => {
  it('computes trigonometry and logarithms', () => {
    expect(evalNode(call('Sin', literal(0)))).toBe(0);
    expect(evalNode(call('Cos', literal(0)))).toBe(1);
    expect(evalNode(call('Tan', literal(0)))).toBe(0);
    expect(evalNode(call('Asin', literal(0)))).toBe(0);
    expect(evalNode(call('Acos', literal(1)))).toBe(0);
    expect(evalNode(call('Atan', literal(0)))).toBe(0);
    expect(evalNode(call('Atan2', literal(0), literal(1)))).toBe(0);
    expect(evalNode(call('Ln', literal(1)))).toBe(0);
    expect(evalNode(call('Log', literal(10)))).toBeCloseTo(Math.log(10), 10);
  });

  it('covers string edge cases and array-aware length', () => {
    expect(evaluateSource('Oneof(2, 2, 3)')).toBe(1);
    expect(evaluateSource('Substr("abc", 0, 2)')).toBe('ab');
    expect(evaluateSource('Stuff("abc", 0, 1, "X")')).toBe('Xbc');
    expect(evaluateSource('Len(items)', { items: ['ab', 'c'] })).toBe(2);
    expect(evaluateSource('Lower("AB")')).toBe('ab');
    expect(evaluateSource('Upper("ab")')).toBe('AB');
    expect(evaluateSource('LTrim("  a")')).toBe('a');
    expect(evaluateSource('RTrim("a  ")')).toBe('a');
    expect(evaluateSource('At("abc", "b")')).toBe(2);
    expect(evaluateSource('UnitValue(2, "pt")')).toBe(144);
  });

  it('covers encoding of quotes, three-byte characters and invalid entities', () => {
    expect(evalNode(call('Encode', literal('"\''), literal('html')))).toBe('&quot;&#39;');
    expect(evaluateSource('Encode("日", "url")')).toBe('%e6%97%a5');
    expect(evaluateSource('Decode("&#xZZ;", "html")')).toBe('&#xZZ;');
  });

  it('covers word rendering extremes', () => {
    expect(evaluateSource('WordNum(0)')).toBe('Zero Dollars');
    expect(evaluateSource('WordNum(1000000)')).toBe('One Million Dollars');
    expect(evaluateSource('WordNum(2000000000)')).toBe('Two Billion Dollars');
    expect(evaluateSource('WordNum(-5)')).toBe('*');
    expect(evaluateSource('WordNum(Sqrt(-1))')).toBe('********');
  });

  it('covers loan and date conversion guards', () => {
    expect(evaluateSource('IPmt(100, 0.1, 1000, 1, 5)')).toBeGreaterThan(0);
    expect(evaluateSource('Num2Date("Infinity")')).toBe(0);
    expect(evaluateSource('Date2Num("bad", "YYYY-MM-DD")')).toBe(0);
    expect(evaluateSource('Date2Num("bad")')).toBe(0);
    expect(evaluateSource('Num2Time("Infinity")')).toBe(0);
    expect(evaluateSource('Time2Num("bad")')).toBe(0);
    expect(evaluateSource('Num2GMTime("Infinity")')).toBe(0);
    expect(evaluateSource('IsoDate2Num("bad")')).toBe(0);
  });

  it('resolves builtin names by their last segment and tolerates undefined fields', () => {
    expect(evaluateSource('unknown.sin(0)')).toBe(0);
    expect(
      evalNode(call('xfa.resolveNode', literal('missing')), { missing: undefined })
    ).toBeNull();
  });
});

describe('FormCalcEvaluator — evaluator-level fallbacks', () => {
  it('evaluates literal statements and unrecognised nodes', () => {
    const accessor: FieldAccessor = {
      getField: () => null,
      setField: () => {},
      getCurrentNode: () => null,
      getFormData: () => ({}),
    };
    const evaluator = new FormCalcEvaluator(accessor);
    expect(
      evaluator.evaluate({
        type: 'Program',
        body: [
          { type: 'Unknown' } as unknown as FormCalcNode,
          { type: 'ExprStmt', expr: literal(3) },
        ],
      }).value
    ).toBe(3);
    expect(evaluator.evaluateExpression({ type: 'Program', body: [] })).toBeUndefined();
    expect(
      evaluator.evaluateExpression({ type: 'VarDecl', name: 'v', initializer: literal(4) })
    ).toBeUndefined();
  });

  it('reads XFA properties from plain objects', () => {
    expect(evalNode({ type: 'PropAccess', object: literal(null), property: 'value' })).toBeNull();
    expect(
      evalNode(
        { type: 'PropAccess', object: { type: 'Identifier', name: 'obj' }, property: 'flag' },
        { obj: { flag: true } }
      )
    ).toBe(true);
    expect(
      evalNode(
        { type: 'PropAccess', object: { type: 'Identifier', name: 'obj' }, property: 'missing' },
        { obj: {} }
      )
    ).toBeNull();
  });

  it('compares nullish operands and strings on all operators', () => {
    expect(evaluateSource('null < null')).toBe(0);
    expect(evaluateSource('null > 1')).toBe(0);
    expect(evaluateSource('"b" > "a"')).toBe(1);
    expect(evaluateSource('"b" >= "b"')).toBe(1);
    expect(evaluateSource('null + null')).toBe(0);
  });

  it('treats self properties as fields in strict identifier mode', () => {
    const fields: Record<string, unknown> = { '.rawValue': 'strict-value' };
    const accessor: FieldAccessor = {
      getField: (path: string) => fields[path],
      setField: () => {},
      hasField: () => false,
      getCurrentNode: () => null,
      getFormData: () => fields,
      getCurrentKey: () => 'self',
    };
    expect(
      new FormCalcEvaluator(accessor, { strictIdentifiers: true }).evaluateExpression({
        type: 'Identifier',
        name: 'rawValue',
      })
    ).toBe('strict-value');
  });

  it('handles break and continue in downto loops', () => {
    expect(
      evaluateSource(
        's = 0\nfor i = 5 downto 1\nif i = 3 then continue end if\nif i = 1 then break end if\ns = s + i\nendfor\ns'
      )
    ).toBe('11');
  });

  it('guards while and repeat loops against excessive iterations', () => {
    expect(() => evaluateSource('i = 0\nwhile 1\ni = i + 1\nendwhile')).toThrow(FormCalcError);
    expect(() => evaluateSource('repeat\ni = 0\nuntil 0')).toThrow(FormCalcError);
  });

  it('signals arithmetic failures for non-finite assignments and unary results', () => {
    const fields: Record<string, unknown> = { x: 0 };
    expect(evaluateSource('x = 1/0', fields)).toBeUndefined();
    expect(evaluateSource('-(1/0)')).toBe(0);
  });
});
