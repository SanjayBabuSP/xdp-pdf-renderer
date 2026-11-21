import {
  FormCalcLexer,
  TokenType,
  decodeFormCalcString,
  type Token,
} from '../../../../src/domain/scripting/formcalc/lexer';

function types(src: string): TokenType[] {
  return new FormCalcLexer(src)
    .tokenize()
    .map((token) => token.type)
    .filter((type) => type !== TokenType.EOF);
}

function values(src: string): string[] {
  return new FormCalcLexer(src)
    .tokenize()
    .filter((token) => token.type !== TokenType.EOF)
    .map((token) => token.value);
}

describe('FormCalcLexer — additional token coverage', () => {
  it('returns a raw string when there are no escapes', () => {
    expect(decodeFormCalcString('plain')).toBe('plain');
  });

  it('decodes eight-digit unicode escapes into surrogate pairs', () => {
    expect(decodeFormCalcString('\\U0001F600')).toBe('\u{1f600}');
    expect(decodeFormCalcString('\\u0041x')).toBe('Ax');
  });

  it('leaves malformed escapes untouched', () => {
    expect(decodeFormCalcString('\\u00ZZ')).toBe('\\u00ZZ');
    expect(decodeFormCalcString('\\q')).toBe('\\q');
  });

  it('skips block comments and rem comments', () => {
    expect(values('a /* hidden\nvalue */ b')).toEqual(['a', 'b']);
    expect(values('REM this is ignored\nb = 1')).toEqual(['b', '=', '1']);
    expect(values('rEm ignored\nb = 1')).toEqual(['b', '=', '1']);
  });

  it('reads hexadecimal literals', () => {
    expect(new FormCalcLexer('#FF00AA').tokenize()[0]).toEqual({
      type: TokenType.HEX_LITERAL,
      value: '#FF00AA',
      line: 1,
      column: 1,
    });
    expect(types('#')).toEqual([TokenType.HEX_LITERAL]);
  });

  it('reads integer, fractional and exponent numbers', () => {
    expect(values('0 12 .5 1.25 1e3 2E-2 3e+4')).toEqual([
      '0',
      '12',
      '.5',
      '1.25',
      '1e3',
      '2E-2',
      '3e+4',
    ]);
  });

  it('recognises every compound assignment and standalone operator', () => {
    expect(types('+= -= *= /= ~=')).toEqual([
      TokenType.PLUS_ASSIGN,
      TokenType.MINUS_ASSIGN,
      TokenType.STAR_ASSIGN,
      TokenType.SLASH_ASSIGN,
      TokenType.CONCAT_ASSIGN,
    ]);
    expect(types('~ \\ ^ & | : @ # ?')).toEqual([
      TokenType.TILDE,
      TokenType.BACKSLASH,
      TokenType.CARET,
      TokenType.AMPERSAND,
      TokenType.OR,
      TokenType.COLON,
      TokenType.AT_SIGN,
      TokenType.HEX_LITERAL,
      TokenType.QUESTION,
    ]);
    expect(values('+= -= *= /= ~=')).toEqual(['+=', '-=', '*=', '/=', '~=']);
  });

  it('reports an error token for an unrecognised character', () => {
    const token = new FormCalcLexer('§').tokenize()[0];
    expect(token.type).toBe(TokenType.ERROR);
    expect(token.value).toBe('§');
  });

  it('recognises $ and $$ identifiers and keyword tokens', () => {
    expect(values('$field $$field !flag _name')).toEqual(['$field', '$$field', '!flag', '_name']);
    expect(types('integer string date float boolean time datetime fractional as')).toEqual([
      TokenType.INTEGER,
      TokenType.STRING_KEYWORD,
      TokenType.DATE_KEYWORD,
      TokenType.FLOAT_KEYWORD,
      TokenType.BOOLEAN_KEYWORD,
      TokenType.TIME_KEYWORD,
      TokenType.DATETIME_KEYWORD,
      TokenType.FRACTIONAL,
      TokenType.as,
    ]);
    expect(types('eq ne gt ge lt le null true false and or not xor mod in')).toEqual([
      TokenType.EQ,
      TokenType.NOT_EQUAL,
      TokenType.GREATER,
      TokenType.GREATER_EQUAL,
      TokenType.LESS,
      TokenType.LESS_EQUAL,
      TokenType.NULL,
      TokenType.TRUE,
      TokenType.FALSE,
      TokenType.AND,
      TokenType.OR,
      TokenType.NOT,
      TokenType.XOR,
      TokenType.MOD,
      TokenType.IN,
    ]);
  });

  it('tracks line and column across newlines', () => {
    const tokens = new FormCalcLexer('a\nb').tokenize();
    expect(tokens[0]).toMatchObject({ line: 1, column: 1 });
    expect(tokens[1]).toMatchObject({ line: 2, column: 1 });
    expect(tokens[2]).toMatchObject({ type: TokenType.EOF, line: 2, column: 2 });
  });

  it('records an error for an unterminated string', () => {
    const lexer = new FormCalcLexer('"abc');
    const tokens = lexer.tokenize();
    expect(tokens[0].type).toBe(TokenType.STRING);
    expect(tokens[0].value).toBe('abc');
    expect(lexer.error).toEqual({ message: 'Unterminated string literal', line: 1, column: 1 });
  });

  it('returns EOF once the source is exhausted', () => {
    const lexer = new FormCalcLexer('');
    expect(lexer.next().type).toBe(TokenType.EOF);
  });
});

describe('FormCalcLexer — token shapes', () => {
  it('emits EOF with the final position', () => {
    const tokens = new FormCalcLexer('a = 1').tokenize();
    expect(tokens[tokens.length - 1]).toEqual({
      type: TokenType.EOF,
      value: '',
      line: 1,
      column: 6,
    });
  });

  it('keeps comparison operators distinct', () => {
    expect(types('< > <= >= <> == =')).toEqual([
      TokenType.LESS,
      TokenType.GREATER,
      TokenType.LESS_EQUAL,
      TokenType.GREATER_EQUAL,
      TokenType.NOT_EQUAL,
      TokenType.EQUAL,
      TokenType.EQUAL,
    ]);
  });

  it('emits delimiters and arithmetic operators', () => {
    expect(types('( ) [ ] , . + - * /')).toEqual([
      TokenType.LPAREN,
      TokenType.RPAREN,
      TokenType.LBRACKET,
      TokenType.RBRACKET,
      TokenType.COMMA,
      TokenType.DOT,
      TokenType.PLUS,
      TokenType.MINUS,
      TokenType.STAR,
      TokenType.SLASH,
    ]);
  });
});
