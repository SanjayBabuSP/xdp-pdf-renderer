import {
  FormCalcParseError,
  FormCalcParser,
} from '../../../../src/domain/scripting/formcalc/parser';
import { TokenType, type Token } from '../../../../src/domain/scripting/formcalc/lexer';
import type {
  Program,
  ExprStmt,
  IfStmt,
  ForStmt,
  Literal,
  AssignExpr,
  CallExpr,
  FormCalcNode,
} from '../../../../src/domain/scripting/formcalc/ast';

interface InternalParser {
  tokens: Token[];
  pos: number;
  parseFieldRef(): FormCalcNode;
  parsePrimary(): FormCalcNode;
}

function token(type: TokenType, value: string): Token {
  return { type, value, line: 1, column: 1 };
}

function parseWithTokens(tokens: Token[], method: 'parseFieldRef' | 'parsePrimary'): FormCalcNode {
  const parser = new FormCalcParser('');
  const internal = parser as unknown as InternalParser;
  internal.tokens = [...tokens, token(TokenType.EOF, '')];
  internal.pos = 0;
  return internal[method]();
}

function program(src: string): Program {
  return new FormCalcParser(src).parse();
}

function first(src: string): ExprStmt {
  return program(src).body[0] as ExprStmt;
}

describe('FormCalcParser — statements', () => {
  it('parses break, continue and bare return', () => {
    expect(program('break\ncontinue\nreturn').body).toEqual([
      { type: 'BreakStmt' },
      { type: 'ContinueStmt' },
      { type: 'ReturnStmt', value: null },
    ]);
  });

  it('parses for loops with downto, step and do', () => {
    const stmt = program('for i = 10 downto 1 step 2 do\nx = i\nendfor').body[0] as ForStmt;
    expect(stmt).toEqual({
      type: 'ForStmt',
      variable: 'i',
      start: { type: 'Literal', value: 10, dataType: 'number' },
      end: { type: 'Literal', value: 1, dataType: 'number' },
      step: { type: 'Literal', value: 2, dataType: 'number' },
      body: [
        {
          type: 'ExprStmt',
          expr: {
            type: 'AssignExpr',
            operator: '=',
            target: { type: 'Identifier', name: 'x' },
            value: { type: 'Identifier', name: 'i' },
          },
        },
      ],
      isDownto: true,
    });
  });

  it('parses for loops with upto', () => {
    const stmt = program('for i = 1 upto 3\nendfor').body[0] as ForStmt;
    expect(stmt.isDownto).toBe(false);
    expect(stmt.step).toBe(null);
  });

  it('rejects a for loop without a range keyword', () => {
    expect(() => program('for i = 1\nx = i\nendfor')).toThrow(FormCalcParseError);
  });

  it('parses foreach, while and repeat bodies with optional do', () => {
    expect(program('foreach x in items do\nx\nendfor').body[0].type).toBe('ForEachStmt');
    expect(program('while x < 3 do\nx = x + 1\nendwhile').body[0].type).toBe('WhileStmt');
    expect(program('repeat\nx = x + 1\nuntil x > 3').body[0].type).toBe('RepeatStmt');
  });

  it('parses var declarations with a type and with an initializer', () => {
    const body = program('var a as integer = 3\nvar b').body;
    expect(body[0]).toEqual({
      type: 'VarDecl',
      name: 'a',
      initializer: { type: 'Literal', value: 3, dataType: 'number' },
    });
    expect(body[1]).toEqual({ type: 'VarDecl', name: 'b', initializer: null });
  });

  it('parses an else-if chain with two-word end', () => {
    const stmt = program('if a then\nx = 1\nelseif b then\nx = 2\nelse\nx = 3\nend if')
      .body[0] as IfStmt;
    expect(stmt.elseIfBranches).toHaveLength(1);
    expect(stmt.elseBranch).toEqual([
      {
        type: 'ExprStmt',
        expr: {
          type: 'AssignExpr',
          operator: '=',
          target: { type: 'Identifier', name: 'x' },
          value: { type: 'Literal', value: 3, dataType: 'number' },
        },
      },
    ]);
  });

  it('reports a missing block terminator', () => {
    expect(() => program('if a then\nx = 1')).toThrow(/Expected end block/);
  });

  it('reports a missing expected token', () => {
    expect(() => program('if a\nx = 1\nendif')).toThrow(/Expected THEN/);
  });
});

describe('FormCalcParser — expressions', () => {
  it('parses exponentiation and repeated unary operators', () => {
    expect(first('2 ^ 3').expr).toEqual({
      type: 'PowerExpr',
      base: { type: 'Literal', value: 2, dataType: 'number' },
      exponent: { type: 'Literal', value: 3, dataType: 'number' },
    });
    expect(first('--5').expr).toEqual({
      type: 'UnaryExpr',
      operator: '-',
      operand: {
        type: 'UnaryExpr',
        operator: '-',
        operand: { type: 'Literal', value: 5, dataType: 'number' },
      },
    });
    expect(first('+5').expr).toEqual({
      type: 'UnaryExpr',
      operator: '+',
      operand: { type: 'Literal', value: 5, dataType: 'number' },
    });
  });

  it('parses repeated not operators', () => {
    expect(first('not not 1').expr).toEqual({
      type: 'NotExpr',
      operand: {
        type: 'NotExpr',
        operand: { type: 'Literal', value: 1, dataType: 'number' },
      },
    });
  });

  it('parses literal forms including hex, booleans and callable null', () => {
    expect((first('#FF').expr as Literal).dataType).toBe('hex');
    expect(first('true').expr).toEqual({ type: 'Literal', value: true, dataType: 'boolean' });
    expect(first('false').expr).toEqual({ type: 'Literal', value: false, dataType: 'boolean' });
    expect(first('null()').expr).toEqual({ type: 'CallExpr', name: 'null', args: [] });
    expect(first('null').expr).toEqual({ type: 'Literal', value: null, dataType: 'null' });
  });

  it('parses data-type keywords used as identifiers', () => {
    expect(first('integer').expr).toEqual({ type: 'Identifier', name: 'integer' });
    expect(first('string').expr).toEqual({ type: 'Identifier', name: 'string' });
    expect(first('date').expr).toEqual({ type: 'Identifier', name: 'date' });
    expect(first('float').expr).toEqual({ type: 'Identifier', name: 'float' });
    expect(first('boolean').expr).toEqual({ type: 'Identifier', name: 'boolean' });
    expect(first('time').expr).toEqual({ type: 'Identifier', name: 'time' });
    expect(first('datetime').expr).toEqual({ type: 'Identifier', name: 'datetime' });
    expect(first('mod').expr).toEqual({ type: 'Identifier', name: 'mod' });
    expect((first('x = if(1, 2, 3)').expr as AssignExpr).value as CallExpr).toEqual({
      type: 'CallExpr',
      name: 'if',
      args: [
        { type: 'Literal', value: 1, dataType: 'number' },
        { type: 'Literal', value: 2, dataType: 'number' },
        { type: 'Literal', value: 3, dataType: 'number' },
      ],
    });
  });

  it('parses escaped string contents via the lexer', () => {
    expect(first('"a\\u0041b"').expr).toEqual({
      type: 'Literal',
      value: 'aAb',
      dataType: 'string',
    });
  });

  it('does not treat a parenthesised expression as a callable name', () => {
    expect(program('(1)(2)').body).toHaveLength(2);
  });

  it('rejects an unexpected token', () => {
    expect(() => program(')')).toThrow(/Unexpected token/);
  });
});

describe('FormCalcParser — field references and property access', () => {
  it('parses dollar-prefixed identifiers and dotted field references', () => {
    expect(first('$field').expr).toEqual({ type: 'Identifier', name: '$field' });
    expect(first('$$form.field').expr).toEqual({
      type: 'FieldRef',
      prefix: '$',
      path: '$$form.field',
      index: undefined,
    });
  });

  it('parses wildcard and descendent path suffixes', () => {
    expect((first('$.a.*').expr as { path: string }).path).toBe('$.a.*');
    expect((first('$.a..b').expr as { path: string }).path).toBe('$.a..');
  });

  it('rejects a trailing dot with no valid path suffix', () => {
    expect(() => program('$.a.#')).toThrow(/Unexpected token/);
  });

  it('parses numeric and expression indexes on field references', () => {
    expect((first('$.rows[2]').expr as { path: string }).path).toBe('$.rows[2]');
    const indexed = first('$.rows[i]').expr as { index: unknown };
    expect(indexed.index).toEqual({ type: 'Identifier', name: 'i' });
  });

  it('parses chained property access on call results', () => {
    const expr = first('xfa.resolveNode("a").value.name').expr;
    expect(expr).toEqual({
      type: 'PropAccess',
      object: {
        type: 'PropAccess',
        object: {
          type: 'CallExpr',
          name: 'xfa.resolveNode',
          args: [{ type: 'Literal', value: 'a', dataType: 'string' }],
        },
        property: 'value',
      },
      property: 'name',
    });
  });
});

describe('FormCalcParser — dollar-prefixed field references', () => {
  it('parses a field reference with a dotted path and an index', () => {
    expect(
      parseWithTokens(
        [
          token(TokenType.DOLLAR, '$'),
          token(TokenType.IDENT, 'field'),
          token(TokenType.DOT, '.'),
          token(TokenType.IDENT, 'child'),
          token(TokenType.LBRACKET, '['),
          token(TokenType.NUMBER, '2'),
          token(TokenType.RBRACKET, ']'),
        ],
        'parseFieldRef'
      )
    ).toEqual({
      type: 'FieldRef',
      prefix: '$',
      path: 'field.child',
      index: { type: 'Literal', value: 2, dataType: 'number' },
    });
  });

  it('parses string paths and wildcard, hash and descendent suffixes', () => {
    expect(
      parseWithTokens(
        [token(TokenType.DOUBLE_DOLLAR, '$$'), token(TokenType.STRING, 'a.b')],
        'parseFieldRef'
      )
    ).toEqual({ type: 'FieldRef', prefix: '$$', path: 'a.b', index: undefined });
    expect(
      parseWithTokens(
        [token(TokenType.DOLLAR, '$'), token(TokenType.DOT, '.'), token(TokenType.STAR, '*')],
        'parseFieldRef'
      )
    ).toEqual({ type: 'FieldRef', prefix: '$', path: '.*', index: undefined });
    expect(
      parseWithTokens(
        [token(TokenType.DOLLAR, '$'), token(TokenType.DOT, '.'), token(TokenType.HASH, '#')],
        'parseFieldRef'
      )
    ).toEqual({ type: 'FieldRef', prefix: '$', path: '.#', index: undefined });
    expect(
      parseWithTokens(
        [
          token(TokenType.DOLLAR, '$'),
          token(TokenType.DOT, '.'),
          token(TokenType.DOT, '.'),
          token(TokenType.IDENT, 'x'),
        ],
        'parseFieldRef'
      )
    ).toEqual({ type: 'FieldRef', prefix: '$', path: '..', index: undefined });
  });

  it('rejects a field reference without a path', () => {
    expect(() =>
      parseWithTokens([token(TokenType.DOLLAR, '$'), token(TokenType.PLUS, '+')], 'parseFieldRef')
    ).toThrow(/Expected field path/);
  });

  it('dispatches dollar tokens to the field-reference parser', () => {
    expect(
      parseWithTokens(
        [token(TokenType.DOLLAR, '$'), token(TokenType.DOT, '.'), token(TokenType.IDENT, 'f')],
        'parsePrimary'
      )
    ).toEqual({ type: 'FieldRef', prefix: '$', path: '.f', index: undefined });
  });
});
