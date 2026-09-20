// ────────────────────────────────────────────────────────────────────────────
// Script Event Dispatcher — 1:1 Adobe LiveCycle Designer script lifecycle
//
// Reference: xfascripthandler.dll + xfa.dll (script orchestration)
//
// Adobe LiveCycle Designer's script execution order during PDF generation:
//   Phase 1: form:ready → fires once on the form root
//   Phase 2: initialize → fires on each element, LEAF-FIRST depth-first
//   Phase 3: calculate → fires on each field with <calculate>, with
//            CASCADING (re-runs dependents when values change, max 25 iterations)
//   Phase 4: validate → fires on each field with validate event
//   Phase 5: docReady → fires once after everything is initialized
//   Phase 6: layout:ready → fires after layout computation
//
// Script runAt values:
//   - docOpen: executes when the form is first opened (before layout)
//   - docReady: executes after the form is fully loaded
//   - pageOpen/pageClose: for page-level scripts (not applicable to static PDF)
//   - deprecated: ignored
// ────────────────────────────────────────────────────────────────────────────

import { LayoutModel, LayoutNode, Result } from '../../types';
import { success, failure } from '../../lib/result-type';
import { ERROR_CODES } from '../../errors/error-codes';
import {
  ScriptSpec,
  XfaNode,
  ScriptEngineConfig,
} from './script-types';
import { FormCalcParser, FormCalcEvaluator, FormCalcError, FieldAccessor } from './formcalc';
import { JavaScriptEngine, JavaScriptEngineError, JsExecutionResult } from './js-engine';
import {
  createFieldAccessor,
  buildNodeMap,
  collectScripts,
  scriptableToXfaNode,
  ScriptEntry,
} from './xfa-object-model';
import { PropertyChangeTracker, ApplyResult } from './property-change-tracker';
import {
  buildDependencyGraph,
  getFieldsToRecalculate,
  ADOBE_MAX_CASCADE_DEPTH,
  DependencyGraph,
} from './script-dependency-tracker';
import type { ScriptableNode } from './script-types';

// ─── Adobe's exact cascade limit ────────────────────────────────────────

const MAX_CASCADE_ITERATIONS = ADOBE_MAX_CASCADE_DEPTH; // 25, matching Adobe

// ─── Public API ─────────────────────────────────────────────────────────

export interface DispatchResult {
  /** The modified layout model (with script-computed values) */
  layout: LayoutModel;
  /** Number of scripts executed */
  scriptsExecuted: number;
  /** Number of script errors (non-fatal) */
  scriptErrors: number;
  /** Error messages from failed scripts */
  errorMessages: string[];
  /** Property changes applied by scripts */
  propertyChanges: number;
  /** Whether layout needs recalculation due to script changes */
  layoutDirty: boolean;
}

export interface ScriptDispatchConfig extends ScriptEngineConfig {
  /** Whether to skip script execution entirely */
  skipScripts?: boolean;
  /** Events to skip (e.g., ['validate'] to skip validation scripts) */
  skipEvents?: string[];
}

/**
 * Main entry point: execute all scripts in the layout tree during PDF generation.
 *
 * Call this AFTER data binding (resolveBindings) but BEFORE layout calculation.
 * Scripts can modify field values, visibility, and other properties.
 *
 * Implements Adobe LiveCycle Designer's exact 6-phase script lifecycle.
 */
export function dispatchScripts(
  layout: LayoutModel,
  data: Record<string, unknown>,
  config: ScriptDispatchConfig = {}
): Result<DispatchResult> {
  if (config.skipScripts) {
    return success({
      layout,
      scriptsExecuted: 0,
      scriptErrors: 0,
      errorMessages: [],
      propertyChanges: 0,
      layoutDirty: false,
    });
  }

  try {
    const result = executeScriptLifecycle(layout, data, config);
    return success(result);
  } catch (e) {
    return failure(
      ERROR_CODES.SCRIPT_EXECUTION_FAILED?.code ?? 'SCR_6001',
      `${ERROR_CODES.SCRIPT_EXECUTION_FAILED?.message ?? 'Script execution failed'}: ${e}`
    );
  }
}

// ─── Core 6-Phase Lifecycle ─────────────────────────────────────────────

function executeScriptLifecycle(
  layout: LayoutModel,
  data: Record<string, unknown>,
  config: ScriptDispatchConfig
): DispatchResult {
  // Build the flat node map and field accessor
  const allNodes = buildNodeMapFromLayout(layout);
  const fieldAccessor = createFieldAccessor(allNodes, data);
  const changeTracker = new PropertyChangeTracker();

  // Snapshot all nodes before scripts run
  for (const [path, node] of allNodes) {
    changeTracker.snapshot(path, node);
  }

  // Create script engines
  const jsEngine = new JavaScriptEngine(fieldAccessor, config);

  // Collect all scripts from the layout tree
  const scripts = collectScriptsFromLayout(layout);
  const stats = {
    executed: 0,
    errors: 0,
    errorMessages: [] as string[],
  };

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 1: form:ready scripts
  // Fires once on the form root — before any per-field initialization.
  // Reference: xfascripthandler.dll fires "form:ready" event on the root subform.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('ready') && !config.skipEvents?.includes('form:ready')) {
    const formReadyScripts = scripts.filter(
      (s) => s.eventName === 'ready' || s.eventName === 'form:ready'
    );
    for (const entry of formReadyScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: initialize scripts — LEAF-FIRST depth-first order
  // Adobe fires initialize on leaf nodes (fields, draws) first,
  // then on their containing subforms, bottom-up.
  // Reference: xfascripthandler.dll + xfatemplate.dll traversal order.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('initialize')) {
    const initScripts = scripts.filter(
      (s) => s.eventName === 'initialize' || s.runAt === 'docOpen'
    );

    // Sort leaf-first: fields/draws before subforms, deeper nodes before shallower
    const sortedInit = sortLeafFirst(initScripts);

    for (const entry of sortedInit) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: calculate scripts — WITH DEPENDENCY-AWARE CASCADING
  // Build dependency graph, execute in topological order, then cascade
  // when values change. Adobe caps at 25 iterations.
  // Reference: xfascripthandler.dll calculate cascade logic.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('calculate')) {
    const calcScripts = scripts.filter((s) => s.eventName === 'calculate');
    executeCalculatePhase(calcScripts, fieldAccessor, jsEngine, allNodes, layout, data, stats, config);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: validate scripts
  // Fires on each field with a validate event, depth-first.
  // In static PDF generation, validation failures are logged but don't
  // prevent rendering (unlike interactive mode where they show errors).
  // Reference: xfascripthandler.dll validate phase.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('validate')) {
    const validateScripts = scripts.filter((s) => s.eventName === 'validate');
    for (const entry of validateScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5: docReady scripts
  // Fires once after everything is initialized — for final adjustments.
  // Reference: xfascripthandler.dll docReady event.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('docReady')) {
    const docReadyScripts = scripts.filter(
      (s) => s.eventName === 'docReady' || s.runAt === 'docReady'
    );
    for (const entry of docReadyScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 6: layout:ready scripts (simulated)
  // In Adobe, these fire after layout computation. Since we run scripts
  // before layout, we execute them here as a best approximation.
  // Reference: xfalayout.dll layout:ready event.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('layout:ready')) {
    const layoutReadyScripts = scripts.filter(
      (s) => s.eventName === 'layout:ready'
    );
    for (const entry of layoutReadyScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST-EXECUTION: Detect and apply all property changes
  // ═══════════════════════════════════════════════════════════════════════
  for (const [path, node] of allNodes) {
    changeTracker.detectChanges(path, node);
  }

  const applyResult = changeTracker.applyChangesToLayout(layout);

  // Also apply via the legacy path for backwards compatibility
  applyModifiedValues(allNodes, layout);

  return {
    layout,
    scriptsExecuted: stats.executed,
    scriptErrors: stats.errors,
    errorMessages: stats.errorMessages,
    propertyChanges: applyResult.valuesChanged + applyResult.presenceChanged + applyResult.accessChanged,
    layoutDirty: applyResult.layoutDirty,
  };
}

// ─── Phase 3: Calculate with Dependency-Aware Cascading ─────────────────

function executeCalculatePhase(
  calcScripts: ScriptEntry[],
  fieldAccessor: FieldAccessor,
  jsEngine: JavaScriptEngine,
  allNodes: Map<string, ScriptableNode>,
  layout: LayoutModel,
  data: Record<string, unknown>,
  stats: { executed: number; errors: number; errorMessages: string[] },
  config: ScriptDispatchConfig
): void {
  if (calcScripts.length === 0) return;

  // Build dependency graph for optimal execution order
  const graph = buildDependencyGraph(calcScripts, allNodes);

  if (graph.hasCycles) {
    stats.errorMessages.push(
      `[calculate] Dependency cycle detected in fields: ${graph.cyclePaths.join(', ')}`
    );
  }

  // Create lookup from path to script entry
  const scriptByPath = new Map<string, ScriptEntry>();
  for (const entry of calcScripts) {
    scriptByPath.set(entry.elementPath, entry);
  }

  // Execute in topological order (dependencies first)
  const orderedPaths = graph.executionOrder.length > 0
    ? graph.executionOrder
    : calcScripts.map((s) => s.elementPath);

  // Initial pass: execute all calculate scripts in order
  for (const path of orderedPaths) {
    const entry = scriptByPath.get(path);
    if (!entry) continue;
    executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
  }

  // Cascading passes: re-execute scripts whose dependencies changed
  for (let cascade = 1; cascade < MAX_CASCADE_ITERATIONS; cascade++) {
    let anyModified = false;

    for (const path of orderedPaths) {
      const entry = scriptByPath.get(path);
      if (!entry) continue;

      const before = snapshotValue(entry.element);
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
      const after = snapshotValue(entry.element);

      if (before !== after) {
        anyModified = true;
      }
    }

    if (!anyModified) break;

    if (cascade === MAX_CASCADE_ITERATIONS - 1) {
      stats.errorMessages.push(
        `[calculate] Maximum cascade depth (${MAX_CASCADE_ITERATIONS}) reached — matching Adobe LiveCycle limit`
      );
    }
  }
}

function snapshotValue(node: ScriptableNode): string {
  return JSON.stringify(node.resolvedValue ?? null);
}

// ─── Script Execution ───────────────────────────────────────────────────

function executeSingleScript(
  entry: ScriptEntry,
  fieldAccessor: FieldAccessor,
  jsEngine: JavaScriptEngine,
  allNodes: Map<string, ScriptableNode>,
  layout: LayoutModel,
  data: Record<string, unknown>,
  stats: { executed: number; errors: number; errorMessages: string[] }
): void {
  try {
    const xfaNode = scriptableToXfaNode(entry.element, entry.elementPath);

    if (entry.language === 'javascript') {
      const result = jsEngine.execute(entry.scriptContent, xfaNode, entry.eventName, data);

      // For calculate events, the return value becomes the field's value
      if (entry.eventName === 'calculate' && result.value !== undefined) {
        entry.element.resolvedValue = result.value;
        // Also update via field accessor so other scripts see the new value
        fieldAccessor.setField(entry.elementPath, '$', result.value);
      }

      // Apply any modifications made via the JS engine
      for (const modifiedField of result.modifiedFields) {
        // The JS engine tracks modifications by field name, not path.
        // Try to find the full path and update the node.
        for (const [path, node] of allNodes) {
          if (path.endsWith(`.${modifiedField}`) || path === modifiedField) {
            // Node already modified in-place by the JS engine's proxy
            break;
          }
        }
      }
    } else {
      // FormCalc
      const parser = new FormCalcParser(entry.scriptContent);
      const ast = parser.parse();
      const evaluator = new FormCalcEvaluator(fieldAccessor);
      const result = evaluator.evaluate(ast);

      // For calculate events, apply the last expression value
      if (entry.eventName === 'calculate' && result.value !== undefined) {
        entry.element.resolvedValue = result.value;
        fieldAccessor.setField(entry.elementPath, '$', result.value);
      }
    }
    stats.executed++;
  } catch (e) {
    stats.errors++;
    const msg = e instanceof Error ? e.message : String(e);
    stats.errorMessages.push(`[${entry.eventName}] ${entry.elementPath}: ${msg}`);
    // Non-fatal: continue with other scripts (matching Adobe behavior)
  }
}

// ─── Leaf-First Sort ────────────────────────────────────────────────────

/**
 * Sort scripts so leaf nodes (fields, draws) execute before containers (subforms).
 * Within the same depth, maintain document order.
 * This matches Adobe's initialize event firing order.
 */
function sortLeafFirst(scripts: ScriptEntry[]): ScriptEntry[] {
  return [...scripts].sort((a, b) => {
    const aDepth = a.elementPath.split('.').length;
    const bDepth = b.elementPath.split('.').length;
    const aIsLeaf = a.element.type === 'field' || a.element.type === 'draw';
    const bIsLeaf = b.element.type === 'field' || b.element.type === 'draw';

    // Leaves before containers
    if (aIsLeaf && !bIsLeaf) return -1;
    if (!aIsLeaf && bIsLeaf) return 1;

    // Deeper nodes before shallower (leaf-first = bottom-up)
    if (aDepth !== bDepth) return bDepth - aDepth;

    // Same depth and type: maintain original order
    return 0;
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

function buildNodeMapFromLayout(layout: LayoutModel): Map<string, ScriptableNode> {
  const map = new Map<string, ScriptableNode>();

  function walkNodes(nodes: LayoutNode[], parentPath: string) {
    for (const node of nodes) {
      const name = node.name ?? '<unnamed>';
      const path = parentPath ? `${parentPath}.${name}` : name;

      const scriptable: ScriptableNode = {
        type: node.type,
        name: node.name,
        bindRef: 'bindRef' in node ? (node as { bindRef?: string }).bindRef : undefined,
        bindMatch: 'bindMatch' in node ? (node as { bindMatch?: string }).bindMatch : undefined,
        presence: node.presence,
        access: 'access' in node ? (node as { access?: string }).access : undefined,
        resolvedValue: 'resolvedValue' in node ? (node as { resolvedValue?: unknown }).resolvedValue : undefined,
        position: 'position' in node ? (node as { position?: { x?: number; y?: number; w?: number; h?: number } }).position : undefined,
        events: 'events' in node ? (node as { events?: ScriptableNode['events'] }).events : undefined,
        calculate: 'calculate' in node ? (node as { calculate?: ScriptableNode['calculate'] }).calculate : undefined,
      };

      map.set(path, scriptable);

      if (node.type === 'subform') {
        walkNodes((node as { children: LayoutNode[] }).children, path);
      } else if (node.type === 'exclGroup') {
        walkNodes((node as { children: LayoutNode[] }).children, path);
      }
    }
  }

  walkNodes(layout.children, '');
  for (const page of layout.pages) {
    walkNodes(page.masterPageChildren, '');
  }

  return map;
}

function collectScriptsFromLayout(layout: LayoutModel): ScriptEntry[] {
  const entries: ScriptEntry[] = [];

  function walkNodes(nodes: LayoutNode[], parentPath: string) {
    for (const node of nodes) {
      const name = node.name ?? '<unnamed>';
      const path = parentPath ? `${parentPath}.${name}` : name;

      const scriptable: ScriptableNode = {
        type: node.type,
        name: node.name,
        presence: node.presence,
        events: 'events' in node ? (node as { events?: ScriptableNode['events'] }).events : undefined,
        calculate: 'calculate' in node ? (node as { calculate?: ScriptableNode['calculate'] }).calculate : undefined,
        resolvedValue: 'resolvedValue' in node ? (node as { resolvedValue?: unknown }).resolvedValue : undefined,
        children: [],
      };

      entries.push(...collectScriptsFromNode(scriptable, path));

      if (node.type === 'subform') {
        walkNodes((node as { children: LayoutNode[] }).children, path);
      } else if (node.type === 'exclGroup') {
        walkNodes((node as { children: LayoutNode[] }).children, path);
      }
    }
  }

  walkNodes(layout.children, '');
  for (const page of layout.pages) {
    walkNodes(page.masterPageChildren, '');
  }

  return entries;
}

function collectScriptsFromNode(node: ScriptableNode, path: string): ScriptEntry[] {
  const entries: ScriptEntry[] = [];

  if (node.events) {
    for (const event of node.events) {
      if (event.script) {
        entries.push({
          elementPath: path,
          element: node,
          eventName: normalizeEventName(event.name, event.activity),
          scriptContent: event.script,
          language: detectScriptLanguage(event.contentType),
          runAt: event.runAt,
        });
      }
    }
  }

  if (node.calculate?.script) {
    entries.push({
      elementPath: path,
      element: node,
      eventName: 'calculate',
      scriptContent: node.calculate.script.content,
      language: node.calculate.script.contentType,
      runAt: node.calculate.script.runAt,
    });
  }

  return entries;
}

/**
 * Normalize event names from XDP activity attributes.
 * Reference: xfascripthandler.dll event name mapping.
 *
 * Adobe maps <event activity="..."> to canonical event names:
 *   activity="initialize" → "initialize"
 *   activity="click" → "click"
 *   name="event__calculate" → "calculate" (SAP convention)
 *   No activity, no name → infer from context
 */
function normalizeEventName(name?: string, activity?: string): string {
  // Activity attribute takes priority (Adobe's primary mapping)
  if (activity) {
    const normalized = activity.toLowerCase();
    // Map common activity values to canonical event names
    switch (normalized) {
      case 'initialize': return 'initialize';
      case 'calculate': return 'calculate';
      case 'validate': return 'validate';
      case 'click': return 'click';
      case 'change': return 'change';
      case 'enter': return 'enter';
      case 'exit': return 'exit';
      case 'mouseenter': return 'mouseEnter';
      case 'mouseexit': return 'mouseExit';
      case 'ready': return 'ready';
      case 'docready': return 'docReady';
      case 'docclose': return 'docClose';
      case 'presave': return 'preSave';
      case 'postsave': return 'postSave';
      case 'preprint': return 'prePrint';
      case 'postprint': return 'postPrint';
      case 'presubmit': return 'preSubmit';
      case 'postsubmit': return 'postSubmit';
      case 'preexecute': return 'preExecute';
      case 'postexecute': return 'postExecute';
      case 'presign': return 'preSign';
      case 'postsign': return 'postSign';
      case 'full': return 'full';
      case 'indexchange': return 'indexChange';
      default: return normalized;
    }
  }

  // Fall back to name attribute
  if (name) {
    // Handle SAP convention: "event__calculate" → "calculate"
    const sap = name.replace(/^event__/, '');
    return sap.toLowerCase();
  }

  return 'unknown';
}

function detectScriptLanguage(contentType?: string): 'formcalc' | 'javascript' {
  if (!contentType) return 'formcalc'; // FormCalc is the XFA default
  const lower = contentType.toLowerCase();
  if (lower.includes('javascript') || lower.includes('ecmascript')) return 'javascript';
  return 'formcalc';
}

function applyModifiedValues(
  allNodes: Map<string, ScriptableNode>,
  layout: LayoutModel
): void {
  // Walk the layout tree and update resolvedValue/presence/access from the node map
  function walkNodes(nodes: LayoutNode[]) {
    for (const node of nodes) {
      const name = node.name;
      if (name) {
        // Find matching scriptable node
        for (const [path, scriptable] of allNodes) {
          if (path.endsWith(`.${name}`) || path === name) {
            if ('resolvedValue' in node && scriptable.resolvedValue !== undefined) {
              (node as { resolvedValue?: unknown }).resolvedValue = scriptable.resolvedValue;
            }
            if (scriptable.presence !== undefined) {
              (node as { presence?: string }).presence = scriptable.presence;
            }
            if (scriptable.access !== undefined && 'access' in node) {
              (node as { access?: string }).access = scriptable.access;
            }
            break;
          }
        }
      }
      if (node.type === 'subform') {
        walkNodes((node as { children: LayoutNode[] }).children);
      } else if (node.type === 'exclGroup') {
        walkNodes((node as { children: LayoutNode[] }).children);
      }
    }
  }

  walkNodes(layout.children);
  for (const page of layout.pages) {
    walkNodes(page.masterPageChildren);
  }
}
