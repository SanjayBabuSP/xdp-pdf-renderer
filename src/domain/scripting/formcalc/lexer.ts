// ────────────────────────────────────────────────────────────────────────────
// FormCalc Lexer — Tokenizes FormCalc source code
// ────────────────────────────────────────────────────────────────────────────

export enum TokenType {
  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  IDENT = 'IDENT',
  HEX_LITERAL = 'HEX_LITERAL',

  // Keywords
  IF = 'IF',
  THEN = 'THEN',
  ELSE = 'ELSE',
  ELSEIF = 'ELSEIF',
  END = 'END',
  FOR = 'FOR',
  TO = 'TO',
  DOWNTO = 'DOWNTO',
  WHILE = 'WHILE',
  DO = 'DO',
  REPEAT = 'REPEAT',
  UNTIL = 'UNTIL',
  BREAK = 'BREAK',
  CONTINUE = 'CONTINUE',
  RETURN = 'RETURN',
  VAR = 'VAR',
  NULL = 'NULL',
  TRUE = 'TRUE',
  FALSE = 'FALSE',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  XOR = 'XOR',
  MOD = 'MOD',
  as = 'AS',
  FRACTIONAL = 'FRACTIONAL',
  INTEGER = 'INTEGER_KEYWORD',
  STRING_KEYWORD = 'STRING_KEYWORD',
  DATE_KEYWORD = 'DATE_KEYWORD',
  FLOAT_KEYWORD = 'FLOAT_KEYWORD',
  BOOLEAN_KEYWORD = 'BOOLEAN_KEYWORD',
  TIME_KEYWORD = 'TIME_KEYWORD',
  DATETIME_KEYWORD = 'DATETIME_KEYWORD',

  // Operators
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  CARET = 'CARET',
  BACKSLASH = 'BACKSLASH',
  EQUAL = 'EQUAL',
  NOT_EQUAL = 'NOT_EQUAL',
  LESS = 'LESS',
  LESS_EQUAL = 'LESS_EQUAL',
  GREATER = 'GREATER',
  GREATER_EQUAL = 'GREATER_EQUAL',
  ASSIGN = 'ASSIGN',
  PLUS_ASSIGN = 'PLUS_ASSIGN',
  MINUS_ASSIGN = 'MINUS_ASSIGN',
  STAR_ASSIGN = 'STAR_ASSIGN',
  SLASH_ASSIGN = 'SLASH_ASSIGN',
  CONCAT_ASSIGN = 'CONCAT_ASSIGN',
  AMPERSAND = 'AMPERSAND',
  TILDE = 'TILDE',
  DOLLAR = 'DOLLAR',
  DOUBLE_DOLLAR = 'DOUBLE_DOLLAR',
  DOT = 'DOT',
  COMMA = 'COMMA',
  SEMICOLON = 'SEMICOLON',
  COLON = 'COLON',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  AT_SIGN = 'AT_SIGN',
  HASH = 'HASH',
  QUESTION = 'QUESTION',

  // Special
  EOF = 'EOF',
  NEWLINE = 'NEWLINE',
  ERROR = 'ERROR',
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  if: TokenType.IF,
  then: TokenType.THEN,
  else: TokenType.ELSE,
  elseif: TokenType.ELSEIF,
  end: TokenType.END,
  for: TokenType.FOR,
  to: TokenType.TO,
  downto: TokenType.DOWNTO,
  while: TokenType.WHILE,
  do: TokenType.DO,
  repeat: TokenType.REPEAT,
  until: TokenType.UNTIL,
  break: TokenType.BREAK,
  continue: TokenType.CONTINUE,
  return: TokenType.RETURN,
  var: TokenType.VAR,
  null: TokenType.NULL,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  xor: TokenType.XOR,
  mod: TokenType.MOD,
  as: TokenType.as,
  fractional: TokenType.FRACTIONAL,
  integer: TokenType.INTEGER,
  'string': TokenType.STRING_KEYWORD,
  date: TokenType.DATE_KEYWORD,
  float: TokenType.FLOAT_KEYWORD,
  boolean: TokenType.BOOLEAN_KEYWORD,
  time: TokenType.TIME_KEYWORD,
  datetime: TokenType.DATETIME_KEYWORD,
};

export class FormCalcLexer {
  private source: string;
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (!this.isAtEnd()) {
      const token = this.next();
      if (token.type !== TokenType.NEWLINE) {
        tokens.push(token);
      }
    }
    tokens.push({ type: TokenType.EOF, value: '', line: this.line, column: this.column });
    return tokens;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private peek(): string {
    return this.source[this.pos] ?? '';
  }

  private peekNext(): string {
    return this.source[this.pos + 1] ?? '';
  }

  private advance(): string {
    const ch = this.source[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private makeToken(type: TokenType, value: string): Token {
    return { type, value, line: this.line, column: this.column };
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
      } else if (ch === '\n') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private skipLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.advance();
    }
  }

  private skipBlockComment(): void {
    while (!this.isAtEnd()) {
      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance(); // *
        this.advance(); // /
        return;
      }
      this.advance();
    }
  }

  next(): Token {
    this.skipWhitespace();

    if (this.isAtEnd()) {
      return this.makeToken(TokenType.EOF, '');
    }

    const startLine = this.line;
    const startCol = this.column;
    const ch = this.peek();

    // Line comment: // or REM
    if (ch === '/' && this.peekNext() === '/') {
      this.skipLineComment();
      return this.next();
    }

    // Block comment: /* ... */
    if (ch === '/' && this.peekNext() === '*') {
      this.advance(); // /
      this.advance(); // *
      this.skipBlockComment();
      return this.next();
    }

    // REM keyword as line comment
    if (ch === 'r' || ch === 'R') {
      const remaining = this.source.slice(this.pos).toLowerCase();
      if (remaining.startsWith('rem ') || remaining === 'rem') {
        this.skipLineComment();
        return this.next();
      }
    }

    // Newlines
    if (ch === '\n') {
      this.advance();
      return { type: TokenType.NEWLINE, value: '\n', line: startLine, column: startCol };
    }

    // Strings
    if (ch === '"') {
      return this.readString(startLine, startCol);
    }

    // Hex literals: #FF00FF
    if (ch === '#') {
      return this.readHexLiteral(startLine, startCol);
    }

    // Numbers
    if (this.isDigit(ch) || (ch === '.' && this.isDigit(this.peekNext()))) {
      return this.readNumber(startLine, startCol);
    }

    // Identifiers and keywords
    if (this.isAlpha(ch) || ch === '_' || ch === '$') {
      return this.readIdent(startLine, startCol);
    }

    // Operators and punctuation
    this.advance();
    switch (ch) {
      case '+':
        if (this.peek() === '=') { this.advance(); return { type: TokenType.PLUS_ASSIGN, value: '+=', line: startLine, column: startCol }; }
        return { type: TokenType.PLUS, value: '+', line: startLine, column: startCol };
      case '-':
        if (this.peek() === '=') { this.advance(); return { type: TokenType.MINUS_ASSIGN, value: '-=', line: startLine, column: startCol }; }
        return { type: TokenType.MINUS, value: '-', line: startLine, column: startCol };
      case '*':
        if (this.peek() === '=') { this.advance(); return { type: TokenType.STAR_ASSIGN, value: '*=', line: startLine, column: startCol }; }
        return { type: TokenType.STAR, value: '*', line: startLine, column: startCol };
      case '/':
        if (this.peek() === '=') { this.advance(); return { type: TokenType.SLASH_ASSIGN, value: '/=', line: startLine, column: startCol }; }
        return { type: TokenType.SLASH, value: '/', line: startLine, column: startCol };
      case '\\':
        return { type: TokenType.BACKSLASH, value: '\\', line: startLine, column: startCol };
      case '^':
        return { type: TokenType.CARET, value: '^', line: startLine, column: startCol };
      case '~':
        if (this.peek() === '=') { this.advance(); return { type: TokenType.CONCAT_ASSIGN, value: '~=', line: startLine, column: startCol }; }
        return { type: TokenType.TILDE, value: '~', line: startLine, column: startCol };
      case '=':
        return { type: TokenType.EQUAL, value: '=', line: startLine, column: startCol };
      case '<':
        if (this.peek() === '>') { this.advance(); return { type: TokenType.NOT_EQUAL, value: '<>', line: startLine, column: startCol }; }
        if (this.peek() === '=') { this.advance(); return { type: TokenType.LESS_EQUAL, value: '<=', line: startLine, column: startCol }; }
        return { type: TokenType.LESS, value: '<', line: startLine, column: startCol };
      case '>':
        if (this.peek() === '=') { this.advance(); return { type: TokenType.GREATER_EQUAL, value: '>=', line: startLine, column: startCol }; }
        return { type: TokenType.GREATER, value: '>', line: startLine, column: startCol };
      case '&':
        return { type: TokenType.AMPERSAND, value: '&', line: startLine, column: startCol };
      case '.':
        return { type: TokenType.DOT, value: '.', line: startLine, column: startCol };
      case ',':
        return { type: TokenType.COMMA, value: ',', line: startLine, column: startCol };
      case ';':
        return { type: TokenType.SEMICOLON, value: ';', line: startLine, column: startCol };
      case ':':
        return { type: TokenType.COLON, value: ':', line: startLine, column: startCol };
      case '(':
        return { type: TokenType.LPAREN, value: '(', line: startLine, column: startCol };
      case ')':
        return { type: TokenType.RPAREN, value: ')', line: startLine, column: startCol };
      case '[':
        return { type: TokenType.LBRACKET, value: '[', line: startLine, column: startCol };
      case ']':
        return { type: TokenType.RBRACKET, value: ']', line: startLine, column: startCol };
      case '@':
        return { type: TokenType.AT_SIGN, value: '@', line: startLine, column: startCol };
      case '#':
        return { type: TokenType.HASH, value: '#', line: startLine, column: startCol };
      case '?':
        return { type: TokenType.QUESTION, value: '?', line: startLine, column: startCol };
      default:
        return { type: TokenType.ERROR, value: ch, line: startLine, column: startCol };
    }
  }

  private readString(line: number, column: number): Token {
    this.advance(); // opening quote
    let value = '';
    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\\' && this.peekNext() === '"') {
        this.advance();
        value += this.advance();
      } else if (this.peek() === '\\' && this.peekNext() === '\\') {
        this.advance();
        value += this.advance();
      } else if (this.peek() === '\\' && this.peekNext() === 'n') {
        this.advance();
        this.advance();
        value += '\n';
      } else if (this.peek() === '\\' && this.peekNext() === 't') {
        this.advance();
        this.advance();
        value += '\t';
      } else {
        value += this.advance();
      }
    }
    if (!this.isAtEnd()) {
      this.advance(); // closing quote
    }
    return { type: TokenType.STRING, value, line, column };
  }

  private readHexLiteral(line: number, column: number): Token {
    this.advance(); // #
    let value = '#';
    while (!this.isAtEnd() && /[\da-fA-F]/.test(this.peek())) {
      value += this.advance();
    }
    return { type: TokenType.HEX_LITERAL, value, line, column };
  }

  private readNumber(line: number, column: number): Token {
    let value = '';
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }
    if (!this.isAtEnd() && this.peek() === '.' && this.isDigit(this.peekNext())) {
      value += this.advance(); // .
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }
    // Handle scientific notation: 1.5e10, 1E-5
    if (!this.isAtEnd() && (this.peek() === 'e' || this.peek() === 'E')) {
      value += this.advance();
      if (!this.isAtEnd() && (this.peek() === '+' || this.peek() === '-')) {
        value += this.advance();
      }
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }
    return { type: TokenType.NUMBER, value, line, column };
  }

  private readIdent(line: number, column: number): Token {
    let value = '';
    // $ is a valid start for XFA references like $field
    if (this.peek() === '$') {
      value += this.advance();
      // Check for $$ (form-level reference)
      if (!this.isAtEnd() && this.peek() === '$') {
        value += this.advance();
      }
    }
    while (!this.isAtEnd() && (this.isAlphaNumeric(this.peek()) || this.peek() === '_')) {
      value += this.advance();
    }
    // Check for keyword
    const lower = value.toLowerCase();
    const keywordType = KEYWORDS[lower];
    if (keywordType) {
      return { type: keywordType, value, line, column };
    }
    return { type: TokenType.IDENT, value, line, column };
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}
