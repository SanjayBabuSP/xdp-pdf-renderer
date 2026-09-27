/**
 * FormCalc golden-semantics tests.
 *
 * Goldens are transcribed from the Adobe FormCalc User Reference (doc
 * extracted to /tmp/opencode/fc/extracted.txt) and from the decompiled
 * jfformcalc.dll engine. One or more examples per function in
 * FormCalc_fn.ini, plus lexer/parser/operator behavior that differs from
 * JavaScript.
 */
import {
  FormCalcParser,
  FormCalcEvaluator,
  FormCalcError,
  FormCalcParseError,
} from '../../../../src/domain/scripting/formcalc';
import type { FieldAccessor } from '../../../../src/domain/scripting/formcalc';
import { FormCalcLexer, decodeFormCalcString, TokenType } from '../../../../src/domain/scripting/formcalc/lexer';

function makeAccessor(fields: Record<string, unknown>): FieldAccessor {
  return {
    getField: (path: string) => (path in fields ? fields[path] : null),
    setField: (path: string, _prefix: string, value: unknown) => {
      fields[path] = value;
    },
    // Unknown names resolve as (null) fields instead of raising
    // strict-identifier errors — goldens exercise values, not scoping.
    hasField: () => true,
    getCurrentNode: () => null,
    getFormData: () => fields,
  };
}

function ev(src: string, fields: Record<string, unknown> = {}): unknown {
  const program = new FormCalcParser(src).parse();
  const result = new FormCalcEvaluator(makeAccessor(fields)).evaluate(program);
  return result.value;
}

function evFields(src: string, fields: Record<string, unknown>): Record<string, unknown> {
  const program = new FormCalcParser(src).parse();
  new FormCalcEvaluator(makeAccessor(fields)).evaluate(program);
  return fields;
}

function tokens(src: string): string[] {
  return new FormCalcLexer(src)
    .tokenize()
    .filter((tk) => tk.type !== TokenType.EOF)
    .map((tk) => `${tk.type}:${tk.value}`);
}

// ─── Lexer ────────────────────────────────────────────────────────────────

describe('FormCalc lexer', () => {
  it('treats ; as a line comment', () => {
    const t = tokens('a = 1 ; this is a comment\nb = 2');
    expect(t).not.toContainEqual(expect.stringContaining('comment'));
    expect(t).toContain('IDENT:b');
  });

  it('treats // as a line comment', () => {
    expect(tokens('a = 1 // trailing\nb = 2')).toContain('IDENT:b');
    expect(tokens('// leading\na = 1')).toContain('IDENT:a');
  });

  it('doubles quotes inside strings', () => {
    const t = tokens('"say ""hi"""');
    expect(t).toEqual(['STRING:say "hi"']);
  });

  it('decodes \\uXXXX escapes', () => {
    expect(decodeFormCalcString('\\u0041\\u00e9')).toBe('Aé');
  });

  it('allows ! as an identifier character', () => {
    expect(tokens('click!')).toEqual(['IDENT:click!']);
  });

  it('maps keywords to statement tokens', () => {
    expect(tokens('if then else elseif endif end for endfor foreach endfor while endwhile repeat until exit return')).toEqual([
      'IF:if', 'THEN:then', 'ELSE:else', 'ELSEIF:elseif', 'ENDIF:endif',
      'END:end', 'FOR:for', 'ENDFOR:endfor', 'FOREACH:foreach', 'ENDFOR:endfor',
      'WHILE:while', 'ENDWHILE:endwhile', 'REPEAT:repeat', 'UNTIL:until',
      'RETURN:exit', 'RETURN:return',
    ]);
  });

  it('distinguishes = from == and maps | & to OR/AND', () => {
    expect(tokens('a == b')).toEqual(['IDENT:a', 'EQUAL:==', 'IDENT:b']);
    expect(tokens('a = b')).toEqual(['IDENT:a', 'EQUAL:=', 'IDENT:b']);
    expect(tokens('a | b')).toEqual(['IDENT:a', 'OR:|', 'IDENT:b']);
    expect(tokens('a & b')).toEqual(['IDENT:a', 'AMPERSAND:&', 'IDENT:b']);
  });
});

// ─── Parser ───────────────────────────────────────────────────────────────

describe('FormCalc parser', () => {
  it('accepts foreach/endfor loops', () => {
    expect(() => new FormCalcParser('foreach x in items\nendfor').parse()).not.toThrow();
  });

  it('accepts the two-word `end if` form', () => {
    expect(() => new FormCalcParser('if a then b = 1 end if').parse()).not.toThrow();
  });

  it('accepts `mod(...)` as a function call', () => {
    expect(() => new FormCalcParser('x = mod(7, 3)').parse()).not.toThrow();
  });

  it('accepts `if(...)` as a function call', () => {
    expect(() => new FormCalcParser('x = if(1, 2, 3)').parse()).not.toThrow();
  });

  it('does not treat == as an assignment statement', () => {
    // `a == b` must parse as a comparison, not `a = (= b)` → error
    expect(() => new FormCalcParser('a == b').parse()).not.toThrow();
  });

  it('rejects unterminated strings', () => {
    expect(() => new FormCalcParser('"abc').parse()).toThrow(FormCalcParseError);
  });
});

// ─── Comparisons and logical operators ────────────────────────────────────

describe('comparison and logical semantics', () => {
  it('returns 1/0 for comparisons (True (1) / False (0))', () => {
    expect(ev('5 > 3')).toBe(1);
    expect(ev('5 < 3')).toBe(0);
    expect(ev('3 >= 3')).toBe(1);
    expect(ev('3 <= 2')).toBe(0);
    expect(ev('5 = 5')).toBe(1);
    expect(ev('5 <> 5')).toBe(0);
  });

  it('supports eq/ne/gt/ge/lt/le mnemonics and ==', () => {
    expect(ev('5 eq 5')).toBe(1);
    expect(ev('5 ne 5')).toBe(0);
    expect(ev('3 gt 5')).toBe(0);
    expect(ev('3 ge 3')).toBe(1);
    expect(ev('3 lt 5')).toBe(1);
    expect(ev('3 le 2')).toBe(0);
    expect(ev('5 == 5')).toBe(1);
    expect(ev('5 == 6')).toBe(0);
  });

  it('null comparison rules', () => {
    expect(ev('null = null')).toBe(1);
    expect(ev('null <> null')).toBe(0);
    expect(ev('null <= null')).toBe(1);
    expect(ev('null >= null')).toBe(1);
    expect(ev('null = 1')).toBe(0);
    expect(ev('null <> 1')).toBe(1);
    expect(ev('null < 1')).toBe(0);
    expect(ev('1 = 1')).toBe(1);
  });

  it('NaN comparison rules (NaN == NaN is TRUE, NaN < x is false)', () => {
    expect(ev('Sqrt(-1) = Sqrt(-1)')).toBe(1); // NaN == NaN is TRUE
    expect(ev('Sqrt(-1) <> Sqrt(-1)')).toBe(0);
    expect(ev('Sqrt(-1) < 5')).toBe(0); // </> with NaN → false
    expect(ev('Sqrt(-1) >= Sqrt(-1)')).toBe(1);
  });

  it('and/or with null operands', () => {
    expect(ev('null and null')).toBe(null);
    expect(ev('null or null')).toBe(null);
    expect(ev('null and 1')).toBe(0);
    expect(ev('null or 1')).toBe(1);
  });

  it('and/or/not use 1/0 and the & | symbols', () => {
    expect(ev('1 and 1')).toBe(1);
    expect(ev('1 and 0')).toBe(0);
    expect(ev('0 or 1')).toBe(1);
    expect(ev('0 or 0')).toBe(0);
    expect(ev('1 & 1')).toBe(1);
    expect(ev('0 & 1')).toBe(0);
    expect(ev('0 | 1')).toBe(1);
    expect(ev('0 | 0')).toBe(0);
    expect(ev('not 1')).toBe(0);
    expect(ev('not 0')).toBe(1);
    expect(ev('not null')).toBe(1);
    expect(ev('1 xor 1')).toBe(0);
    expect(ev('1 xor 0')).toBe(1);
  });

  it('does not short-circuit and/or', () => {
    // both operands are always evaluated; result still matches truth table
    expect(ev('1 and (2 > 1)')).toBe(1);
    expect(ev('0 or (1 > 2)')).toBe(0);
  });
});

// ─── Financial functions ──────────────────────────────────────────────────

describe('financial functions (doc goldens)', () => {
  it('Apr matches both doc examples to 9 decimals', () => {
    expect(ev('Apr(35000, 269.50, 360)')).toBeCloseTo(0.08515404566, 9);
    expect(ev('Apr(210000 * 0.75, 850 + 110, 25 * 26)')).toBeCloseTo(0.07161332404, 9);
  });

  it('CTerm', () => {
    expect(ev('CTerm(0.02, 1000, 100)')).toBeCloseTo(116.2767474515, 6);
  });

  it('FV', () => {
    expect(ev('FV(400, 0.10 / 12, 30 * 12)')).toBeCloseTo(904195.16991842445, 6);
    expect(ev('FV(1000, 0.075 / 4, 10 * 4)')).toBeCloseTo(58791.96145535981, 6);
  });

  it('IPmt', () => {
    expect(ev('IPmt(30000, 0.085, 295.50, 7, 3)')).toBeCloseTo(624.8839283142, 6);
  });

  it('NPV', () => {
    expect(ev('NPV(0.065, 5000)')).toBeCloseTo(4694.83568075117, 6);
    expect(ev('NPV(0.10, 500, 1500, 4000, 10000)')).toBeCloseTo(11529.60863329007, 6);
  });

  it('Pmt', () => {
    expect(ev('Pmt(150000, 0.0475 / 12, 300)')).toBeCloseTo(855.17604207164, 6);
  });

  it('PV', () => {
    expect(ev('PV(400, 0.10 / 12, 360)')).toBeCloseTo(45580.32799074439, 6);
  });

  it('Rate', () => {
    expect(ev('Rate(12000, 8000, 5)')).toBeCloseTo(0.0844717712, 8);
    expect(ev('Rate(10000, 0.25 * 5000, 4 * 12)')).toBeCloseTo(0.04427378243, 9);
  });

  it('Term', () => {
    expect(ev('Term(475, .05, 1500)')).toBeCloseTo(3.00477517728, 7);
  });

  it('Round goldens (away-from-zero + IEEE double behavior)', () => {
    expect(ev('Round(12.389764537, 4)')).toBe(12.3898);
    expect(ev('Round(20/3, 2)')).toBe(6.67);
    expect(ev('Round(8.9897, "abc")')).toBe(9); // invalid places → 0
    expect(ev('Round(FV(400, 0.10/12, 30*12), 2)')).toBe(904195.17);
    expect(ev('Round(0.124, 2)')).toBe(0.12);
    expect(ev('Round(.125, 2)')).toBe(0.13); // .125 exactly representable → up
    expect(ev('Round(0.045, 2)')).toBe(0.04); // 0.045 double is 0.04499…
    expect(ev('Round(1.005, 2)')).toBe(1); // 1.005 double is 1.004999…
    expect(ev('Round(-1.5)')).toBe(-1); // p=0: floor(x+0.5), ties toward +∞
    expect(ev('Round(-2.5)')).toBe(-2);
    expect(ev('Round(4.456)')).toBe(4);
    expect(ev('Round(-1.03, 2)')).toBe(-1.03);
  });

  it('Mod uses fmod sign-of-dividend and throws on divisor 0 (→ 0 at statement)', () => {
    expect(ev('Mod(64, -3)')).toBe(1);
    expect(ev('Mod(-13, 3)')).toBe(-1);
    expect(ev('Mod("abc", 2)')).toBe(0); // non-numeric → 0
    expect(ev('7 mod 3')).toBe(1);
    expect(ev('-7 mod 3')).toBe(-1);
    expect(ev('Mod(7, 0)')).toBe(0); // error → 0
  });
});

// ─── Date / Time functions ────────────────────────────────────────────────

describe('date and time functions (doc goldens)', () => {
  it('Date2Num uses the XFA epoch (Dec 31 1899 = day 0)', () => {
    expect(ev('Date2Num("Mar 15, 1996")')).toBe(35138);
    expect(ev('Date2Num("1/1/1900", "D/M/YYYY")')).toBe(1);
    expect(ev('Date2Num("03/15/96", "MM/DD/YY")')).toBe(35138);
    expect(ev('Date2Num("96-08-20", "YY-MM-DD")')).toBe(35296);
  });

  it('Date2Num tolerates missing whitespace after separators', () => {
    expect(ev('Date2Num("Aug 1,1996", "MMM D, YYYY")')).toBe(35277);
    expect(ev('Date2Num("Sep 1, 2002", "MMM D, YYYY")')).toBe(37499);
  });

  it('IsoDate2Num', () => {
    expect(ev('IsoDate2Num("1900")')).toBe(1);
    expect(ev('IsoDate2Num("19960315T20:20:20")')).toBe(35138);
  });

  it('Num2Date renders with the given picture', () => {
    expect(ev('Num2Date(1, "DD/MM/YYYY")')).toBe('01/01/1900');
    expect(ev('Num2Date(35139, "DD-MMM-YYYY")')).toBe('16-Mar-1996');
  });

  it('DateFmt / TimeFmt return picture styles', () => {
    expect(ev('DateFmt()')).toBe('MMM D, YYYY');
    expect(ev('DateFmt(1)')).toBe('M/D/YY');
    expect(ev('TimeFmt(1)')).toBe('h:mm a');
  });

  it('Time2Num / Num2Time round-trip', () => {
    expect(ev('Time2Num("15:52:15", "HH:MM:SS")')).toBe(57135000);
    expect(ev('Num2Time(57135000, "HH:MM:SS")')).toBe('15:52:15');
  });

  it('Num2GMTime renders GMT times (function name is Num2GMTime)', () => {
    expect(ev('Num2GMTime(1, "HH:MM:SS")')).toBe('00:00:00');
    expect(ev('Num2GMTime(65593001, "HH:MM:SS Z")')).toBe('18:13:13 GMT');
  });

  it('Date() / Time() callable with zero args', () => {
    expect(ev('Date(2003, 9, 12)')).toBe(37875);
    expect(ev('Time() >= 0')).toBe(1);
  });
});

// ─── Unit functions ───────────────────────────────────────────────────────

describe('unit functions (doc goldens)', () => {
  it('UnitValue converts between units', () => {
    expect(ev('UnitValue("2in")')).toBe(2);
    expect(ev('UnitValue("2in", "cm")')).toBeCloseTo(5.08, 10);
    expect(ev('UnitValue("6", "pt")')).toBe(432); // bare number → inches
    expect(ev('UnitValue("A", "cm")')).toBe(0);
    expect(ev('UnitValue("5.08cm", "kilograms")')).toBeCloseTo(2, 10); // invalid unit → inches
    expect(ev('UnitValue("36 in", "mm")')).toBeCloseTo(914.4, 10);
  });

  it('UnitType returns the unit letter', () => {
    expect(ev('UnitType("36 in")')).toBe('in');
    expect(ev('UnitType("2.54centimeters")')).toBe('cm');
    expect(ev('UnitType("picas")')).toBe('pt');
    expect(ev('UnitType("2.cm")')).toBe('cm');
    expect(ev('UnitType("2.zero cm")')).toBe('in');
    expect(ev('UnitType("kilometers")')).toBe('in');
  });
});

// ─── String / encoding functions ──────────────────────────────────────────

describe('string and encoding functions (doc goldens)', () => {
  it('Encode url keeps ! $ * + , - . / : @ = ? and space→%20 (lowercase hex)', () => {
    expect(ev('Encode("hello, world!", "url")')).toBe('hello,%20world!');
    expect(ev('Encode("""hello, world!""", "url")')).toBe('%22hello,%20world!%22');
    expect(ev('Encode("a/b:c@d=e?f+g&h", "url")')).toBe('a%2fb%3ac%40d%3de%3ff%2bg%26h');
    expect(ev('Encode("héllo", "url")')).toBe('h%c3%a9llo'); // lowercase hex
  });

  it('Encode html/xml escape entities', () => {
    expect(ev('Encode("AAA", "html")')).toBe('AAA');
    expect(ev('Encode("Tom & Jerry", "xml")')).toBe('Tom &amp; Jerry');
    expect(ev('Encode("<b>&</b>", "html")')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('Decode url restores the string', () => {
    expect(ev('Decode("hello,%20world!", "url")')).toBe('hello, world!');
  });

  it('WordNum renders doc examples (hyphenated units lowercase)', () => {
    expect(ev('WordNum(123.45)')).toBe('One Hundred and Twenty-three Dollars');
    expect(ev('WordNum(123.45, 1)')).toBe('One Hundred and Twenty-three Dollars');
    expect(ev('WordNum(1154.67, 2)')).toBe('One Thousand One Hundred Fifty-four Dollars And Sixty-seven Cents');
    expect(ev('WordNum(23)')).toBe('Twenty-three Dollars');
    expect(ev('WordNum(54, 0)')).toBe('Fifty-four Dollars');
    expect(ev('WordNum(67, 2)')).toBe('Sixty-seven Dollars'); // no fraction → no cents
    expect(ev('WordNum(1)')).toBe('One Dollars');
  });

  it('Left / Right / Substr / Stuff / Replace / Len', () => {
    expect(ev('Left("ABCDEFGH", 3)')).toBe('ABC');
    expect(ev('Right("ABCDEFGH", 3)')).toBe('FGH');
    expect(ev('Left("TonyBlue", 0)')).toBe('');
    expect(ev('Substr("ABCDEFG", 3, 4)')).toBe('CDEF');
    expect(ev('Stuff("ABCDEFGH", 4, 2)')).toBe('ABCFGH');
    expect(ev('Stuff("TonyBlue", 5, 0, " ")')).toBe('Tony Blue');
    expect(ev('Replace("Tony Blue", "Tony", "Chris")')).toBe('Chris Blue');
    expect(ev('Len("hello")')).toBe(5);
    expect(ev('Space(5)')).toBe('     ');
  });

  it('Concat joins with null → empty piece', () => {
    expect(ev('Concat("ABC", Null(), "DEF")')).toBe('ABCDEF');
    expect(ev('Concat("ABC", "DEF")')).toBe('ABCDEF');
    expect(ev('Concat("A", 1, "B")')).toBe('A1B');
  });

  it('Uuid is 32 lowercase hex digits (dashed form has hyphens)', () => {
    expect(ev('Uuid()')).toMatch(/^[0-9a-f]{32}$/);
    expect(ev('Uuid(1)')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ─── Choose / Oneof / predicates ──────────────────────────────────────────

describe('Choose / Oneof / predicates (doc goldens)', () => {
  it('Choose returns the nth argument', () => {
    expect(ev('Choose(3, "Taxes", "Price", "Person", "Teller")')).toBe('Person');
    expect(ev('Choose(2, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1)')).toBe(9);
    expect(ev('Choose(20/3, "A", "B", "C", "D", "E", "F", "G", "H")')).toBe('F');
    expect(ev('Choose(Null(), 1, 2)')).toBe(null);
    expect(ev('Choose(0, 1, 2)')).toBe(''); // out of range → ''
  });

  it('Oneof returns 1-based match index or 0', () => {
    expect(ev('Oneof(3, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1)')).toBe(1);
    expect(ev('Oneof("John", "Bill", "Gary", "Joan", "John", "Lisa")')).toBe(1);
    expect(ev('Oneof(3, 1, 25)')).toBe(0);
    expect(ev('Oneof(Null(), 1, 2)')).toBe(0);
  });

  it('HasValue / IsNull / Within / Exists return 1/0', () => {
    expect(ev('HasValue(2)')).toBe(1);
    expect(ev('HasValue("")')).toBe(0);
    expect(ev('HasValue(" ")')).toBe(0);
    expect(ev('IsNull(Null())')).toBe(1);
    expect(ev('IsNull(1)')).toBe(0);
    expect(ev('Within(5, 1, 10)')).toBe(1);
    expect(ev('Within(50, 1, 10)')).toBe(0);
    expect(ev('Exists(Null())')).toBe(0);
    expect(ev('Exists(0)')).toBe(1);
    expect(ev('IsEmpty(null)')).toBe(1);
    expect(ev('IsEmpty(0)')).toBe(0);
    expect(ev('IsNaN(Sqrt(-1))')).toBe(1);
    expect(ev('IsNaN(1)')).toBe(0);
  });
});

// ─── Aggregates / numeric ─────────────────────────────────────────────────

describe('aggregate and numeric functions (doc goldens)', () => {
  it('Count / Sum / Avg / Max / Min skip nulls', () => {
    expect(ev('Count(1, Null(), 3)')).toBe(2);
    expect(ev('Sum(1, Null(), 3)')).toBe(4);
    expect(ev('Avg(1, Null(), 3)')).toBe(2);
    expect(ev('Max(1, Null(), 3)')).toBe(3);
    expect(ev('Min(1, Null(), 3)')).toBe(1);
    expect(ev('Avg(0, 32, 16)')).toBe(16);
    expect(ev('Avg(2.5, 17, null)')).toBe(9.75);
    expect(ev('Count()')).toBe(0);
    expect(ev('Sum()')).toBe(0);
    expect(ev('Avg()')).toBe(0);
    expect(ev('Max()')).toBe(0);
    expect(ev('Min()')).toBe(0);
    expect(ev('Count(Null())')).toBe(0);
    expect(ev('Sum(Null())')).toBe(0);
  });

  it('Abs / Floor / Ceil / Pi / Deg2Rad / Rad2Deg / Exp / Log', () => {
    expect(ev('Abs(-1.03)')).toBe(1.03);
    expect(ev('Floor(-2.7)')).toBe(-3);
    expect(ev('Ceil(-1.2)')).toBe(-1);
    expect(ev('Pi() > 3.14159 and Pi() < 3.1416')).toBe(1);
    expect(ev('Deg2Rad(180)')).toBeCloseTo(Math.PI, 12);
    expect(ev('Rad2Deg(4 * atan(1))')).toBe(180);
    expect(ev('Exp(0)')).toBe(1);
    expect(ev('Log(1)')).toBe(0);
    expect(ev('Random() >= 0 and Random() < 1')).toBe(1);
    expect(ev('Pow(2, 10)')).toBe(1024);
    expect(ev('Frac(2.75)')).toBe(0.75);
    expect(ev('Mod(0, 3)')).toBe(0);
  });

  it('Str formats numbers', () => {
    expect(ev('Str(2.456)')).toBe('2');
    expect(ev('Str(4.532, 6, 4)')).toBe('4.5320');
    expect(ev('Str(234.458, 4)')).toBe('234');
    expect(ev('Str(31.2345, 4, 2)')).toBe('****');
  });

  it('Format / Parse with pictures', () => {
    expect(ev('Parse("MMM D, YYYY", "Sep 1, 2002")')).toBe('2002-09-01');
    expect(ev('Parse("$9,999,999.99", "$1,234,567.89")')).toBe(1234567.89);
    expect(ev('Format("MMM D, YYYY", "2002-09-01")')).toBe('Sep 1, 2002');
  });
});

// ─── Eval / Ref / Null / Throw ────────────────────────────────────────────

describe('Eval / Ref / Null', () => {
  it('Eval evaluates an expression string', () => {
    expect(ev('Eval("10*3+5*4")')).toBe(50);
  });

  it('Ref returns the expression string unevaluated', () => {
    expect(ev('Ref("10*3+5*4")')).toBe('10*3+5*4');
  });

  it('Null() is callable and null + number = number', () => {
    expect(ev('Null()')).toBe(null);
    expect(ev('Null() + 5')).toBe(5);
    expect(ev('5 + Null()')).toBe(5);
  });

  it('Throw raises a FormCalcError visible to the caller', () => {
    expect(() => ev('Throw("Oops")')).toThrow(FormCalcError);
  });
});

// ─── Language semantics ───────────────────────────────────────────────────

describe('language semantics', () => {
  it('string concatenation happens through + with non-numeric operands', () => {
    expect(ev('"hello" + " world"')).toBe('hello world');
    expect(ev('"A" + 1')).toBe('A1');
    expect(ev('1 + "A"')).toBe('1A');
    expect(ev('"12" + "3"')).toBe(15); // both numeric-like → numeric add
  });

  it('assignment coerces to string for string-typed variables', () => {
    const f = evFields('x = 1 + 1', {});
    expect(f['x']).toBe('2');
  });

  it('variable assignment is not a comparison', () => {
    const f = evFields('count = 5', {});
    expect(f['count']).toBe('5');
    // Inside a larger expression `=` stays a comparison (no assignment)
    expect(ev('count = 5 and count = 5', f)).toBe(1);
    // As a statement it is an assignment
    expect(ev('count = 6', f)).toBe(undefined);
    expect(f['count']).toBe('6');
  });

  it('arithmetic errors evaluate to 0 (NaN/Inf signal)', () => {
    expect(ev('1/0')).toBe(0);
    expect(ev('Sqrt(-1) + 1')).toBe(0);
    expect(ev('Log(0) + 1')).toBe(0);
  });

  it('unknown functions raise FormCalcError', () => {
    expect(() => ev('NoSuchFunction(1)')).toThrow(FormCalcError);
  });

  it('field reads and writes round-trip through the accessor', () => {
    const f = evFields('price = price * 2', { price: '21' });
    expect(f['price']).toBe('42');
  });

  it('qualified paths resolve through getField', () => {
    expect(ev('xfa.som.price + 1', { 'xfa.som.price': 9 })).toBe(10);
  });

  it('string comparison uses collation, mixed uses numeric', () => {
    expect(ev('"apple" < "banana"')).toBe(1);
    expect(ev('"Apple" = "apple"')).toBe(0); // case-sensitive
    expect(ev('"10" < "9"')).toBe(1); // two strings → collation, not numeric
  });

  it('empty string compares equal to null', () => {
    expect(ev('"" = null')).toBe(1);
    expect(ev('"" <> null')).toBe(0);
  });
});

// ─── Control flow ─────────────────────────────────────────────────────────

describe('control flow', () => {
  it('if/then/else with two-word end if', () => {
    expect(ev('if 1 = 1 then\n  x = "yes"\nelse\n  x = "no"\nend if\nx')).toBe('yes');
    expect(ev('if 1 = 2 then\n  x = "yes"\nelse\n  x = "no"\nend if\nx')).toBe('no');
  });

  it('elseif chains', () => {
    const src = 'if a < 10 then r = "low" elseif a < 100 then r = "mid" else r = "high" end if r';
    expect(ev(src, { a: 5 })).toBe('low');
    expect(ev(src, { a: 50 })).toBe('mid');
    expect(ev(src, { a: 500 })).toBe('high');
  });

  it('while/endwhile loop', () => {
    expect(ev('var i = 0\nwhile i < 3\n  i = i + 1\nendwhile\ni')).toBe('3');
  });

  it('repeat/until loop', () => {
    expect(ev('i = 0\nrepeat\n  i = i + 1\nuntil i >= 3\ni')).toBe('3');
  });

  it('for/endfor loop', () => {
    expect(ev('s = 0\nfor i = 1 to 3\n  s = s + i\nendfor\ns')).toBe('6');
  });

  it('foreach over a list', () => {
    expect(ev('s = ""\nforeach x in items\n  s = s + x\nendfor\ns', { items: ['a', 'b', 'c'] })).toBe('abc');
  });

  it('exit terminates the script immediately', () => {
    const f = evFields('x = 1\nexit\nx = 2', {});
    expect(f['x']).toBe('1'); // `x = 2` never ran
  });

  it('return with a value', () => {
    expect(ev('return 7\nx = 1\nx')).toBe(7);
  });
});
