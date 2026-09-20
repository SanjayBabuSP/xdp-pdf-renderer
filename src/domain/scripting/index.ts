// ────────────────────────────────────────────────────────────────────────────
// Scripting Engine — Public API re-export
// ────────────────────────────────────────────────────────────────────────────

export { dispatchScripts } from './event-dispatcher';
export type { DispatchResult, ScriptDispatchConfig } from './event-dispatcher';
export { createFieldAccessor, buildNodeMap, collectScripts, scriptableToXfaNode } from './xfa-object-model';
export type { ScriptEntry } from './xfa-object-model';
export type {
  ScriptSpec,
  ScriptLanguage,
  ScriptRunAt,
  XfaEventName,
  ScriptedEventSpec,
  CalculateSpec,
  XfaNode,
  XfaEventObject,
  XfaHost,
  XfaModel,
  ScriptEngineConfig,
  ScriptableNode,
} from './script-types';

// Re-export FormCalc
export { FormCalcParser, FormCalcEvaluator, FormCalcError, FormCalcParseError } from './formcalc';
export { FormCalcLexer, TokenType } from './formcalc/lexer';
export type { Token } from './formcalc/lexer';
export type { FieldAccessor, FormCalcResult } from './formcalc/evaluator';
export type * from './formcalc/ast';

// Re-export JavaScript Engine
export { JavaScriptEngine, JavaScriptEngineError } from './js-engine';
export type { JsExecutionResult } from './js-engine';

// SOM Expression Resolver
export { SomExpressionResolver, parseSomExpression } from './som-expression-resolver';
export type { SomResolutionResult } from './som-expression-resolver';

// Script Dependency Tracker
export {
  buildDependencyGraph,
  getFieldsToRecalculate,
  extractFieldReferences,
  ADOBE_MAX_CASCADE_DEPTH,
} from './script-dependency-tracker';
export type { FieldDependency, DependencyGraph } from './script-dependency-tracker';

// Property Change Tracker
export { PropertyChangeTracker } from './property-change-tracker';
export type { PropertyChange, ApplyResult } from './property-change-tracker';

// XFA Form Proxy (deep navigation)
export { createXfaFormProxy } from './js-engine/xfa-form-proxy';
