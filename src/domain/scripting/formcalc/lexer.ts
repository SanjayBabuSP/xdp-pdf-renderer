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
  ENDFOR = 'ENDFOR',
  ENDIF = 'ENDIF',
  ENDWHILE = 'ENDWHILE',
  FOR = 'FOR',
  FOREACH = 'FOREACH',
  IN = 'IN',
  TO = 'TO',
  DOWNTO = 'DOWNTO',
  UPTO = 'UPTO',
  STEP = 'STEP',
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
  /** mnemonic `eq` — always a comparison, never assignment (token 0x0103 ≠ '=' 0x3d) */
  EQ = 'EQ',
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

/**
 * Decode the escape sequences Adobe FormCalc's parser handles inside string
 * literals (FUN_15d0ead0 at jfformcalc_disasm.c:14611): only `\uXXXX`
 * (4 hex digits) and `\UXXXXXXXX` (8 hex digits, UTF-16 with surrogate
 * pairing). Every other backslash sequence is left literal — the engine's
 * lexer never processes backslash escapes, so `"\n"` is backslash + n.
 */
export function decodeFormCalcString(raw: string): string {
  if (raw.indexOf('\\') === -1) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const marker = raw[i + 1];
    if (marker === 'u' || marker === 'U') {
      const hexLen = marker === 'u' ? 4 : 8;
      const hex = raw.slice(i + 2, i + 2 + hexLen);
      if (hex.length === hexLen && /^[0-9a-fA-F]+$/.test(hex)) {
        const code = parseInt(hex, 16);
        if (code <= 0xffff) {
          out += String.fromCharCode(code);
          i += 1 + hexLen;
          continue;
        }
        // \UXXXXXXXX above BMP: encode as UTF-16 surrogate pair
        const cp = code - 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        i += 1 + hexLen;
        continue;
      }
    }
    // Not a recognized escape — keep the backslash literally
    out += ch;
  }
  return out;
}

const KEYWORDS: Record<string, TokenType> = {
  if: TokenType.IF,
  then: TokenType.THEN,
  else: TokenType.ELSE,
  elseif: TokenType.ELSEIF,
  end: TokenType.END,
  endfor: TokenType.ENDFOR,
  endif: TokenType.ENDIF,
  endwhile: TokenType.ENDWHILE,
  for: TokenType.FOR,
  foreach: TokenType.FOREACH,
  in: TokenType.IN,
  to: TokenType.TO,
  upto: TokenType.UPTO,
  downto: TokenType.DOWNTO,
  step: TokenType.STEP,
  while: TokenType.WHILE,
  do: TokenType.DO,
  repeat: TokenType.REPEAT,
  until: TokenType.UNTIL,
  break: TokenType.BREAK,
  continue: TokenType.CONTINUE,
  return: TokenType.RETURN,
  exit: TokenType.RETURN, // exit ≡ return — same token 0x0124 in the engine
  var: TokenType.VAR,
  null: TokenType.NULL,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  xor: TokenType.XOR,
  mod: TokenType.MOD,
  eq: TokenType.EQ,
  ne: TokenType.NOT_EQUAL,
  gt: TokenType.GREATER,
  ge: TokenType.GREATER_EQUAL,
  lt: TokenType.LESS,
  le: TokenType.LESS_EQUAL,
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
  /** Lexical error captured for the parser (unterminated string, …) */
  error: { message: string; line: number; column: number } | null = null;

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

    // Line comment: ';' (Adobe FormCalc comment — `;` and `//` only, no /* */)
    if (ch === ';') {
      this.skipLineComment();
      return this.next();
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
    if (this.isAlpha(ch) || ch === '_' || ch === '$' || ch === '!') {
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
        if (this.peek() === '=') { this.advance(); return { type: TokenType.EQUAL, value: '==', line: startLine, column: startCol }; }
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
      case '|':
        // Logical OR operator (doc operator table: Logical OR `|` `or`;
        // engine lexer maps 0x7c → OR token at jfformcalc_disasm.c:21207)
        return { type: TokenType.OR, value: '|', line: startLine, column: startCol };
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

  /**
   * String literal. evidence: the Adobe lexer does NO backslash processing
   * (jfformcalc_disasm.c:21053-21130) — a doubled quote "" embeds a quote,
   * and the parser's decode step (FUN_15d0ead0 :14611) handles only
   * \uXXXX / \UXXXXXXXX (UTF-16 with surrogate pairing); every other
   * backslash sequence stays literal. So "\n" is backslash + n, NOT newline.
   */
  private readString(line: number, column: number): Token {
    this.advance(); // opening quote
    let raw = '';
    let closed = false;
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === '"') {
        this.advance();
        if (this.peek() === '"') {
          // Doubled quote embeds a literal quote and the string continues.
          this.advance();
          raw += '"';
          continue;
        }
        closed = true;
        break; // closing quote
      }
      raw += this.advance();
    }
    if (!closed) {
      this.error = { message: 'Unterminated string literal', line, column };
    }
    return { type: TokenType.STRING, value: decodeFormCalcString(raw), line, column };
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
    // ! is a valid start — alias for the root xfa.datasets (e.g. !dbresult)
    if (this.peek() === '!') {
      value += this.advance();
    }
    // $ is a valid start for XFA references like $field
    if (this.peek() === '$') {
      value += this.advance();
      // Check for $$ (form-level reference)
      if (!this.isAtEnd() && this.peek() === '$') {
        value += this.advance();
      }
    }
    while (
      !this.isAtEnd() &&
      (this.isAlphaNumeric(this.peek()) || this.peek() === '_' || this.peek() === '!')
    ) {
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
