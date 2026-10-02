// ────────────────────────────────────────────────────────────────────────────
// FormCalc Parser — Recursive descent parser for FormCalc → AST
// ────────────────────────────────────────────────────────────────────────────

import { FormCalcLexer, Token, TokenType } from './lexer';
import {
  Program,
  ExprStmt,
  IfStmt,
  ForStmt,
  ForEachStmt,
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
    if (lexer.error) {
      const e = lexer.error;
      throw new FormCalcParseError(e.message, e.line, e.column);
    }
  }

  parse(): Program {
    const body = this.parseBlock();
    this.expect(TokenType.EOF);
    return { type: 'Program', body };
  }

  // ─── Statements ──────────────────────────────────────────────────────

  private parseBlock(): FormCalcNode[] {
    const stmts: FormCalcNode[] = [];
    while (
      !this.isAtEnd() &&
      !this.check(TokenType.END) &&
      !this.check(TokenType.ENDIF) &&
      !this.check(TokenType.ENDFOR) &&
      !this.check(TokenType.ENDWHILE) &&
      !this.check(TokenType.ELSE) &&
      !this.check(TokenType.ELSEIF) &&
      !this.check(TokenType.UNTIL)
    ) {
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  /** Accept `end` or a specific terminator keyword (`endif`, `endfor`, …). */
  private expectBlockEnd(...terminators: TokenType[]): void {
    if (terminators.some((t) => this.check(t))) {
      this.advance();
      return;
    }
    if (this.check(TokenType.END)) {
      this.advance();
      // Two-word forms: `end if`, `end for`, `end foreach`, `end while`
      if (
        this.check(TokenType.IF) ||
        this.check(TokenType.FOR) ||
        this.check(TokenType.FOREACH) ||
        this.check(TokenType.WHILE)
      ) {
        this.advance();
      }
      return;
    }
    const tok = this.current();
    throw new FormCalcParseError(
      `Expected end block but got ${tok.type} ('${tok.value}')`,
      tok.line,
      tok.column
    );
  }

  private parseStatement(): FormCalcNode | null {
    if (this.check(TokenType.IF)) return this.parseIf();
    if (this.check(TokenType.FOR)) return this.parseFor();
    if (this.check(TokenType.FOREACH)) return this.parseForEach();
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
    this.expectBlockEnd(TokenType.ENDIF);
    return { type: 'IfStmt', condition, thenBranch, elseIfBranches, elseBranch };
  }

  private parseFor(): ForStmt {
    this.expect(TokenType.FOR);
    const variable = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.EQUAL);
    const start = this.parseExpression();
    // `to` / `upto` ascend, `downto` descends (keyword table :23176)
    const isDownto = this.check(TokenType.DOWNTO);
    if (!isDownto && !this.check(TokenType.TO) && !this.check(TokenType.UPTO)) {
      const tok = this.current();
      throw new FormCalcParseError(
        `Expected to/upto/downto but got ${tok.type} ('${tok.value}')`,
        tok.line,
        tok.column
      );
    }
    this.advance();
    const end = this.parseExpression();
    let step: FormCalcNode | null = null;
    if (this.check(TokenType.STEP)) {
      this.advance();
      step = this.parseExpression();
    }
    if (this.check(TokenType.DO)) this.advance(); // optional `do`
    const body = this.parseBlock();
    this.expectBlockEnd(TokenType.ENDFOR);
    return { type: 'ForStmt', variable, start, end, step, body, isDownto };
  }

  /** `foreach <var> in <expr> [do] … endfor` — iterate a node list/array. */
  private parseForEach(): ForEachStmt {
    this.expect(TokenType.FOREACH);
    const variable = this.expect(TokenType.IDENT).value;
    this.expect(TokenType.IN);
    const iterable = this.parseExpression();
    if (this.check(TokenType.DO)) this.advance(); // optional `do`
    const body = this.parseBlock();
    this.expectBlockEnd(TokenType.ENDFOR);
    return { type: 'ForEachStmt', variable, iterable, body };
  }

  private parseWhile(): WhileStmt {
    this.expect(TokenType.WHILE);
    const condition = this.parseExpression();
    if (this.check(TokenType.DO)) this.advance(); // optional `do`
    const body = this.parseBlock();
    this.expectBlockEnd(TokenType.ENDWHILE);
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
    const retTok = this.expect(TokenType.RETURN);
    let value: FormCalcNode | null = null;
    const isTerminator =
      this.isAtEnd() ||
      this.check(TokenType.END) ||
      this.check(TokenType.ENDIF) ||
      this.check(TokenType.ENDFOR) ||
      this.check(TokenType.ENDWHILE) ||
      this.check(TokenType.ELSE) ||
      this.check(TokenType.ELSEIF) ||
      this.check(TokenType.UNTIL);
    // A bare `return`/`exit` ends at the line break; the value form must be
    // on the same line as the keyword.
    if (!isTerminator && this.current().line === retTok.line) {
      value = this.parseExpression();
    }
    return { type: 'ReturnStmt', value };
  }

  private parseVarDecl(): VarDecl {
    this.expect(TokenType.VAR);
    const name = this.expect(TokenType.IDENT).value;
    // Optional type annotation: `var x as string = "a"` (cast keywords)
    if (this.check(TokenType.as)) {
      this.advance();
      this.advance(); // type token (string/integer/date/…)
    }
    let initializer: FormCalcNode | null = null;
    if (this.check(TokenType.EQUAL)) {
      this.advance();
      initializer = this.parseExpression();
    }
    return { type: 'VarDecl', name, initializer };
  }

  private parseExprStmt(): ExprStmt {
    const expr = this.parseExpression();
    // FormCalc uses '=' for both assignment and comparison. In statement
    // context a top-level '=' whose left side is a name or field ref is an
    // assignment (evaluated by evalAssign); comparisons only appear nested
    // inside conditions/expressions, which are parsed via parseExpression.
    if (
      expr.type === 'CompareExpr' &&
      expr.operator === '=' &&
      (expr.left.type === 'Identifier' || expr.left.type === 'FieldRef')
    ) {
      return {
        type: 'ExprStmt',
        expr: { type: 'AssignExpr', operator: '=', target: expr.left, value: expr.right },
      };
    }
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
    // `&` is the symbolic Logical AND (doc operator table; engine token 0x102)
    while (this.check(TokenType.AND) || this.check(TokenType.AMPERSAND)) {
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
    let left = this.parseAdd();
    for (;;) {
      const tok = this.current();
      let op: string | null = null;
      switch (tok.type) {
        case TokenType.EQUAL: op = tok.value === '==' ? '==' : '='; break;
        case TokenType.EQ: op = 'eq'; break;
        case TokenType.NOT_EQUAL: op = tok.value === 'ne' || tok.value === 'NE' ? 'ne' : '<>'; break;
        case TokenType.LESS: op = tok.value.toLowerCase() === 'lt' ? 'lt' : '<'; break;
        case TokenType.LESS_EQUAL: op = tok.value.toLowerCase() === 'le' ? 'le' : '<='; break;
        case TokenType.GREATER: op = tok.value.toLowerCase() === 'gt' ? 'gt' : '>'; break;
        case TokenType.GREATER_EQUAL: op = tok.value.toLowerCase() === 'ge' ? 'ge' : '>='; break;
        default: break;
      }
      if (op === null) break;
      this.advance();
      const right = this.parseAdd();
      left = { type: 'CompareExpr', operator: op as never, left, right };
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
      if (this.check(TokenType.DOT)) {
        // SOM path chaining on a bare identifier: a.b, a.b.c, a.. (parent),
        // a.# (index), a.* (all) — evidence: path chaining at :16746
        if (expr.type === 'Identifier') {
          expr = { type: 'FieldRef', prefix: '$', path: expr.name };
          continue;
        }
        if (expr.type === 'FieldRef') {
          const next = this.tokens[this.pos + 1];
          if (next && next.type === TokenType.IDENT) {
            this.advance(); // .
            this.advance(); // ident
            expr = { ...expr, path: expr.path + '.' + next.value };
            continue;
          }
          if (next && next.type === TokenType.STAR) {
            this.advance();
            this.advance();
            expr = { ...expr, path: expr.path + '.*' };
            continue;
          }
          if (next && next.type === TokenType.HASH) {
            this.advance();
            this.advance();
            expr = { ...expr, path: expr.path + '.#' };
            continue;
          }
          if (next && next.type === TokenType.DOT) {
            this.advance(); // first .
            this.advance(); // second .
            expr = { ...expr, path: expr.path + '..' };
            continue;
          }
        }
        break;
      }
      if (this.check(TokenType.LBRACKET) && expr.type === 'FieldRef' && expr.index === undefined) {
        this.advance();
        const index = this.parseExpression();
        this.expect(TokenType.RBRACKET);
        expr = { ...expr, index };
        continue;
      }
      if (this.check(TokenType.LPAREN)) {
        // Function/method call: `foo(...)` or `xfa.host.messageBox(...)`
        let name: string | null = null;
        if (expr.type === 'Identifier') name = expr.name;
        else if (expr.type === 'FieldRef') name = expr.path;
        if (name === null) break;
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
        expr = { type: 'CallExpr', name, args };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): FormCalcNode {
    // Field reference: $ or $$
    if (this.check(TokenType.DOLLAR) || this.check(TokenType.DOUBLE_DOLLAR)) {
      return this.parseFieldRef();
    }

    // Literal: null — unless called as the Null() function (doc p82)
    if (this.check(TokenType.NULL)) {
      if (this.tokens[this.pos + 1]?.type === TokenType.LPAREN) {
        const tok = this.advance();
        return { type: 'Identifier', name: tok.value.toLowerCase() };
      }
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

    // Type keywords double as function names in call position — `Date()`,
    // `Time()`, `Integer(x)`, … (the engine registry registers DATE/TIME);
    // parsePostfix turns `kw(` into a CallExpr. Otherwise treat the keyword
    // as a plain identifier (a field/var may be named `date` or `time`).
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
      return { type: 'Identifier', name: tok.value };
    }

    // `mod(...)` (builtin MOD, registry FUN_15d086b0) and `if(...)`
    // (builtin IF, FUN_15d06ed0) are callable in primary position; the
    // keywords are only operators/statements when they lead a construct.
    if (
      this.check(TokenType.MOD) ||
      (this.check(TokenType.IF) && this.tokens[this.pos + 1]?.type === TokenType.LPAREN)
    ) {
      const tok = this.advance();
      return { type: 'Identifier', name: tok.value.toLowerCase() };
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
    // `$.rawValue` / `$.presence` — the scripting object itself — leaves the
    // path empty; the dotted continuation below then yields ".rawValue",
    // which the field accessor resolves against the current node.
    let path = '';
    if (this.check(TokenType.IDENT)) {
      path = this.advance().value;
    } else if (this.check(TokenType.STRING)) {
      // $ "path.to.field" — quoted SOM expression
      path = this.advance().value;
    } else if (!this.check(TokenType.DOT)) {
      throw new FormCalcParseError(
        `Expected field path after '${prefix}'`,
        prefixTok.line,
        prefixTok.column
      );
    }

    // Handle dotted path continuation: $field.subfield, $field.*,
    // $field.# (Occurrence.esi), $field.. (parent)
    while (this.check(TokenType.DOT)) {
      const next = this.tokens[this.pos + 1];
      if (next?.type === TokenType.IDENT) {
        this.advance();
        path += '.' + this.advance().value;
      } else if (next?.type === TokenType.STAR) {
        this.advance();
        this.advance();
        path += '.*';
      } else if (next?.type === TokenType.HASH) {
        this.advance();
        this.advance();
        path += '.#';
      } else if (next?.type === TokenType.DOT) {
        this.advance();
        this.advance();
        path += '..';
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
