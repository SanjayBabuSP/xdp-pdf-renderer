// ────────────────────────────────────────────────────────────────────────────
// XFA Scripting types — FormCalc, JavaScript, and the XFA object model
// ────────────────────────────────────────────────────────────────────────────

/** Script content type as declared in XDP <script contentType="..."> */
export type ScriptLanguage = 'formcalc' | 'javascript';

/** When a script should execute in the XFA lifecycle */
export type ScriptRunAt = 'deprecated' | 'docOpen' | 'docReady' | 'pageOpen' | 'pageClose';

/** XFA event names that can trigger scripts */
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

/** Parsed script attached to an XFA element */
export interface ScriptSpec {
  /** The script source code */
  content: string;
  /** Language of the script */
  contentType: ScriptLanguage;
  /** When to execute the script */
  runAt?: ScriptRunAt;
  /** The event name that triggers this script */
  eventName?: XfaEventName;
}

/** Enriched event spec with full script information (replaces the old minimal EventSpec usage) */
export interface ScriptedEventSpec {
  /** Event name (initialize, calculate, validate, click, etc.) */
  name?: XfaEventName;
  /** Activity trigger */
  activity?: string;
  /** Reference */
  ref?: string;
  /** One or more scripts for this event, possibly in different languages */
  scripts: ScriptSpec[];
}

/** Calculate spec with the actual expression body */
export interface CalculateSpec {
  /** The override mode: 'auto' | 'error' | 'ignore' */
  override?: string;
  /** The calculation expression/script */
  script?: ScriptSpec;
}

// ─── XFA Object Model Types ───────────────────────────────────────────────

/** Represents an XFA node ($/xfa object) accessible from scripts */
export interface XfaNode {
  /** Node name */
  name: string;
  /** Node type (field, subform, draw, etc.) */
  type: string;
  /** Current value */
  value: unknown;
  /** Raw value (string representation) */
  rawValue: string | null;
  /** Presence: visible, hidden, invisible, inactive */
  presence: string;
  /** Access mode: open, protected, readOnly, nonInteractive */
  access: string;
  /** Whether the node is mandatory */
  mandatory: string;
  /** Relevant property */
  relevant: string;
  /** The bound data node */
  boundNode: unknown;
  /** Child nodes */
  children: XfaNode[];
  /** Parent node */
  parent: XfaNode | null;
  /** Position */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Whether this node is repeating */
  repeating?: boolean;
  /** Index in a repeating context (1-based in XFA) */
  index?: number;
}

/** XFA event object passed to event handlers */
export interface XfaEventObject {
  /** The XFA node that triggered the event */
  target: XfaNode | null;
  /** The event name */
  name: string;
  /** Whether the event is a full trigger */
  fullTrigger: boolean;
  /** The data type of the event */
  type: string;
  /** Whether the event has been changed */
  changed: boolean;
  /** Whether the event was propagated */
  propagated: boolean;
  /** Whether the event was rejected */
  rejected: boolean;
  /** The submit trigger type */
  submitTrigger?: string;
}

/** XFA host object for scripts (xfa.host) */
export interface XfaHost {
  /** Current locale name */
  readonly name: string;
  /** Show an alert dialog */
  alert(message: string): void;
  /** Format a value using a picture pattern */
  formatValue(value: unknown, picture: string): string;
  /** Get a value from a formatted string */
  unformatValue(value: string, picture: string): unknown;
  /** Current date/time */
  readonly now: Date;
  /** Path separator */
  readonly pathSeparator: string;
  /** Current page number (1-based) */
  readonly currentPage: number;
  /** App version */
  readonly version: string;
}

/** XFA model object accessible as 'xfa' in scripts */
export interface XfaModel {
  /** Resolve a node by SOM expression */
  resolveNode(expression: string, context?: XfaNode): XfaNode | null;
  /** Get the form root node */
  form: XfaNode;
}

// ─── Script Execution Context ─────────────────────────────────────────────

/** The result of executing a script */
export interface ScriptExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Return value (for calculate scripts) */
  returnValue?: unknown;
  /** Error message if failed */
  error?: string;
  /** Whether the script modified any field values */
  modifiedFields: string[];
}

/** Configuration for the script execution engine */
export interface ScriptEngineConfig {
  /** Maximum execution time per script in milliseconds */
  maxExecutionTime?: number;
  /** Maximum recursion depth */
  maxRecursionDepth?: number;
  /** Whether to enable console.log output from scripts */
  enableConsole?: boolean;
  /** Whether to throw on script errors or silently continue */
  strictMode?: boolean;
}

/** A node in the layout tree that can be scripted (field, subform, draw, exclGroup) */
export interface ScriptableNode {
  type: string;
  name?: string;
  bindRef?: string;
  bindMatch?: string;
  presence?: string;
  access?: string;
  resolvedValue?: unknown;
  position?: { x?: number; y?: number; w?: number; h?: number };
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
  children?: ScriptableNode[];
}
