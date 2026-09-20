// ────────────────────────────────────────────────────────────────────────────
// FormCalc Parser — Recursive descent parser for FormCalc → AST
// ────────────────────────────────────────────────────────────────────────────

import { FormCalcLexer, Token, TokenType } from './lexer';
import {
  Program,
  ExprStmt,
  IfStmt,
  ForStmt,
  WhileStmt,
  RepeatStmt,
  BreakStmt,
  ContinueStmt,
  ReturnStmt,
  VarDecl,
  AssignExpr,
  FormCalcNode,
} from './ast';

export class FormCalcParseError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`FormCalc Parse Error (line ${line}, col ${column}): ${message}`);
  }
}

export class FormCalcParser {
  private tokens: Token[];
  private pos = 0;

  constructor(source: string) {
    const lexer = new FormCalcLexer(source);
    this.tokens = lexer.tokenize();
  }

  parse(): Program {
    const body = this.parseBlock();
    this.expect(TokenType.EOF);
    return { type: 'Program', body };
  }

  // ─── Statements ──────────────────────────────────────────────────────

  private parseBlock(): FormCalcNode[] {
    const stmts: FormCalcNode[] = [];
    while (!this.isAtEnd() && !this.check(TokenType.END) && !this.check(TokenType.ELSE) && !this.check(TokenType.ELSEIF)) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  private parseStatement(): FormCalcNode | null {
    if (this.check(TokenType.IF)) return this.parseIf();
    if (this.check(TokenType.FOR)) return this.parseFor();
    if (this.check(TokenType.WHILE)) return this.parseWhile();
    if (this.check(TokenType.REPEAT)) return this.parseRepeat();
    if (this.check(TokenType.BREAK)) { this.advance(); return { type: 'BreakStmt' }; }
    if (this.check(TokenType.CONTINUE)) { this.advance(); return { type: 'ContinueStmt' }; }
    if (this.check(TokenType.RETURN)) return this.parseReturn();
    if (this.check(TokenType.VAR)) return this.parseVarDecl();
    return this.parseExprStmt();
  }

  private parseIf(): IfStmt {
    this.expect(TokenType.IF);
    const condition = this.parseExpression();
    this.expect(TokenType.THEN);
    const thenBranch = this.parseBlock();
    const elseIfBranches: IfStmt['elseIfBranches'] = [];
    while (this.check(TokenType.ELSEIF)) {
      this.advance();
      const cond = this.parseExpression();
      this.expect(TokenType.THEN);
      const body = this.parseBlock();
      elseIfBranches.push({ condition: cond, body });
    }
    let elseBranch: FormCalcNode[] | null = null;
    if (this.check(TokenType.ELSE)) {
      this.advance();
      elseBranch = this.parseBlock();
    }
    this.expect(TokenType.END);
    return { type: 'IfStmt', condition, thenBranch, elseIfBranches, elseBranch };
  }

  private parseFor(): ForStmt {
    this.expect(TokenType.FOR);
    const variable = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.EQUAL);
    const start = this.parseExpression();
    const isDownto = this.check(TokenType.DOWNTO);
    this.advance(); // TO or DOWNTO
    const end = this.parseExpression();
    let step: FormCalcNode | null = null;
    if (this.check(TokenType.IDENT) && this.current().value.toLowerCase() === 'step') {
      this.advance();
      step = this.parseExpression();
    }
    this.expect(TokenType.DO);
    const body = this.parseBlock();
    this.expect(TokenType.END);
    return { type: 'ForStmt', variable, start, end, step, body, isDownto };
  }

  private parseWhile(): WhileStmt {
    this.expect(TokenType.WHILE);
    const condition = this.parseExpression();
    this.expect(TokenType.DO);
    const body = this.parseBlock();
    this.expect(TokenType.END);
    return { type: 'WhileStmt', condition, body };
  }

  private parseRepeat(): RepeatStmt {
    this.expect(TokenType.REPEAT);
    const body = this.parseBlock();
    this.expect(TokenType.UNTIL);
    const condition = this.parseExpression();
    return { type: 'RepeatStmt', condition, body };
  }

  private parseReturn(): ReturnStmt {
    this.expect(TokenType.RETURN);
    let value: FormCalcNode | null = null;
    if (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
      value = this.parseExpression();
    }
    return { type: 'ReturnStmt', value };
  }

  private parseVarDecl(): VarDecl {
    this.expect(TokenType.VAR);
    const name = this.expect(TokenType.IDENT).value;
    let initializer: FormCalcNode | null = null;
    if (this.check(TokenType.EQUAL)) {
      this.advance();
      initializer = this.parseExpression();
    }
    return { type: 'VarDecl', name, initializer };
  }

  private parseExprStmt(): ExprStmt {
    const expr = this.parseExpression();
    return { type: 'ExprStmt', expr };
  }

  // ─── Expressions (precedence climbing) ───────────────────────────────

  private parseExpression(): FormCalcNode {
    return this.parseOr();
  }

  private parseOr(): FormCalcNode {
    let left = this.parseXor();
    while (this.check(TokenType.OR)) {
      this.advance();
      const right = this.parseXor();
      left = { type: 'OrExpr', left, right };
    }
    return left;
  }

  private parseXor(): FormCalcNode {
    let left = this.parseAnd();
    while (this.check(TokenType.XOR)) {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'XorExpr', left, right };
    }
    return left;
  }

  private parseAnd(): FormCalcNode {
    let left = this.parseNot();
    while (this.check(TokenType.AND)) {
      this.advance();
      const right = this.parseNot();
      left = { type: 'AndExpr', left, right };
    }
    return left;
  }

  private parseNot(): FormCalcNode {
    if (this.check(TokenType.NOT)) {
      this.advance();
      const operand = this.parseNot();
      return { type: 'NotExpr', operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): FormCalcNode {
    let left = this.parseConcat();
    while (
      this.check(TokenType.EQUAL) ||
      this.check(TokenType.NOT_EQUAL) ||
      this.check(TokenType.LESS) ||
      this.check(TokenType.LESS_EQUAL) ||
      this.check(TokenType.GREATER) ||
      this.check(TokenType.GREATER_EQUAL)
    ) {
      const op = this.advance().value as '=' | '<>' | '<' | '<=' | '>' | '>=';
      const right = this.parseConcat();
      left = { type: 'CompareExpr', operator: op, left, right };
    }
    return left;
  }

  private parseConcat(): FormCalcNode {
    let left = this.parseAdd();
    while (this.check(TokenType.AMPERSAND) || this.check(TokenType.TILDE)) {
      this.advance();
      const right = this.parseAdd();
      left = { type: 'ConcatExpr', left, right };
    }
    return left;
  }

  private parseAdd(): FormCalcNode {
    let left = this.parseMul();
    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const op = this.advance().value as '+' | '-';
      const right = this.parseMul();
      left = { type: 'AddExpr', operator: op, left, right };
    }
    return left;
  }

  private parseMul(): FormCalcNode {
    let left = this.parsePower();
    while (this.check(TokenType.STAR) || this.check(TokenType.SLASH) || this.check(TokenType.BACKSLASH) || this.check(TokenType.MOD)) {
      const op = this.advance().value as '*' | '/' | '\\' | 'mod';
      const right = this.parsePower();
      left = { type: 'MulExpr', operator: op, left, right };
    }
    return left;
  }

  private parsePower(): FormCalcNode {
    let base = this.parseUnary();
    if (this.check(TokenType.CARET)) {
      this.advance();
      const exponent = this.parseUnary();
      base = { type: 'PowerExpr', base, exponent };
    }
    return base;
  }

  private parseUnary(): FormCalcNode {
    if (this.check(TokenType.MINUS)) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', operator: '-', operand };
    }
    if (this.check(TokenType.PLUS)) {
      this.advance();
      const operand = this.parseUnary();
      return { type: 'UnaryExpr', operator: '+', operand };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): FormCalcNode {
    let expr = this.parsePrimary();
    while (true) {
      if (this.check(TokenType.LPAREN)) {
        // Function call — only if the preceding node is an Identifier
        if (expr.type === 'Identifier') {
          this.advance(); // (
          const args: FormCalcNode[] = [];
          if (!this.check(TokenType.RPAREN)) {
            args.push(this.parseExpression());
            while (this.check(TokenType.COMMA)) {
              this.advance();
              args.push(this.parseExpression());
            }
          }
          this.expect(TokenType.RPAREN);
          expr = { type: 'CallExpr', name: (expr as { type: 'Identifier'; name: string }).name, args };
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return expr;
  }

  private parsePrimary(): FormCalcNode {
    // Field reference: $ or $$
    if (this.check(TokenType.DOLLAR) || this.check(TokenType.DOUBLE_DOLLAR)) {
      return this.parseFieldRef();
    }

    // Literal: null
    if (this.check(TokenType.NULL)) {
      this.advance();
      return { type: 'Literal', value: null, dataType: 'null' };
    }
    // Literal: true
    if (this.check(TokenType.TRUE)) {
      this.advance();
      return { type: 'Literal', value: true, dataType: 'boolean' };
    }
    // Literal: false
    if (this.check(TokenType.FALSE)) {
      this.advance();
      return { type: 'Literal', value: false, dataType: 'boolean' };
    }

    // Number literal
    if (this.check(TokenType.NUMBER)) {
      const tok = this.advance();
      const num = parseFloat(tok.value);
      return { type: 'Literal', value: num, dataType: 'number' };
    }

    // Hex literal
    if (this.check(TokenType.HEX_LITERAL)) {
      const tok = this.advance();
      return { type: 'Literal', value: tok.value, dataType: 'hex' };
    }

    // String literal
    if (this.check(TokenType.STRING)) {
      const tok = this.advance();
      return { type: 'Literal', value: tok.value, dataType: 'string' };
    }

    // Parenthesized expression
    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return expr;
    }

    // Identifier (variable name or built-in function name)
    if (this.check(TokenType.IDENT)) {
      const tok = this.advance();
      return { type: 'Identifier', name: tok.value };
    }

    // Cast expressions: INTEGER(expr), STRING(expr), etc.
    if (
      this.check(TokenType.INTEGER) ||
      this.check(TokenType.STRING_KEYWORD) ||
      this.check(TokenType.DATE_KEYWORD) ||
      this.check(TokenType.FLOAT_KEYWORD) ||
      this.check(TokenType.BOOLEAN_KEYWORD) ||
      this.check(TokenType.TIME_KEYWORD) ||
      this.check(TokenType.DATETIME_KEYWORD)
    ) {
      const tok = this.advance();
      this.expect(TokenType.LPAREN);
      const arg = this.parseExpression();
      this.expect(TokenType.RPAREN);
      return { type: 'CallExpr', name: tok.value.toLowerCase(), args: [arg] };
    }

    const tok = this.current();
    throw new FormCalcParseError(
      `Unexpected token '${tok.value}' (${tok.type})`,
      tok.line,
      tok.column
    );
  }

  private parseFieldRef(): FormCalcNode {
    const prefixTok = this.advance(); // $ or $$
    const prefix = prefixTok.value as '$' | '$$';

    // Read the SOM path: $field.subfield or $form.table.row[0].col
    let path = '';
    if (this.check(TokenType.IDENT)) {
      path = this.advance().value;
    } else if (this.check(TokenType.STRING)) {
      // $ "path.to.field" — quoted SOM expression
      path = this.advance().value;
    } else {
      throw new FormCalcParseError(
        `Expected field path after '${prefix}'`,
        prefixTok.line,
        prefixTok.column
      );
    }

    // Handle dotted path continuation: $field.subfield
    while (this.check(TokenType.DOT)) {
      this.advance();
      if (this.check(TokenType.IDENT)) {
        path += '.' + this.advance().value;
      } else if (this.check(TokenType.STAR)) {
        this.advance();
        path += '.*';
      } else {
        break;
      }
    }

    // Handle array index: $field[0]
    let index: FormCalcNode | undefined;
    if (this.check(TokenType.LBRACKET)) {
      this.advance();
      index = this.parseExpression();
      this.expect(TokenType.RBRACKET);
    }

    return { type: 'FieldRef', prefix, path, index };
  }

  // ─── Token helpers ───────────────────────────────────────────────────

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length || this.tokens[this.pos].type === TokenType.EOF;
  }

  private current(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1];
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    if (this.pos < this.tokens.length) this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    if (!this.check(type)) {
      const tok = this.current();
      throw new FormCalcParseError(
        `Expected ${type} but got ${tok.type} ('${tok.value}')`,
        tok.line,
        tok.column
      );
    }
    return this.advance();
  }
}
