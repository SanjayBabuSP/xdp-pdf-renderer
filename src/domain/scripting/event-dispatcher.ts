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
import type { XfaLayoutInfo } from './js-engine/javascript-engine';
import {
  createFieldAccessor,
  buildNodeMap,
  collectScripts,
  scriptableToXfaNode,
  ScriptEntry,
} from './xfa-object-model';
import { PropertyChangeTracker, ApplyResult } from './property-change-tracker';
import { XfaEventDispatcher } from '../../adobe/xfa-event-bubbling';
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

// ─── Interactive Events (click / change / enter / exit) ─────────────────

export interface InteractiveEventOptions {
  /** Authored event activity/name: `click`, `change`, `enter`, `exit`, … */
  activity: string;
  /** Target node: a SOM path (`form.content.email`) or a bare node name. */
  ref: string;
  /** New value applied to the target before its scripts run (change events). */
  value?: unknown;
  /** Script execution config (`skipScripts`, `skipEvents`, engine config). */
  config?: ScriptDispatchConfig;
}

/**
 * Dispatch an interactive event against a layout, simulating user interaction
 * for API consumers (tests, batch "what-if" evaluation, preview).
 *
 * Adobe only fires `click`/`change`/`enter`/`exit` when a user actually
 * interacts with a live form, so a static render never runs them. This entry
 * point lets callers drive those handlers explicitly, with XFA propagation:
 * the event runs on the target and — for bubbling events — on each ancestor,
 * exactly like the Acrobat event model (see xfa-event-bubbling.ts).
 *
 * Mutations are reconciled onto the layout by identity, so the returned layout
 * carries whatever the handlers changed.
 */
export function dispatchInteractiveEvent(
  layout: LayoutModel,
  data: Record<string, unknown>,
  options: InteractiveEventOptions,
): Result<DispatchResult> {
  const config = options.config ?? {};
  const emptyResult: DispatchResult = {
    layout,
    scriptsExecuted: 0,
    scriptErrors: 0,
    errorMessages: [],
    propertyChanges: 0,
    layoutDirty: false,
  };
  if (config.skipScripts) return success(emptyResult);

  try {
    const index = buildScriptIndex(layout);
    const allNodes = index.allNodes;
    const fieldAccessor = createFieldAccessor(allNodes, data);
    const changeTracker = new PropertyChangeTracker();
    for (const node of index.ordered) {
      changeTracker.snapshot(node.key ?? node.path ?? node.name ?? '', node);
    }

    const jsEngine = new JavaScriptEngine(fieldAccessor, config);
    jsEngine.setNodeMap(allNodes);
    jsEngine.setLayoutInfo({ pageCount: layout.pages.length, pageOf: new Map(), pageContent: new Map() });
    const stats = { executed: 0, errors: 0, errorMessages: [] as string[] };

    const eventName = normalizeEventName(undefined, options.activity);
    const target = resolveEventTarget(index, options.ref);
    if (!target) return success(emptyResult);

    // A change event's new value is visible to handlers as the node value.
    if (options.value !== undefined) {
      target.resolvedValue = options.value;
      const layoutNode = target.layoutNode as Record<string, unknown> | undefined;
      if (layoutNode) layoutNode.resolvedValue = options.value;
    }

    // One handler per (node, event); the dispatcher decides propagation.
    const dispatcher = new XfaEventDispatcher<ScriptableNode>((node) => node.parent ?? null);
    for (const entry of collectScriptsFromIndex(index)) {
      if (entry.eventName !== eventName) continue;
      if (config.skipEvents?.includes(entry.eventName)) continue;
      dispatcher.addEventListener(entry.element, entry.eventName, (event) => {
        event.handled = true;
        executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
      });
    }

    dispatcher.dispatch(target, eventName);

    const applyResult = applyTrackedChanges(index, changeTracker);
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
      `${ERROR_CODES.SCRIPT_EXECUTION_FAILED?.message ?? 'Script execution failed'}: ${e}`,
    );
  }
}

/** Resolve an event ref (SOM path or bare name) to its scriptable node. */
function resolveEventTarget(index: ScriptIndex, ref: string): ScriptableNode | undefined {
  const direct = index.allNodes.get(ref);
  if (direct) return direct;
  const stripped = ref.replace(/^\$+/, '');
  return index.allNodes.get(stripped);
}

// ─── Core 6-Phase Lifecycle ─────────────────────────────────────────────

function executeScriptLifecycle(
  layout: LayoutModel,
  data: Record<string, unknown>,
  config: ScriptDispatchConfig
): DispatchResult {
  // Build the scriptable index: exactly one ScriptableNode per layout node,
  // carrying the node's unique key and a back-reference to the concrete
  // LayoutNode it mirrors. Script collection shares these same objects, so a
  // mutation made by a script is the mutation we later reconcile.
  const index = buildScriptIndex(layout);
  const allNodes = index.allNodes;
  const fieldAccessor = createFieldAccessor(allNodes, data);
  const changeTracker = new PropertyChangeTracker();

  // Snapshot all nodes before scripts run
  for (const node of index.ordered) {
    changeTracker.snapshot(node.key ?? node.path ?? node.name ?? '', node);
  }

  // Create script engines
  const jsEngine = new JavaScriptEngine(fieldAccessor, config);
  jsEngine.setNodeMap(allNodes);
  // Pre-layout: only the template page count is known (G4).
  jsEngine.setLayoutInfo({ pageCount: layout.pages.length, pageOf: new Map(), pageContent: new Map() });

  // Collect all scripts from the layout tree
  const scripts = collectScriptsFromIndex(index);
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
  const applyResult = applyTrackedChanges(index, changeTracker);

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
    const index = buildScriptIndex(view);
    const allNodes = index.allNodes;
    const fieldAccessor = createFieldAccessor(allNodes, data);
    const changeTracker = new PropertyChangeTracker();
    for (const node of index.ordered) {
      changeTracker.snapshot(node.key ?? node.path ?? node.name ?? '', node);
    }
    const jsEngine = new JavaScriptEngine(fieldAccessor, config);
    jsEngine.setNodeMap(allNodes);
    jsEngine.setLayoutInfo(buildLayoutInfo(index, layout));
    const stats = { executed: 0, errors: 0, errorMessages: [] as string[] };

    const scripts = collectScriptsFromIndex(index);
    if (!config.skipEvents?.includes('docReady')) {
      const docReadyScripts = scripts.filter(
        (s) => s.eventName === 'docReady' || s.runAt === 'docReady'
      );
      for (const entry of docReadyScripts) {
        executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, view, data, stats);
      }
    }

    const applyResult = applyTrackedChanges(index, changeTracker);

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
 * Populate `xfa.layout` facts (G4) from a paginated tree: 1-based page numbers
 * per node (keyed by both the node object and its SOM path/key) and per-page
 * content counts.
 */
function buildLayoutInfo(
  index: ScriptIndex,
  layout: PaginatedLayout,
): XfaLayoutInfo {
  const pageOf = new Map<unknown, number>();
  const pageContent = new Map<number, number>();

  const walk = (nodes: LayoutNode[], pageNumber: number): number => {
    let count = 0;
    for (const node of nodes) {
      pageOf.set(node, pageNumber);
      count++;
      if (node.type === 'subform' || node.type === 'exclGroup') {
        count += walk(node.children, pageNumber);
      }
    }
    return count;
  };

  layout.pages.forEach((page, i) => {
    const pageNumber = page.pageIndex >= 0 ? page.pageIndex + 1 : i + 1;
    const count = walk(page.children, pageNumber) + walk(page.masterPageChildren, pageNumber);
    pageContent.set(pageNumber, count);
  });

  // Alias every scriptable key/path to its layout node's page.
  for (const scriptable of index.ordered) {
    const page = scriptable.layoutNode ? pageOf.get(scriptable.layoutNode) : undefined;
    if (page === undefined) continue;
    if (scriptable.key) pageOf.set(scriptable.key, page);
    if (scriptable.path) pageOf.set(scriptable.path, page);
  }

  return { pageCount: layout.pages.length, pageOf, pageContent };
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

  // Group per element so initialize and indexChange fire as a pair. Grouping
  // is by scriptable identity — several fields can share a name (or even a
  // full SOM path), and each must keep its own script pair.
  const grouped = new Map<ScriptableNode, { init: ScriptEntry[]; index: ScriptEntry[] }>();
  for (const entry of relevant) {
    const group = grouped.get(entry.element) ?? { init: [], index: [] };
    if (entry.eventName === 'indexChange') {
      group.index.push(entry);
    } else {
      group.init.push(entry);
    }
    grouped.set(entry.element, group);
  }

  const perElement = [...grouped.values()].map((group) => ({
    element: group.init[0]?.element ?? group.index[0].element,
    init: group.init,
    index: group.index,
  }));

  // Leaf-first: fields/draws before containers, deeper before shallower.
  for (const item of sortLeafFirst(perElement)) {
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
 * Detect snapshot diffs and reconcile them back onto the layout tree.
 * Shared by the pre-layout lifecycle and docReady.
 *
 * Reconciliation is identity-based: `applyModifiedValues` writes each
 * scriptable's results onto the exact LayoutNode that scriptable mirrors,
 * never by matching terminal names or path suffixes.
 */
function applyTrackedChanges(
  index: ScriptIndex,
  changeTracker: PropertyChangeTracker
): ApplyResult {
  for (const node of index.ordered) {
    changeTracker.detectChanges(node.key ?? node.path ?? node.name ?? '', node);
  }
  return applyModifiedValues(index, changeTracker);
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

  // Initial pass: execute all calculate scripts in topological order.
  let changedPaths = new Set<string>();
  for (const path of orderedPaths) {
    const entry = scriptByPath.get(path);
    if (!entry) continue;
    const before = snapshotValue(entry.element);
    executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
    if (before !== snapshotValue(entry.element)) changedPaths.add(path);
  }

  // Cascading passes: re-execute only scripts that READ a field changed by a
  // different script during the previous pass. Self-writes are excluded — a
  // calculate script modifying its own field does not re-trigger itself, so
  // self-referential expressions like `stage + "C"` execute exactly once per
  // drain instead of looping until the safety cap.
  // evidence: recalculate drains the queue until empty, xfaform_disasm.c:30360
  // (do/while(true); entries are dequeued before their handler runs, so a
  // handler's own write cannot re-enqueue itself mid-drain). CASCADE_SAFETY_LIMIT
  // still guards genuine cycles among distinct scripts.
  for (let cascade = 1; cascade <= CASCADE_SAFETY_LIMIT && changedPaths.size > 0; cascade++) {
    const nextRun = new Set<string>();
    for (const changed of changedPaths) {
      for (const dependent of getFieldsToRecalculate(changed, graph)) {
        if (dependent !== changed) nextRun.add(dependent);
      }
    }
    if (nextRun.size === 0) return;

    changedPaths = new Set();
    for (const path of orderedPaths) {
      if (!nextRun.has(path)) continue;
      const entry = scriptByPath.get(path);
      if (!entry) continue;
      const before = snapshotValue(entry.element);
      executeSingleScript(entry, fieldAccessor, jsEngine, allNodes, layout, data, stats);
      if (before !== snapshotValue(entry.element)) changedPaths.add(path);
    }

    if (cascade === CASCADE_SAFETY_LIMIT && changedPaths.size > 0) {
      stats.errorMessages.push(
        `[calculate] Cascade safety limit (${CASCADE_SAFETY_LIMIT}) reached — dependency cycle among calculate scripts? ` +
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
  // Anchor `$` / `this` on the exact node that owns this script before it runs.
  // Without this, `$.rawValue = …` has no current node and silently no-ops.
  const scriptKey = entry.element.key ?? entry.elementPath;
  fieldAccessor.setCurrentKey?.(scriptKey);
  try {
    const xfaNode = scriptableToXfaNode(entry.element, entry.elementPath);

    if (entry.language === 'javascript') {
      const result = jsEngine.execute(
        entry.scriptContent,
        xfaNode,
        entry.eventName,
        data,
        scriptKey
      );

      // For calculate events, the return value becomes the field's value
      if (entry.eventName === 'calculate' && result.value !== undefined) {
        entry.element.resolvedValue = result.value;
        // Also update via field accessor so other scripts see the new value
        fieldAccessor.setField(scriptKey, '$', result.value);
      }

      // Modifications made through the JS engine's `$` proxy already landed on
      // the ScriptableNode itself (`resolvedValue` / `presence` / `access`), so
      // reconciliation below picks them up by identity — no name matching.
    } else {
      // FormCalc
      const parser = new FormCalcParser(entry.scriptContent);
      const ast = parser.parse();
      const evaluator = new FormCalcEvaluator(fieldAccessor);
      const result = evaluator.evaluate(ast);

      // For calculate events, apply the last expression value
      if (entry.eventName === 'calculate' && result.value !== undefined) {
        entry.element.resolvedValue = result.value;
        fieldAccessor.setField(scriptKey, '$', result.value);
      }
    }
    stats.executed++;
  } catch (e) {
    stats.errors++;
    const msg = e instanceof Error ? e.message : String(e);
    stats.errorMessages.push(`[${entry.eventName}] ${entry.elementPath}: ${msg}`);
    // Non-fatal: continue with other scripts (matching Adobe behavior)
  } finally {
    fieldAccessor.setCurrentKey?.(null);
  }
}

// ─── Leaf-First Sort ────────────────────────────────────────────────────

/**
 * Sort scripts so leaf nodes (fields, draws) execute before containers (subforms).
 * Within the same depth, maintain document order.
 * This matches Adobe's initialize event firing order.
 */
function sortLeafFirst<T extends { elementPath?: string; element: ScriptableNode }>(
  scripts: T[]
): T[] {
  return [...scripts].sort((a, b) => {
    const aDepth = (a.elementPath ?? a.element.path ?? '').split('.').length;
    const bDepth = (b.elementPath ?? b.element.path ?? '').split('.').length;
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

/**
 * A shared index of scriptable nodes.
 *
 * Exactly one `ScriptableNode` exists per layout node, and every consumer —
 * the node map, script collection, the `$` proxy, the change reconciler —
 * receives those *same objects*. A mutation made by a script is therefore the
 * mutation that is later applied back to the layout tree.
 */
export interface ScriptIndex {
  /**
   * Flat lookup keyed by each node's unique `key`: `path` for the first node
   * claiming that path, `path#N` for later ones. First-wins at `path` keeps
   * SOM semantics (a script naming a field means the first one) while duplicate
   * names stay individually addressable by `key`.
   */
  allNodes: Map<string, ScriptableNode>;
  /** Every scriptable in document order — includes duplicate-path nodes. */
  ordered: ScriptableNode[];
  /** Root subform scriptable; its scripts live in `layout.rootEvents`. */
  root?: ScriptableNode;
}

export function buildScriptIndex(layout: LayoutModel): ScriptIndex {
  const allNodes = new Map<string, ScriptableNode>();
  const ordered: ScriptableNode[] = [];
  const pathCounts = new Map<string, number>();
  let root: ScriptableNode | undefined;

  // Root subform entry — the root is collapsed to rootSubformName in the
  // LayoutModel; its scripts live in layout.rootEvents (see parse-xdp.ts).
  if (layout.rootSubformName) {
    root = {
      type: 'subform',
      name: layout.rootSubformName,
      key: layout.rootSubformName,
      path: layout.rootSubformName,
      uid: layout.rootSubformName,
      presence: 'visible',
      events: layout.rootEvents,
      children: [],
    };
    allNodes.set(root.key!, root);
    ordered.push(root);
  }

  function walkNodes(nodes: LayoutNode[], parent: ScriptableNode | undefined) {
    const parentPath = parent?.path ?? '';
    for (const node of nodes) {
      const name = node.name ?? '<unnamed>';
      const path = parentPath ? `${parentPath}.${name}` : name;
      const seen = pathCounts.get(path) ?? 0;
      pathCounts.set(path, seen + 1);
      // Unique key: first node claims the bare path, later duplicates get #N.
      const key = seen === 0 ? path : `${path}#${seen + 1}`;

      const scriptable: ScriptableNode = {
        type: node.type,
        name: node.name,
        key,
        path,
        uid: 'uid' in node ? node.uid : undefined,
        layoutNode: node,
        parent,
        bindRef: 'bindRef' in node ? (node as { bindRef?: string }).bindRef : undefined,
        bindMatch: 'bindMatch' in node ? (node as { bindMatch?: string }).bindMatch : undefined,
        presence: node.presence,
        access: 'access' in node ? (node as { access?: string }).access : undefined,
        resolvedValue: 'resolvedValue' in node ? (node as { resolvedValue?: unknown }).resolvedValue : undefined,
        formatPicture: 'formatPicture' in node ? (node as { formatPicture?: string }).formatPicture : undefined,
        position: 'position' in node
          ? (node as { position?: { x?: number; y?: number; w?: number; h?: number; rotate?: number } }).position
          : undefined,
        events: 'events' in node ? (node as { events?: ScriptableNode['events'] }).events : undefined,
        calculate: 'calculate' in node ? (node as { calculate?: ScriptableNode['calculate'] }).calculate : undefined,
        // evidence: <validate> scripts are attached to fields by the template
        // parser (parse-xdp.ts:217) and must be collected for the validate
        // queue of XFAFormModel::recalculate (xfaform_disasm.c:30396-30420)
        validate: 'validate' in node ? (node as { validate?: ScriptableNode['validate'] }).validate : undefined,
        children: [],
      };

      allNodes.set(key, scriptable);
      // Leaf-name fallback: XFA scripts may reference a node by its bare name
      // when unambiguous (e.g. `stage = stage + "A"` for field content.stage).
      // Exact SOM paths always win; first occurrence claims the short name.
      if (scriptable.name && !allNodes.has(scriptable.name)) {
        allNodes.set(scriptable.name, scriptable);
      }

      ordered.push(scriptable);
      if (parent) parent.children!.push(scriptable);

      if (node.type === 'subform' || node.type === 'exclGroup') {
        walkNodes((node as { children: LayoutNode[] }).children, scriptable);
      }
    }
  }

  walkNodes(layout.children, root);
  for (const page of layout.pages) {
    walkNodes(page.masterPageChildren, root);
  }

  return { allNodes, ordered, root };
}

function collectScriptsFromIndex(index: ScriptIndex): ScriptEntry[] {
  const entries: ScriptEntry[] = [];
  for (const node of index.ordered) {
    entries.push(...collectScriptsFromNode(node, node.key ?? node.path ?? node.name ?? ''));
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

/**
 * Reconcile script results back onto the layout tree — identity-based.
 *
 * Every `ScriptableNode` in the index carries a reference to the exact
 * `LayoutNode` it mirrors (`layoutNode`), so a write made against one node
 * can never land on a same-named sibling. Terminal-name matching
 * (`path.endsWith('.' + name)`) and path-suffix matching are deliberately
 * not used: duplicate field names are common in real XDP (repeated rows,
 * `-Black`/`-White` pairs) and first-match-wins silently corrupted them.
 *
 * Only properties that actually changed since the pre-script snapshot are
 * written, so counts reported by `PropertyChangeTracker` stay accurate.
 */
function applyModifiedValues(
  index: ScriptIndex,
  changeTracker: PropertyChangeTracker
): ApplyResult {
  return changeTracker.applyByIdentity(index.ordered);
}
