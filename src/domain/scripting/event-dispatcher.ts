// ────────────────────────────────────────────────────────────────────────────
// Script Event Dispatcher — Adobe LiveCycle Designer script lifecycle
//
// Adobe LiveCycle Designer's execution order for a static render:
//
//   1. ready ref=$form — XFAModelImpl::ready fires 'ready' on the model alias
//      node ($form) once when template+data finish loading, before layout.
//      evidence: xfa_disasm.c:49230-49275; default event node created as
//      ("OnFormReady", "ready", "$form") — xfatemplate_disasm.c:32238-32244.
//   2. layoutRecord → XFAFormLayout::ready() (during layout, first pass only):
//      a. setReady($layout)                                  xfalayout_disasm.c:56775
//      b. initializeNewContentNodes — per new node:
//           'initialize' (executeReason 4)                  xfaform_disasm.c:26396
//           then 'indexChange' (executeReason 0x10)         xfaform_disasm.c:26402
//      c. recalculate — calculate queue → validate queue → 'overlay' event on
//         the form model; reentrancy-guarded; NO iteration cap.
//         evidence: xfaform_disasm.c:30280-30447 (guard at :30300, queues at
//         :30360-30420, overlay at :30429)
//      d. dispatch 'ready' with ref=$layout                 xfalayout_disasm.c:56795
//      e. if initialize/recalculate/ready changed anything → relayout
//                                                           xfalayout_disasm.c:56820
//   3. startRecord → 'docReady' (AFTER layout, BEFORE rendering)
//      evidence: xfapresentationagent_disasm.c:20726 (getString(0x4b000c));
//      record order merge→layout→start→render
//      xfapresentationagent_disasm.c:13252-13261
//   4. renderRecord
//   5. endRecord → 'docClose' (after rendering — no visual effect, not run here)
//      evidence: xfapresentationagent_disasm.c:9614 (getString(0x4b000d))
//
// Our pipeline computes layout AFTER the pre-layout phases (1, 2a-2d), so the
// step-2e relayout loop is unnecessary: the first layout already sees script
// results. Step 3 (docReady) runs post-layout via dispatchPostLayoutScripts().
//
// Script runAt values:
//   - docOpen: executes when the form is first opened (before layout)
//   - docReady: executes after layout, before rendering
//   - pageOpen/pageClose: for page-level scripts (not applicable to static PDF)
//   - deprecated: ignored
// ────────────────────────────────────────────────────────────────────────────

import { LayoutModel, LayoutNode, PaginatedLayout, Result } from '../../types';
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
  DependencyGraph,
} from './script-dependency-tracker';
import type { ScriptableNode } from './script-types';

// ─── Cascade safety limit ──────────────────────────────────────────────

// Adobe's recalculate() has NO iteration cap — its outer do/while(true) drains
// the calculate and validate queues until both are empty
// (evidence: xfaform_disasm.c:30360-30447). The limit below exists only to
// keep pathological dependency cycles from hanging the renderer; it is not an
// Adobe behavior.
const CASCADE_SAFETY_LIMIT = 100;

// ─── Public API ─────────────────────────────────────────────────────────

export interface DispatchResult<TLayout = LayoutModel> {
  /** The modified layout model (with script-computed values) */
  layout: TLayout;
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
  // PHASE 1: form ready — activity="ready" with ref="$form" (or no ref).
  // Fires once on the form model before any per-field initialization.
  // evidence: XFAModelImpl::ready dispatches 'ready' on the model alias node
  // xfa_disasm.c:49230-49275; default event ("OnFormReady","ready","$form")
  // xfatemplate_disasm.c:32238-32244. Events with ref="$layout" are handled
  // in PHASE 6 (layout ready), not here.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('ready') && !config.skipEvents?.includes('form:ready')) {
    const formReadyScripts = scripts.filter(
      (s) =>
        (s.eventName === 'ready' || s.eventName === 'form:ready') &&
        !isLayoutReadyEvent(s)
    );
    for (const entry of formReadyScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2: initialize + indexChange — LEAF-FIRST depth-first order.
  // Adobe's initializeNewContentNodes fires 'initialize' (executeReason 4)
  // and immediately after, 'indexChange' (executeReason 0x10) for the SAME
  // node, once per new content node, leaf-first.
  // evidence: xfaform_disasm.c:26396-26402 (FUN_17521320, called by
  // XFAFormModel::initializeNewContentNodes, xfaform_disasm.c:15285-15291)
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('initialize')) {
    executeInitializePhase(scripts, fieldAccessor, jsEngine, allNodes, layout, data, stats, config);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 3: calculate scripts — WITH DEPENDENCY-AWARE CASCADING
  // evidence: recalculate drains the calculate queue (topological order is an
  // optimization over Adobe's queue re-seeding; both converge to the fixed
  // point) — xfaform_disasm.c:30360-30447. No Adobe iteration cap exists;
  // CASCADE_SAFETY_LIMIT only guards against cycles.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('calculate')) {
    const calcScripts = scripts.filter((s) => s.eventName === 'calculate');
    executeCalculatePhase(calcScripts, fieldAccessor, jsEngine, allNodes, layout, data, stats, config);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 4: validate scripts — validate queue runs AFTER the calculate
  // queue drains (Adobe recalculate order: calculate → validate).
  // evidence: xfaform_disasm.c:30396-30420 (validate dispatch at event ID
  // stored at formModel+0x11c after calculate queue at +0x118/+0x150).
  // In static PDF generation validation failures are logged but don't
  // prevent rendering.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('validate')) {
    const validateScripts = scripts.filter((s) => s.eventName === 'validate');
    for (const entry of validateScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 5: overlay — recalculate dispatches 'overlay' on the form model
  // right after the calculate+validate queues drain, before ready($layout).
  // evidence: xfaform_disasm.c:30429-30436 (jfLiteral "overlay" →
  // XFAEventManager::eventOccurred inside FUN_17526110 / recalculate)
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('overlay')) {
    const overlayScripts = scripts.filter((s) => s.eventName === 'overlay');
    for (const entry of overlayScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 6: layout ready — activity="ready" with ref="$layout" (legacy
  // name "layout:ready" also accepted). XFAFormLayout::ready dispatches this
  // after initialize+recalculate complete; the renderer also scans template
  // events for activity=ready + ref="$layout".
  // evidence: xfalayout_disasm.c:56795 (jfLiteral "ready" → eventOccurred on
  // the $layout pseudo-model); renderer_disasm.c:35574-35578.
  // ═══════════════════════════════════════════════════════════════════════
  if (!config.skipEvents?.includes('layout:ready') && !config.skipEvents?.includes('layoutReady')) {
    const layoutReadyScripts = scripts.filter((s) => isLayoutReadyEvent(s));
    for (const entry of layoutReadyScripts) {
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POST-EXECUTION: Detect and apply all property changes
  // ═══════════════════════════════════════════════════════════════════════
  const applyResult = applyTrackedChanges(allNodes, changeTracker, layout);

  return {
    layout,
    scriptsExecuted: stats.executed,
    scriptErrors: stats.errors,
    errorMessages: stats.errorMessages,
    propertyChanges: applyResult.valuesChanged + applyResult.presenceChanged + applyResult.accessChanged,
    layoutDirty: applyResult.layoutDirty,
  };
}

// ─── Post-Layout Scripts (docReady) ─────────────────────────────────────

/**
 * Execute scripts that Adobe fires AFTER layout and BEFORE rendering:
 * 'docReady' (runAt="docReady" accepted too).
 *
 * evidence: XFAPresentationAgent::startRecord dispatches
 * getString(0x4b000c)="docReady" on the form model
 * (xfapresentationagent_disasm.c:20726-20732), and the record pipeline runs
 * mergeRecord → layoutRecord → startRecord → renderRecord
 * (xfapresentationagent_disasm.c:13252-13261).
 *
 * 'docClose' is intentionally NOT executed: endRecord fires it after
 * renderRecord (xfapresentationagent_disasm.c:9614-9620), so its mutations
 * cannot affect a static PDF's appearance.
 *
 * Runs against the PAGINATED tree — the exact nodes the renderer walks.
 * Call once after layout completes and before rendering.
 *
 * Known deviation: Adobe re-runs layout when docReady changes layout-affecting
 * properties (vtable+0xa0, xfapresentationagent_disasm.c:20735-20737). We rely
 * on the renderer honoring presence at draw time (pdf-renderer.ts:88) instead;
 * a presence change to hidden/inactive may therefore leave its former layout
 * space occupied.
 */
export function dispatchPostLayoutScripts(
  layout: PaginatedLayout,
  data: Record<string, unknown>,
  config: ScriptDispatchConfig = {}
): Result<DispatchResult<PaginatedLayout>> {
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
    // Structural view of the paginated tree so the LayoutModel-based walkers
    // (node map, script collection, change application) can be reused. The
    // view references the SAME node objects the renderer will walk.
    const view = paginatedToLayoutView(layout);
    const allNodes = buildNodeMapFromLayout(view);
    const fieldAccessor = createFieldAccessor(allNodes, data);
    const changeTracker = new PropertyChangeTracker();
    for (const [path, node] of allNodes) {
      changeTracker.snapshot(path, node);
    }
    const jsEngine = new JavaScriptEngine(fieldAccessor, config);
    const stats = { executed: 0, errors: 0, errorMessages: [] as string[] };

    const scripts = collectScriptsFromLayout(view);
    if (!config.skipEvents?.includes('docReady')) {
      const docReadyScripts = scripts.filter(
        (s) => s.eventName === 'docReady' || s.runAt === 'docReady'
      );
      for (const entry of docReadyScripts) {
        executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, view, data, stats);
      }
    }

    const applyResult = applyTrackedChanges(allNodes, changeTracker, view);

    return success({
      layout,
      scriptsExecuted: stats.executed,
      scriptErrors: stats.errors,
      errorMessages: stats.errorMessages,
      propertyChanges:
        applyResult.valuesChanged + applyResult.presenceChanged + applyResult.accessChanged,
      layoutDirty: applyResult.layoutDirty,
    });
  } catch (e) {
    return failure(
      ERROR_CODES.SCRIPT_EXECUTION_FAILED?.code ?? 'SCR_6001',
      `${ERROR_CODES.SCRIPT_EXECUTION_FAILED?.message ?? 'Script execution failed'}: ${e}`
    );
  }
}

/**
 * Build a LayoutModel-shaped view over a paginated tree: top-level children
 * are all page contents (so node paths line up between script collection and
 * change application), plus the per-page masterPageChildren.
 */
function paginatedToLayoutView(paginated: PaginatedLayout): LayoutModel {
  return {
    rootSubformName: paginated.rootSubformName ?? '',
    rootEvents: paginated.rootEvents,
    children: paginated.pages.flatMap((page) => page.children),
    pages: paginated.pages.map((page) => ({
      name: `page${page.pageIndex}`,
      medium: page.medium,
      contentArea: page.contentArea,
      masterPageChildren: page.masterPageChildren,
    })),
  };
}

// ─── Phase 2: initialize + indexChange (leaf-first) ─────────────────────

/**
 * Whether a script entry is the layout-ready event (ready ref=$layout).
 * evidence: renderer matches activity=getString(0x4b000b)="ready" and
 * ref="$layout" — renderer_disasm.c:35574-35578; XFAFormLayout::ready
 * dispatches 'ready' on the $layout pseudo-model — xfalayout_disasm.c:56795.
 * The legacy synthetic name "layout:ready" is also honored.
 */
function isLayoutReadyEvent(entry: ScriptEntry): boolean {
  return (
    entry.eventName === 'layout:ready' ||
    (entry.eventName === 'ready' && entry.ref === '$layout')
  );
}

/**
 * Per-node pairing of initialize and indexChange, executed leaf-first.
 * evidence: initializeNewContentNodes dispatches initialize (reason 4) and
 * then immediately indexChange (reason 0x10) for the same node, once per new
 * content node — xfaform_disasm.c:26396-26402 (FUN_17521320).
 */
function executeInitializePhase(
  scripts: ScriptEntry[],
  fieldAccessor: FieldAccessor,
  jsEngine: JavaScriptEngine,
  allNodes: Map<string, ScriptableNode>,
  layout: LayoutModel,
  data: Record<string, unknown>,
  stats: { executed: number; errors: number; errorMessages: string[] },
  config: ScriptDispatchConfig
): void {
  const relevant = scripts.filter(
    (s) =>
      s.eventName === 'initialize' ||
      s.eventName === 'indexChange' ||
      s.runAt === 'docOpen'
  );
  if (relevant.length === 0) return;

  // Group per element so initialize and indexChange fire as a pair.
  const grouped = new Map<string, { init: ScriptEntry[]; index: ScriptEntry[] }>();
  for (const entry of relevant) {
    const group = grouped.get(entry.elementPath) ?? { init: [], index: [] };
    if (entry.eventName === 'indexChange') {
      group.index.push(entry);
    } else {
      group.init.push(entry);
    }
    grouped.set(entry.elementPath, group);
  }

  const perPath = [...grouped.entries()].map(([elementPath, group]) => ({
    elementPath,
    element: group.init[0]?.element ?? group.index[0].element,
    init: group.init,
    index: group.index,
  }));

  // Leaf-first: fields/draws before containers, deeper before shallower.
  for (const item of sortLeafFirst(perPath)) {
    if (!config.skipEvents?.includes('initialize')) {
      for (const entry of item.init) {
        executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
      }
    }
    if (!config.skipEvents?.includes('indexChange')) {
      for (const entry of item.index) {
        executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
      }
    }
  }
}

// ─── Shared post-phase change application ───────────────────────────────

/**
 * Detect snapshot diffs, apply them to the layout tree, and mirror values via
 * the legacy path. Shared by the pre-layout lifecycle and docReady.
 */
function applyTrackedChanges(
  allNodes: Map<string, ScriptableNode>,
  changeTracker: PropertyChangeTracker,
  layout: LayoutModel
): ApplyResult {
  for (const [path, node] of allNodes) {
    changeTracker.detectChanges(path, node);
  }
  const applyResult = changeTracker.applyChangesToLayout(layout);
  // Also apply via the legacy path for backwards compatibility
  applyModifiedValues(allNodes, layout);
  return applyResult;
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

  // Cascading passes: re-execute scripts whose dependencies changed.
  // Adobe has no iteration cap (xfaform_disasm.c:30360 do/while(true) drains
  // queues until empty); CASCADE_SAFETY_LIMIT only guards against cycles.
  for (let cascade = 1; cascade <= CASCADE_SAFETY_LIMIT; cascade++) {
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

    if (!anyModified) return;

    if (cascade === CASCADE_SAFETY_LIMIT) {
      stats.errorMessages.push(
        `[calculate] Cascade safety limit (${CASCADE_SAFETY_LIMIT}) reached — dependency cycle? ` +
          `Adobe's recalculate has no cap (xfaform_disasm.c:30360); this guard exists only to avoid hangs`
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
function sortLeafFirst<T extends { elementPath: string; element: ScriptableNode }>(
  scripts: T[]
): T[] {
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

  // Root subform entry — the root is collapsed to rootSubformName in the
  // LayoutModel; its scripts live in layout.rootEvents (see parse-xdp.ts).
  if (layout.rootSubformName) {
    map.set(layout.rootSubformName, {
      type: 'subform',
      name: layout.rootSubformName,
      presence: 'visible',
      events: layout.rootEvents,
      children: [],
    });
  }

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
      // Leaf-name fallback: XFA scripts may reference a node by its bare name
      // when unambiguous (e.g. `stage = stage + "A"` for field content.stage).
      // Exact SOM paths always win; first occurrence claims the short name.
      if (scriptable.name && !map.has(scriptable.name)) {
        map.set(scriptable.name, scriptable);
      }

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

  // Root-subform scripts — the root node itself is not in the children tree
  // (LayoutModel keeps only rootSubformName + rootEvents).
  if (layout.rootSubformName && layout.rootEvents?.length) {
    const rootScriptable: ScriptableNode = {
      type: 'subform',
      name: layout.rootSubformName,
      presence: 'visible',
      events: layout.rootEvents,
      children: [],
    };
    entries.push(...collectScriptsFromNode(rootScriptable, layout.rootSubformName));
  }

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
        // evidence: <validate> scripts are attached to fields by the template
        // parser (parse-xdp.ts:217) and must be collected for the validate
        // queue of XFAFormModel::recalculate (xfaform_disasm.c:30396-30420)
        validate: 'validate' in node ? (node as { validate?: ScriptableNode['validate'] }).validate : undefined,
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
          ref: event.ref,
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

  // Collect validate scripts from <validate> element
  const fieldNode = node as unknown as { validate?: { script?: { content: string; contentType: string; runAt?: string } } };
  if (fieldNode.validate?.script?.content) {
    entries.push({
      elementPath: path,
      element: node,
      eventName: 'validate',
      scriptContent: fieldNode.validate.script.content,
      language: detectScriptLanguage(fieldNode.validate.script.contentType),
      runAt: fieldNode.validate.script.runAt,
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
      case 'mouseup': return 'mouseUp';
      case 'mousedown': return 'mouseDown';
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
      case 'preopen': return 'preOpen';
      case 'postopen': return 'postOpen';
      case 'preclose': return 'preClose';
      case 'postclose': return 'postClose';
      case 'validationstate': return 'validationState';
      case 'overlay': return 'overlay';
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
