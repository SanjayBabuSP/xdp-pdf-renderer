import {
  FormCalcError,
  FormCalcEvaluator,
  formCalcTruthy,
  type FieldAccessor,
} from '../../../../src/domain/scripting/formcalc';
import { FormCalcParser } from '../../../../src/domain/scripting/formcalc/parser';
import type {
  AssignExpr,
  ConcatExpr,
  ExprStmt,
  FieldRef,
  FormCalcNode,
  Program,
} from '../../../../src/domain/scripting/formcalc/ast';

interface Setup {
  accessor: FieldAccessor;
  fields: Record<string, unknown>;
  writes: string[];
  setKey(key: string | null): void;
}

function setup(fields: Record<string, unknown> = {}): Setup {
  let currentKey: string | null = null;
  const writes: string[] = [];
  const accessor: FieldAccessor = {
    getField: (path: string) => (path in fields ? fields[path] : null),
    setField: (path: string, _prefix: string, value: unknown) => {
      fields[path] = value;
      writes.push(path);
    },
    hasField: (path: string) => path in fields,
    getCurrentNode: () => null,
    getFormData: () => fields,
    setCurrentKey: (key: string | null) => {
      currentKey = key;
    },
    getCurrentKey: () => currentKey,
  };
  return {
    accessor,
    fields,
    writes,
    setKey: (key) => {
      currentKey = key;
    },
  };
}

function result(
  src: string,
  fields: Record<string, unknown> = {},
  options?: { strictIdentifiers?: boolean }
): { value: unknown; modifiedFields: string[]; context: Setup } {
  const context = setup(fields);
  const program = new FormCalcParser(src).parse();
  return {
    ...new FormCalcEvaluator(context.accessor, options).evaluate(program),
    context,
  };
}

function ev(src: string, fields: Record<string, unknown> = {}): unknown {
  return result(src, fields).value;
}

function evFields(src: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return result(src, fields).context.fields;
}

function evalNode(node: FormCalcNode, context = setup()): unknown {
  return new FormCalcEvaluator(context.accessor).evaluateExpression(node);
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

function assign(
  target: FormCalcNode,
  operator: AssignExpr['operator'],
  value: FormCalcNode
): Program {
  return { type: 'Program', body: [{ type: 'AssignExpr', target, operator, value }] };
}

describe('FormCalcEvaluator — expression forms', () => {
  it('evaluates string concatenation nodes and number-to-string coercion', () => {
    const concat: ConcatExpr = {
      type: 'ConcatExpr',
      left: literal(1),
      right: literal('x'),
    };
    expect(evalNode(concat)).toBe('1x');
    expect(ev('Concat(1, true, false, null)')).toBe('110');
  });

  it('evaluates integer division, powers and unary operators', () => {
    expect(ev('7 \\ 3')).toBe(2);
    expect(ev('2 ^ 8')).toBe(256);
    expect(ev('-(3 + 4)')).toBe(-7);
    expect(ev('+6')).toBe(6);
  });

  it('converts arithmetic overflow to zero and keeps finite results', () => {
    expect(ev('1 / 0')).toBe(0);
    expect(ev('2 ^ 10000')).toBe(0);
    expect(ev('-(1 / 0)')).toBe(0);
    expect(ev('1 \\ 0')).toBe(0);
    expect(ev('5 mod 0')).toBe(0);
  });

  it('exposes truthiness rules', () => {
    expect(formCalcTruthy(true)).toBe(true);
    expect(formCalcTruthy(false)).toBe(false);
    expect(formCalcTruthy(null)).toBe(false);
    expect(formCalcTruthy('12')).toBe(true);
    expect(formCalcTruthy('text')).toBe(false);
    expect(formCalcTruthy(0)).toBe(false);
  });

  it('compares strings, numbers, nulls and NaN on all operators', () => {
    expect(ev('"a" <> "b"')).toBe(1);
    expect(ev('"a" <= "b"')).toBe(1);
    expect(ev('"a" >= "b"')).toBe(0);
    expect(ev('"02" = "2"')).toBe(1);
    expect(ev('"02" <> "2"')).toBe(0);
    expect(ev('2 < "3"')).toBe(1);
    expect(ev('Sqrt(-1) <> 1')).toBe(1);
    expect(ev('Sqrt(-1) <> Sqrt(-1)')).toBe(0);
    expect(ev('Sqrt(-1) <= 1')).toBe(0);
    expect(ev('null < 1')).toBe(0);
    expect(ev('null <> null')).toBe(0);
  });

  it('applies logical operators with nullish and numeric values', () => {
    expect(ev('null and null')).toBeNull();
    expect(ev('null or null')).toBeNull();
    expect(ev('1 and null')).toBe(0);
    expect(ev('null or 0')).toBe(0);
    expect(ev('not "text"')).toBe(1);
    expect(ev('1 xor 0')).toBe(1);
  });
});

describe('FormCalcEvaluator — assignments and variables', () => {
  it('applies compound assignment operators through the AST', () => {
    const id = (name: string): FormCalcNode => ({ type: 'Identifier', name });
    const run = (
      operator: AssignExpr['operator'],
      initial: unknown,
      operand: FormCalcNode
    ): unknown => {
      const fields = { x: initial };
      const context = setup(fields);
      new FormCalcEvaluator(context.accessor).evaluate(assign(id('x'), operator, operand));
      return fields.x;
    };
    expect(run('+=', 2, literal(3))).toBe('5');
    expect(run('-=', 8, literal(3))).toBe('5');
    expect(run('*=', 4, literal(3))).toBe('12');
    expect(run('/=', 9, literal(2))).toBe('4.5');
    expect(run('~=', 'a', literal('b'))).toBe('ab');
    expect(run('&=', 'a', literal('b'))).toBe('ab');
    expect(run('\\=', 'a', literal('b'))).toBe('ab');
    expect(run('^=', 2, literal(3))).toBe('8');
  });

  it('assigns to fields, indexed fields, self properties and variables', () => {
    const fields: Record<string, unknown> = { amount: 1, 'rows[0]': 'old' };
    const context = setup(fields);
    context.setKey('amount');
    const evaluator = new FormCalcEvaluator(context.accessor);
    const fieldRef: FieldRef = { type: 'FieldRef', prefix: '$', path: 'amount', index: undefined };
    const indexed: FieldRef = {
      type: 'FieldRef',
      prefix: '$',
      path: 'rows[0]',
      index: literal(0),
    };
    const self: FormCalcNode = { type: 'Identifier', name: 'rawValue' };
    const variable: FormCalcNode = { type: 'Identifier', name: 'temp' };
    evaluator.evaluate({
      type: 'Program',
      body: [
        { type: 'AssignExpr', target: fieldRef, operator: '=', value: literal(5) },
        { type: 'AssignExpr', target: indexed, operator: '=', value: literal('new') },
        { type: 'AssignExpr', target: self, operator: '=', value: literal('self-value') },
        { type: 'AssignExpr', target: variable, operator: '=', value: literal(9) },
      ],
    });
    expect(fields.amount).toBe('5');
    expect(fields['rows[0]']).toBe('new');
    expect(fields['.rawValue']).toBe('self-value');
    expect(context.writes).toEqual(['amount', 'rows[0]', '.rawValue']);
    expect(
      evaluator.evaluate({
        type: 'Program',
        body: [{ type: 'ExprStmt', expr: variable }],
      }).value
    ).toBe('9');
  });

  it('assigns through an xfa node handle and its property access', () => {
    const fields = { 'xfa.record.Flag': 'old' };
    const context = setup(fields);
    const program = new FormCalcParser(
      'xfa.resolveNode("xfa.record.Flag").value = "written"'
    ).parse();
    const outcome = new FormCalcEvaluator(context.accessor).evaluate(program);
    expect(fields['xfa.record.Flag']).toBe('written');
    expect(outcome.modifiedFields).toEqual(['xfa.record.Flag']);
  });

  it('swallows non-finite assignment results', () => {
    const fields: Record<string, unknown> = { x: 1 };
    const context = setup(fields);
    const evaluator = new FormCalcEvaluator(context.accessor);
    const outcome = evaluator.evaluate(assign({ type: 'Identifier', name: 'x' }, '/=', literal(0)));
    expect(fields.x).toBe(1);
    expect(outcome.value).toBeUndefined();
  });

  it('coerces variable values to strings at declaration', () => {
    expect(ev('var a = true\na')).toBe('1');
    expect(ev('var b = 3\nb')).toBe('3');
    expect(ev('var c\nc')).toBeNull();
  });

  it('rejects unknown identifiers only in strict mode', () => {
    expect(ev('unknownField', { unknownField: 4 })).toBe(4);
    expect(() => result('unknownField', {}, { strictIdentifiers: true })).toThrow(
      /Unknown identifier/
    );
    expect(ev('known', { known: 7 })).toBe(7);
  });
});

describe('FormCalcEvaluator — control flow signals', () => {
  it('reports break and continue outside a loop', () => {
    expect(() => ev('break')).toThrow(/Break\/Continue outside of loop/);
    expect(() => ev('continue')).toThrow(/Break\/Continue outside of loop/);
  });

  it('handles break, continue and return inside loops', () => {
    expect(ev('s = 0\nfor i = 1 downto 5\ns = s + i\nendfor\ns')).toBe('0');
    expect(ev('s = 0\nfor i = 1 to 5 step 2\ns = s + i\nendfor\ns')).toBe('9');
    expect(
      ev(
        's = 0\nfor i = 1 to 5\nif i = 3 then continue end if\nif i = 5 then break end if\ns = s + i\nendfor\ns'
      )
    ).toBe('7');
    expect(
      ev('s = 0\nforeach x in items\nif x = "b" then return s end if\ns = s + x\nendfor', {
        items: ['a', 'b', 'c'],
      })
    ).toBe('0a');
    expect(ev('s = ""\nforeach x in 7\ns = s + x\nendfor\ns')).toBe('7');
    expect(ev('s = 0\nwhile s < 10\ns = s + 1\nif s = 4 then break end if\nendwhile\ns')).toBe('4');
    expect(
      ev(
        's = 0\ni = 0\nrepeat\ni = i + 1\nif i = 2 then continue end if\ns = s + i\nuntil i >= 4\ns'
      )
    ).toBe('8');
  });

  it('limits recursion depth in Eval', () => {
    let nested = '1';
    for (let i = 0; i < 55; i++) nested = `Eval(${nested})`;
    expect(() => ev(nested)).toThrow(/Maximum recursion depth/);
  });

  it('evaluates nested programs with strict identifiers', () => {
    expect(ev('Eval("known + 1")', { known: 4 })).toBe(5);
  });
});

describe('FormCalcEvaluator — property access and node handles', () => {
  it('reads handle properties and falls back for plain objects and nulls', () => {
    const fields = {
      'xfa.record.Flag': 'yes',
      'xfa.record.Rows[0].Flag': 'row',
    };
    expect(ev('xfa.resolveNode("xfa.record.Flag").value', fields)).toBe('yes');
    expect(ev('xfa.resolveNode("xfa.record.Flag").rawValue', fields)).toBe('yes');
    expect(ev('xfa.resolveNode("xfa.record.Rows[0].Flag").name', fields)).toBe('Flag');
    expect(ev('xfa.resolveNode("xfa.record.Flag").presence', fields)).toBe('visible');
    expect(ev('xfa.resolveNode("xfa.record.Flag").unknown', fields)).toBeNull();
    expect(ev('xfa.resolveNode("").value', fields)).toBeNull();
    expect(ev('xfa.resolveNode("xfa.record.Flag").value.unknown', fields)).toBeNull();
  });

  it('returns null when the field accessor throws during resolution', () => {
    const accessor: FieldAccessor = {
      getField: () => {
        throw new Error('boom');
      },
      setField: () => {},
      getCurrentNode: () => null,
      getFormData: () => ({}),
    };
    const program = new FormCalcParser('xfa.resolveNode("anything")').parse();
    expect(new FormCalcEvaluator(accessor).evaluate(program).value).toBeNull();
  });
});

describe('FormCalcEvaluator — built-in functions', () => {
  it('covers the string.* family', () => {
    expect(ev('string.left("abcdef", 3)')).toBe('abc');
    expect(ev('string.right("abcdef", 3)')).toBe('def');
    expect(ev('string.right("abcdef", 0)')).toBe('');
    expect(ev('string.mid("abcdef", 2, 3)')).toBe('bcd');
    expect(ev('string.mid("abcdef", 2)')).toBe('bcdef');
    expect(ev('string.length("abc")')).toBe(3);
    expect(ev('string.lower("AbC")')).toBe('abc');
    expect(ev('string.upper("AbC")')).toBe('ABC');
    expect(ev('string.strip("  a ")')).toBe('a');
    expect(ev('string.leftback("abcdef", 2)')).toBe('abcd');
    expect(ev('string.rightback("abcdef", 2)')).toBe('cdef');
    expect(ev('string.wordnum(21, 2)')).toBe('Twenty-one Dollars');
    expect(ev('string.apnum("3")')).toBe('3');
    expect(ev('string.ltrim("  a ")')).toBe('a ');
    expect(ev('string.rtrim("  a ")')).toBe('  a');
    expect(ev('string.num(2.5)')).toBe('2.5');
    expect(ev('string.at("abcdef", "cd")')).toBe(3);
    expect(ev('string.at("abcdef", "zz")')).toBe(0);
    expect(ev('string.nameat("ABC", 2)')).toBe(66);
    expect(ev('string.nameat("ABC", 9)')).toBe(0);
    expect(
      evalNode({ type: 'CallExpr', name: 'string.repeat', args: [literal('ab'), literal(3)] })
    ).toBe('ababab');
    expect(ev('string.pad("7", 3, "0")')).toBe('007');
    expect(ev('string.instr("abcabc", "bc", 2)')).toBe(2);
    expect(ev('string.instr("abc", "z")')).toBe(0);
  });

  it('covers plain string helpers and edge cases', () => {
    expect(ev('Len(12)')).toBe(2);
    expect(ev('Left("abc", -1)')).toBe('');
    expect(ev('Right("abc", -1)')).toBe('');
    expect(ev('Stuff("abcdef", 20, 2, "X")')).toBe('abcdeX');
    expect(ev('Replace("abc", "", "x")')).toBe('abc');
    expect(ev('Space(-2)')).toBe('');
    expect(ev('Str(2.456, 3, 2)')).toBe('***');
    expect(ev('Substr("abc", 1, 0)')).toBe('');
    expect(ev('Concat()')).toBe('');
    expect(ev('Uuid(1)')).toMatch(/^[0-9a-f]{8}-/);
  });

  it('covers date and time helper functions', () => {
    expect(ev('Date() >= 0')).toBe(1);
    expect(ev('Date("Mar 15, 1996")')).toBe(35138);
    expect(ev('Date("1996-03-15")')).toBe(35138);
    expect(ev('Date("19960315")')).toBe(35138);
    expect(ev('Date("03/15/96")')).toBe(35138);
    expect(ev('Date("15/03/1996") > 0')).toBe(1);
    expect(ev('Date("not a date")')).toBe(0);
    expect(ev('Date("15/03/1996", "DD/MM/YYYY")')).toBe(35138);
    expect(ev('Date.collapse("1996-03-15")')).toBe('1996-03-15');
    expect(ev('Date.collapse("bad")')).toBe('');
    expect(ev('Date.largest("1996-02-01")')).toBe(29);
    expect(ev('Date.month("1996-03-15")')).toBe(3);
    expect(ev('Date.year("1996-03-15")')).toBe(1996);
    expect(ev('Date.weekday("1996-03-15")')).toBe(6);
    expect(ev('Date.daysinmonth("bad")')).toBe(0);
    expect(ev('Date.daysinyear("1996-03-15")')).toBe(366);
    expect(ev('Date.daysinyear("1997-03-15")')).toBe(365);
    expect(ev('Date.dayofyear("1996-03-15")')).toBe(75);
    expect(ev('Date.month("bad")')).toBe(0);
    expect(ev('Time() >= 0')).toBe(1);
    expect(ev('Datetime()')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('covers numeric and predicate helpers', () => {
    expect(ev('Frac(-2.75)')).toBe(0.25);
    expect(ev('Integer(-2.7)')).toBe(-3);
    expect(ev('Float("3.5")')).toBe(3.5);
    expect(ev('HasValue(0)')).toBe(1);
    expect(ev('HasValue(null)')).toBe(0);
    expect(ev('IsNaN("text")')).toBe(0);
    expect(ev('IsNull(0)')).toBe(0);
    expect(ev('HasFinish()')).toBe(0);
    expect(ev('IsSigned()')).toBe(0);
    expect(ev('Null()')).toBeNull();
    expect(ev('Appear(0, 1)')).toBe(0);
    expect(ev('Appear(null, 1)')).toBe(1);
    expect(ev('Oneof(2, "2", 2)')).toBe(1);
    expect(ev('Choose(null, 1, 2)')).toBeNull();
    expect(ev('Choose(9, 1, 2)')).toBe('');
    expect(ev('Ref(5)')).toBe(5);
    expect(ev('Pi()')).toBeCloseTo(Math.PI, 10);
    expect(ev('Deg2Rad(90)')).toBeCloseTo(Math.PI / 2, 10);
    expect(ev('Rad2Deg(4 * atan(1))')).toBe(180);
    expect(ev('Get()')).toBe('');
    expect(ev('Put()')).toBe('');
    expect(ev('Post()')).toBe('');
    expect(ev('Page()')).toBe(1);
    expect(ev('Presence()')).toBe('visible');
    expect(ev('Messagebox()')).toBeNull();
    expect(
      evalNode({ type: 'CallExpr', name: 'If', args: [literal(1), literal('yes'), literal('no')] })
    ).toBe('yes');
    expect(
      evalNode({ type: 'CallExpr', name: 'If', args: [literal(null), literal('yes')] })
    ).toBeNull();
    expect(ev('Round(1.2345, 20)')).toBe(1.2345);
    expect(ev('Round(-1.5, -1)')).toBe(-1);
    expect(ev('Log10(100)')).toBe(2);
    expect(ev('Sign(-3)')).toBe(-1);
  });

  it('covers encoding, formatting and picture helpers', () => {
    expect(ev('Encode("héllo", "html")')).toBe('h&#xe9;llo');
    expect(ev('Encode("<", "xml")')).toBe('&lt;');
    expect(ev('Encode("a b", "url")')).toBe('a%20b');
    expect(ev('Encode("😀", "url")')).toBe('%f0%9f%98%80');
    expect(ev('Decode("&amp;&#65;&#x42;&bad;", "html")')).toBe('&AB&bad;');
    expect(ev('Decode("&#x110000;", "html")')).toBe('&#x110000;');
    expect(ev('Decode("&apos;", "xml")')).toBe("'");
    expect(ev('Decode("a+b", "url")')).toBe('a b');
    expect(ev('Decode("%zz", "url")')).toBe('%zz');
    expect(ev('Format("num{$9,999.99}", 1234.5)')).toBe('$1,234.50');
    expect(ev('Format("9999", 12)')).toBe('12');
    expect(ev('Format("YYYY-MM-DD", "1996-03-15")')).toBe('1996-03-15');
    expect(ev('Format("h:MM A", 0)')).toBe('12:00 AM');
    expect(ev('Format("text{9}", "x")')).toBe('x');
    expect(ev('Parse("9999", "12")')).toBe(12);
    expect(ev('Parse("YYYY-MM-DD", "1996-03-15")')).toBe('1996-03-15');
    expect(ev('Parse("H:MM:SS", "12:30:45")')).toBe('12:30:45');
    expect(ev('Parse("YYYY-MM-DD", "bad")')).toBe('bad');
    expect(ev('Num2Date(35138)')).toMatch(/1996/);
    expect(ev('Num2Date(NaN)')).toBe('Dec 31, 1899');
    expect(ev('Num2Time(NaN)')).toBe('0:00:00 AM');
    expect(ev('IsoDate2Num("1996-13-01")')).toBe(0);
    expect(ev('IsoTime2Num("25:00")')).toBe(25 * 3600000);
    expect(ev('IsoTime2Num("bad")')).toBe(0);
    expect(ev('Num2GMTime(NaN)')).toBe('0:00:00 AM');
  });

  it('covers format and locale style helpers', () => {
    expect(ev('LocalDateFmt("de_DE")')).toBe('DD.MM.YYYY');
    expect(ev('LocalDateFmt("fr_FR")')).toBe('DD/MM/YYYY');
    expect(ev('LocalDateFmt("ja_JP")')).toBe('YYYY/MM/DD');
    expect(ev('LocalDateFmt()')).toBe('MM/DD/YYYY');
    expect(ev('LocalTimeFmt("de_DE")')).toBe('HH:MM:SS');
    expect(ev('LocalTimeFmt("en_US")')).toBe('h:MM:SS A');
    expect(ev('DateFmt(99)')).toBe('MMM D, YYYY');
    expect(ev('TimeFmt(9)')).toBe('h:mm:ss a');
    expect(ev('NumFmt(3)')).toBe('999999');
    expect(ev('DatetimeFmt(1)')).toBe('M/D/YY h:mm a');
  });

  it('covers financial functions and their invalid-argument branches', () => {
    expect(ev('Apr(null, 1, 2)')).toBeNull();
    expect(ev('Apr(-1, 1, 2)')).toBe(0);
    expect(ev('CTerm(null, 1, 2)')).toBeNull();
    expect(ev('CTerm(0, 1, 2)')).toBe(0);
    expect(ev('FV(null, 1, 2)')).toBeNull();
    expect(ev('FV(0, 1, 2)')).toBe(0);
    expect(ev('FV(10, 0, 2)')).toBe(20);
    expect(ev('IPmt(null, 1, 2, 3, 4)')).toBeNull();
    expect(ev('IPmt(0, 1, 2, 3, 4)')).toBe(0);
    expect(ev('IPmt(100, 2.4, 5, 1, 2)')).toBe(0);
    expect(ev('PPMt(null, 1, 2, 3, 4)')).toBeNull();
    expect(ev('PPMt(100, 2.4, 5, 1, 2)')).toBe(0);
    expect(ev('NPV(null, 1)')).toBeNull();
    expect(ev('NPV(0, 1)')).toBe(0);
    expect(ev('Pmt(null, 1, 2)')).toBeNull();
    expect(ev('Pmt(100, -1, 2)')).toBe(0);
    expect(ev('Pmt(100, 0, 2)')).toBe(50);
    expect(ev('PV(null, 1, 2)')).toBeNull();
    expect(ev('PV(10, 0, 2)')).toBe(20);
    expect(ev('Rate(null, 1, 2)')).toBeNull();
    expect(ev('Rate(0, 1, 2)')).toBe(0);
    expect(ev('Term(null, 1, 2)')).toBeNull();
    expect(ev('Term(0, 1, 2)')).toBe(0);
  });
});

describe('FormCalcEvaluator — result handling', () => {
  it('sanitises non-finite values in results and modified field lists', () => {
    const fields: Record<string, unknown> = {};
    const outcome = result('1/0', fields);
    expect(outcome.value).toBe(0);
    expect(outcome.modifiedFields).toEqual([]);
  });

  it('keeps expression statements as the last value', () => {
    expect(result('x = 5\nx + 1').value).toBe(6);
    expect(result('').value).toBeUndefined();
  });

  it('treats direct expression statements as a program body', () => {
    const program: Program = {
      type: 'Program',
      body: [{ type: 'ExprStmt', expr: literal('direct') } as ExprStmt],
    };
    expect(new FormCalcEvaluator(setup().accessor).evaluate(program).value).toBe('direct');
  });

  it('raises FormCalcError from the Throw function', () => {
    expect(() => ev('Throw("bad")')).toThrow(FormCalcError);
  });
});
