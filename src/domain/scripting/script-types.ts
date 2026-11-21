export type ScriptLanguage = 'formcalc' | 'javascript';

export type ScriptRunAt = 'deprecated' | 'docOpen' | 'docReady' | 'pageOpen' | 'pageClose';

export type XfaEventName =
  | 'initialize'
  | 'calculate'
  | 'validate'
  | 'click'
  | 'change'
  | 'enter'
  | 'exit'
  | 'preExecute'
  | 'postExecute'
  | 'preSign'
  | 'postSign'
  | 'preSave'
  | 'postSave'
  | 'ready'
  | 'docReady'
  | 'pageOpen'
  | 'pageClose'
  | 'postPrint'
  | 'prePrint'
  | 'preOpen'
  | 'postOpen'
  | 'preClose'
  | 'postClose'
  | string;

export interface ScriptSpec {
  content: string;
  contentType: ScriptLanguage;
  runAt?: ScriptRunAt;
  eventName?: XfaEventName;
}

export interface ScriptedEventSpec {
  name?: XfaEventName;
  activity?: string;
  ref?: string;
  scripts: ScriptSpec[];
}

export interface CalculateSpec {
  override?: string;
  script?: ScriptSpec;
}

export interface XfaNode {
  name: string;
  type: string;
  value: unknown;
  rawValue: string | null;
  presence: string;
  access: string;
  mandatory: string;
  relevant: string;
  boundNode: unknown;
  children: XfaNode[];
  parent: XfaNode | null;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  repeating?: boolean;
  index?: number;
}

export interface XfaEventObject {
  target: XfaNode | null;
  name: string;
  fullTrigger: boolean;
  type: string;
  changed: boolean;
  propagated: boolean;
  rejected: boolean;
  submitTrigger?: string;
}

export interface XfaHost {
  readonly name: string;
  alert(message: string): void;
  formatValue(value: unknown, picture: string): string;
  unformatValue(value: string, picture: string): unknown;
  readonly now: Date;
  readonly pathSeparator: string;
  readonly currentPage: number;
  readonly version: string;
}

export interface XfaModel {
  resolveNode(expression: string, context?: XfaNode): XfaNode | null;
  form: XfaNode;
}

export interface ScriptExecutionResult {
  success: boolean;
  returnValue?: unknown;
  error?: string;
  modifiedFields: string[];
}

export interface ScriptEngineConfig {
  maxExecutionTime?: number;
  maxRecursionDepth?: number;
  enableConsole?: boolean;
  strictMode?: boolean;
}

export interface ScriptableNode {
  type: string;
  name?: string;
  key?: string;
  path?: string;
  uid?: string;
  layoutNode?: unknown;
  parent?: ScriptableNode;
  bindRef?: string;
  bindMatch?: string;
  presence?: string;
  access?: string;
  resolvedValue?: unknown;
  formatPicture?: string;
  position?: { x?: number; y?: number; w?: number; h?: number; rotate?: number };
  events?: Array<{
    name?: string;
    activity?: string;
    ref?: string;
    script?: string;
    contentType?: string;
    runAt?: string;
  }>;
  calculate?: {
    override?: string;
    script?: ScriptSpec;
  };
  validate?: {
    script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string };
  };
  children?: ScriptableNode[];
  fillColor?: string;
  fontColor?: string;
  borderColor?: string;
}
