// ────────────────────────────────────────────────────────────────────────────
// FormCalc AST Node types
// ────────────────────────────────────────────────────────────────────────────

export type FormCalcNode =
  | Program
  | ExprStmt
  | IfStmt
  | ForStmt
  | WhileStmt
  | RepeatStmt
  | BreakStmt
  | ContinueStmt
  | ReturnStmt
  | VarDecl
  | AssignExpr
  | OrExpr
  | XorExpr
  | AndExpr
  | NotExpr
  | CompareExpr
  | ConcatExpr
  | AddExpr
  | MulExpr
  | PowerExpr
  | UnaryExpr
  | CallExpr
  | FieldRef
  | Literal
  | Identifier;

export interface Program {
  type: 'Program';
  body: FormCalcNode[];
}

export interface ExprStmt {
  type: 'ExprStmt';
  expr: FormCalcNode;
}

export interface IfStmt {
  type: 'IfStmt';
  condition: FormCalcNode;
  thenBranch: FormCalcNode[];
  elseIfBranches: Array<{ condition: FormCalcNode; body: FormCalcNode[] }>;
  elseBranch: FormCalcNode[] | null;
}

export interface ForStmt {
  type: 'ForStmt';
  variable: string;
  start: FormCalcNode;
  end: FormCalcNode;
  step: FormCalcNode | null;
  body: FormCalcNode[];
  isDownto: boolean;
}

export interface WhileStmt {
  type: 'WhileStmt';
  condition: FormCalcNode;
  body: FormCalcNode[];
}

export interface RepeatStmt {
  type: 'RepeatStmt';
  condition: FormCalcNode;
  body: FormCalcNode[];
}

export interface BreakStmt {
  type: 'BreakStmt';
}

export interface ContinueStmt {
  type: 'ContinueStmt';
}

export interface ReturnStmt {
  type: 'ReturnStmt';
  value: FormCalcNode | null;
}

export interface VarDecl {
  type: 'VarDecl';
  name: string;
  initializer: FormCalcNode | null;
}

export interface AssignExpr {
  type: 'AssignExpr';
  target: FormCalcNode;
  operator: '=' | '+=' | '-=' | '*=' | '/=' | '~=' | '&=' | '\\=' | '^=';
  value: FormCalcNode;
}

export interface OrExpr {
  type: 'OrExpr';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface XorExpr {
  type: 'XorExpr';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface AndExpr {
  type: 'AndExpr';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface NotExpr {
  type: 'NotExpr';
  operand: FormCalcNode;
}

export interface CompareExpr {
  type: 'CompareExpr';
  operator: '=' | '<>' | '<' | '<=' | '>' | '>=';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface ConcatExpr {
  type: 'ConcatExpr';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface AddExpr {
  type: 'AddExpr';
  operator: '+' | '-';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface MulExpr {
  type: 'MulExpr';
  operator: '*' | '/' | '\\' | 'mod';
  left: FormCalcNode;
  right: FormCalcNode;
}

export interface PowerExpr {
  type: 'PowerExpr';
  base: FormCalcNode;
  exponent: FormCalcNode;
}

export interface UnaryExpr {
  type: 'UnaryExpr';
  operator: '-' | '+';
  operand: FormCalcNode;
}

export interface CallExpr {
  type: 'CallExpr';
  name: string;
  args: FormCalcNode[];
}

export interface FieldRef {
  type: 'FieldRef';
  /** The $ or $$ prefix */
  prefix: '$' | '$$';
  /** The SOM path after $ or $$ (e.g., "form.table.field1") */
  path: string;
  /** Whether this is an array index access */
  index?: FormCalcNode;
}

export interface Literal {
  type: 'Literal';
  value: string | number | boolean | null;
  dataType: 'string' | 'number' | 'boolean' | 'null' | 'hex';
}

export interface Identifier {
  type: 'Identifier';
  name: string;
}
