import { LayoutModel, LayoutNode, PaginatedLayout, Result } from '../../types';
import { success, failure } from '../../lib/result-type';
import { ERROR_CODES } from '../../errors/error-codes';
import { ScriptEngineConfig } from './script-types';
import { FormCalcParser, FormCalcEvaluator, FieldAccessor } from './formcalc';
import { JavaScriptEngine } from './js-engine';
import type { XfaLayoutInfo } from './js-engine/javascript-engine';
import {
  createFieldAccessor,
  scriptableToXfaNode,
  readLayoutColors,
  ScriptEntry,
} from './xfa-object-model';
import { PropertyChangeTracker, ApplyResult } from './property-change-tracker';
import { XfaEventDispatcher } from '../../adobe/xfa-event-bubbling';
import { buildDependencyGraph, getFieldsToRecalculate } from './script-dependency-tracker';
import type { ScriptableNode } from './script-types';

const CASCADE_SAFETY_LIMIT = 100;

function toSkipSet(config: ScriptDispatchConfig): ReadonlySet<string> {
  return new Set(config.skipEvents ?? []);
}

export interface DispatchResult<TLayout = LayoutModel> {
  layout: TLayout;
  scriptsExecuted: number;
  scriptErrors: number;
  errorMessages: string[];
  propertyChanges: number;
  layoutDirty: boolean;
}

export interface ScriptDispatchConfig extends ScriptEngineConfig {
  skipScripts?: boolean;
  skipEvents?: string[];
}

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

export interface InteractiveEventOptions {
  activity: string;
  ref: string;
  value?: unknown;
  config?: ScriptDispatchConfig;
}

export function dispatchInteractiveEvent(
  layout: LayoutModel,
  data: Record<string, unknown>,
  options: InteractiveEventOptions
): Result<DispatchResult> {
  const config = options.config ?? {};
  const skipEvents = toSkipSet(config);
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
    const fieldAccessor = createFieldAccessor(allNodes, data, config.locale);
    const changeTracker = new PropertyChangeTracker();
    for (const node of index.ordered) {
      changeTracker.snapshot(node.key ?? node.path ?? node.name ?? '', node);
    }

    const jsEngine = new JavaScriptEngine(fieldAccessor, config);
    jsEngine.setNodeMap(allNodes);
    jsEngine.setLayoutInfo({
      pageCount: layout.pages.length,
      pageOf: new Map(),
      pageContent: new Map(),
    });
    const stats = { executed: 0, errors: 0, errorMessages: [] as string[] };

    const eventName = normalizeEventName(undefined, options.activity);
    const target = resolveEventTarget(index, options.ref);
    if (!target) return success(emptyResult);

    if (options.value !== undefined) {
      target.resolvedValue = options.value;
      const layoutNode = target.layoutNode as Record<string, unknown> | undefined;
      if (layoutNode) layoutNode.resolvedValue = options.value;
    }

    const dispatcher = new XfaEventDispatcher<ScriptableNode>((node) => node.parent ?? null);
    for (const entry of collectScriptsFromIndex(index)) {
      if (entry.eventName !== eventName) continue;
      if (skipEvents.has(entry.eventName)) continue;
      dispatcher.addEventListener(entry.element, entry.eventName, (event) => {
        event.handled = true;
        executeSingleScript(
          entry,
          fieldAccessor,
          jsEngine,
          allNodes,
          layout,
          data,
          stats,
          config.locale
        );
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
      `${ERROR_CODES.SCRIPT_EXECUTION_FAILED?.message ?? 'Script execution failed'}: ${e}`
    );
  }
}

function resolveEventTarget(index: ScriptIndex, ref: string): ScriptableNode | undefined {
  const direct = index.allNodes.get(ref);
  if (direct) return direct;
  const stripped = ref.replace(/^\$+/, '');
  return index.allNodes.get(stripped);
}

function executeScriptLifecycle(
  layout: LayoutModel,
  data: Record<string, unknown>,
  config: ScriptDispatchConfig
): DispatchResult {
  const index = buildScriptIndex(layout);
  const allNodes = index.allNodes;
  const fieldAccessor = createFieldAccessor(allNodes, data);
  const changeTracker = new PropertyChangeTracker();
  const skipEvents = toSkipSet(config);

  for (const node of index.ordered) {
    changeTracker.snapshot(node.key ?? node.path ?? node.name ?? '', node);
  }

  const jsEngine = new JavaScriptEngine(fieldAccessor, config);
  jsEngine.setNodeMap(allNodes);
  jsEngine.setLayoutInfo({
    pageCount: layout.pages.length,
    pageOf: new Map(),
    pageContent: new Map(),
  });

  const scripts = collectScriptsFromIndex(index);
  const stats = {
    executed: 0,
    errors: 0,
    errorMessages: [] as string[],
  };

  if (!skipEvents.has('initialize')) {
    executeInitializePhase(scripts, fieldAccessor, jsEngine, allNodes, layout, data, stats, config);
  }

  if (!skipEvents.has('calculate')) {
    const calcScripts = scripts.filter((s) => s.eventName === 'calculate');
    executeCalculatePhase(
      calcScripts,
      fieldAccessor,
      jsEngine,
      allNodes,
      layout,
      data,
      stats,
      config
    );
  }

  if (!skipEvents.has('validate')) {
    const validateScripts = scripts.filter((s) => s.eventName === 'validate');
    for (const entry of validateScripts) {
      executeSingleScript(
        entry,
        fieldAccessor,
        jsEngine,
        allNodes,
        layout,
        data,
        stats,
        config.locale
      );
    }
  }

  if (!skipEvents.has('overlay')) {
    const overlayScripts = scripts.filter((s) => s.eventName === 'overlay');
    for (const entry of overlayScripts) {
      executeSingleScript(
        entry,
        fieldAccessor,
        jsEngine,
        allNodes,
        layout,
        data,
        stats,
        config.locale
      );
    }
  }

  if (!skipEvents.has('ready') && !skipEvents.has('form:ready')) {
    const formReadyScripts = scripts.filter(
      (s) => (s.eventName === 'ready' || s.eventName === 'form:ready') && !isLayoutReadyEvent(s)
    );
    for (const entry of formReadyScripts) {
      executeSingleScript(
        entry,
        fieldAccessor,
        jsEngine,
        allNodes,
        layout,
        data,
        stats,
        config.locale
      );
    }
  }

  if (!skipEvents.has('layout:ready') && !skipEvents.has('layoutReady')) {
    const layoutReadyScripts = scripts.filter((s) => isLayoutReadyEvent(s));
    for (const entry of layoutReadyScripts) {
      executeSingleScript(
        entry,
        fieldAccessor,
        jsEngine,
        allNodes,
        layout,
        data,
        stats,
        config.locale
      );
    }
  }

  const applyResult = applyTrackedChanges(index, changeTracker);

  return {
    layout,
    scriptsExecuted: stats.executed,
    scriptErrors: stats.errors,
    errorMessages: stats.errorMessages,
    propertyChanges:
      applyResult.valuesChanged + applyResult.presenceChanged + applyResult.accessChanged,
    layoutDirty: applyResult.layoutDirty,
  };
}

export function dispatchPostLayoutScripts(
  layout: PaginatedLayout,
  data: Record<string, unknown>,
  config: ScriptDispatchConfig = {}
): Result<DispatchResult<PaginatedLayout>> {
  const skipEvents = toSkipSet(config);
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
    const view = paginatedToLayoutView(layout);
    const index = buildScriptIndex(view);
    const allNodes = index.allNodes;
    const fieldAccessor = createFieldAccessor(allNodes, data, config.locale);
    const changeTracker = new PropertyChangeTracker();
    for (const node of index.ordered) {
      changeTracker.snapshot(node.key ?? node.path ?? node.name ?? '', node);
    }
    const jsEngine = new JavaScriptEngine(fieldAccessor, config);
    jsEngine.setNodeMap(allNodes);
    jsEngine.setLayoutInfo(buildLayoutInfo(index, layout));
    const stats = { executed: 0, errors: 0, errorMessages: [] as string[] };

    const scripts = collectScriptsFromIndex(index);
    if (!skipEvents.has('docReady')) {
      const docReadyScripts = scripts.filter(
        (s) => s.eventName === 'docReady' || s.runAt === 'docReady'
      );
      for (const entry of docReadyScripts) {
        executeSingleScript(
          entry,
          fieldAccessor,
          jsEngine,
          allNodes,
          view,
          data,
          stats,
          config.locale
        );
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

function buildLayoutInfo(index: ScriptIndex, layout: PaginatedLayout): XfaLayoutInfo {
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

  for (const scriptable of index.ordered) {
    const page = scriptable.layoutNode ? pageOf.get(scriptable.layoutNode) : undefined;
    if (page === undefined) continue;
    if (scriptable.key) pageOf.set(scriptable.key, page);
    if (scriptable.path) pageOf.set(scriptable.path, page);
  }

  return { pageCount: layout.pages.length, pageOf, pageContent };
}

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

function isLayoutReadyEvent(entry: ScriptEntry): boolean {
  return (
    entry.eventName === 'layout:ready' || (entry.eventName === 'ready' && entry.ref === '$layout')
  );
}

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
  const skipEvents = toSkipSet(config);
  const relevant = scripts.filter(
    (s) => s.eventName === 'initialize' || s.eventName === 'indexChange' || s.runAt === 'docOpen'
  );
  if (relevant.length === 0) return;

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

  for (const item of orderInitializeByTree(perElement)) {
    if (!skipEvents.has('initialize')) {
      for (const entry of item.init) {
        executeSingleScript(
          entry,
          fieldAccessor,
          jsEngine,
          allNodes,
          layout,
          data,
          stats,
          config.locale
        );
      }
    }
    if (!skipEvents.has('indexChange')) {
      for (const entry of item.index) {
        executeSingleScript(
          entry,
          fieldAccessor,
          jsEngine,
          allNodes,
          layout,
          data,
          stats,
          config.locale
        );
      }
    }
  }
}

function applyTrackedChanges(
  index: ScriptIndex,
  changeTracker: PropertyChangeTracker
): ApplyResult {
  for (const node of index.ordered) {
    changeTracker.detectChanges(node.key ?? node.path ?? node.name ?? '', node);
  }
  return applyModifiedValues(index, changeTracker);
}

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

  const graph = buildDependencyGraph(calcScripts, allNodes);

  if (graph.hasCycles) {
    stats.errorMessages.push(
      `[calculate] Dependency cycle detected in fields: ${graph.cyclePaths.join(', ')}`
    );
  }

  const scriptByPath = new Map<string, ScriptEntry>();
  for (const entry of calcScripts) {
    scriptByPath.set(entry.elementPath, entry);
  }

  const orderedPaths = graph.executionOrder.length
    ? graph.executionOrder
    : calcScripts.map((s) => s.elementPath);

  let changedPaths = new Set<string>();
  for (const path of orderedPaths) {
    const entry = scriptByPath.get(path);
    if (!entry) continue;
    const before = snapshotValue(entry.element);
    executeSingleScript(
      entry,
      fieldAccessor,
      jsEngine,
      allNodes,
      layout,
      data,
      stats,
      config.locale
    );
    if (before !== snapshotValue(entry.element)) changedPaths.add(path);
  }

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
      executeSingleScript(
        entry,
        fieldAccessor,
        jsEngine,
        allNodes,
        layout,
        data,
        stats,
        config.locale
      );
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

function executeSingleScript(
  entry: ScriptEntry,
  fieldAccessor: FieldAccessor,
  jsEngine: JavaScriptEngine,
  allNodes: Map<string, ScriptableNode>,
  layout: LayoutModel,
  data: Record<string, unknown>,
  stats: { executed: number; errors: number; errorMessages: string[] },
  locale?: string
): void {
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

      if (entry.eventName === 'calculate' && result.value !== undefined) {
        entry.element.resolvedValue = result.value;
        fieldAccessor.setField(scriptKey, '$', result.value);
      }
    } else {
      const parser = new FormCalcParser(entry.scriptContent);
      const ast = parser.parse();
      const evaluator = new FormCalcEvaluator(fieldAccessor, {
        locale: entry.element.locale ?? locale,
      });
      const result = evaluator.evaluate(ast);

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
  } finally {
    fieldAccessor.setCurrentKey?.(null);
  }
}

function orderInitializeByTree<T extends { element: ScriptableNode }>(items: T[]): T[] {
  const byElement = new Map<ScriptableNode, T>();
  for (const item of items) byElement.set(item.element, item);

  const roots = new Set<ScriptableNode>();
  for (const item of items) {
    let node: ScriptableNode | undefined = item.element;
    while (node?.parent) node = node.parent;
    if (node) roots.add(node);
  }

  const out: T[] = [];
  const seen = new Set<T>();
  const visit = (node: ScriptableNode): void => {
    for (const child of node.children ?? []) visit(child);
    const item = byElement.get(node);
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  };
  for (const node of roots) visit(node);
  for (const item of items) {
    if (!seen.has(item)) out.push(item);
  }
  return out;
}

export interface ScriptIndex {
  allNodes: Map<string, ScriptableNode>;
  ordered: ScriptableNode[];
  root?: ScriptableNode;
}

export function buildScriptIndex(layout: LayoutModel): ScriptIndex {
  const allNodes = new Map<string, ScriptableNode>();
  const ordered: ScriptableNode[] = [];
  const pathCounts = new Map<string, number>();
  let root: ScriptableNode | undefined;

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

  for (const [name, value] of Object.entries(layout.variables ?? {})) {
    const variable: ScriptableNode = {
      type: 'variable',
      name,
      key: name,
      path: name,
      uid: name,
      presence: 'visible',
      resolvedValue: value,
      children: [],
    };
    allNodes.set(name, variable);
    ordered.push(variable);
    root?.children?.push(variable);
  }

  function walkNodes(nodes: LayoutNode[], parent: ScriptableNode | undefined) {
    const parentPath = parent?.path ?? '';
    for (const node of nodes) {
      const name = node.name ?? '<unnamed>';
      const path = parentPath ? `${parentPath}.${name}` : name;
      const seen = pathCounts.get(path) ?? 0;
      pathCounts.set(path, seen + 1);
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
        resolvedValue:
          'resolvedValue' in node ? (node as { resolvedValue?: unknown }).resolvedValue : undefined,
        formatPicture:
          'formatPicture' in node ? (node as { formatPicture?: string }).formatPicture : undefined,
        locale: 'locale' in node ? (node as { locale?: string }).locale : undefined,
        position:
          'position' in node
            ? (
                node as {
                  position?: { x?: number; y?: number; w?: number; h?: number; rotate?: number };
                }
              ).position
            : undefined,
        events:
          'events' in node ? (node as { events?: ScriptableNode['events'] }).events : undefined,
        calculate:
          'calculate' in node
            ? (node as { calculate?: ScriptableNode['calculate'] }).calculate
            : undefined,
        validate:
          'validate' in node
            ? (node as { validate?: ScriptableNode['validate'] }).validate
            : undefined,
        ...readLayoutColors(node),
        children: [],
      };

      allNodes.set(key, scriptable);
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

  const fieldNode = node as unknown as {
    validate?: { script?: { content: string; contentType: string; runAt?: string } };
  };
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

function normalizeEventName(name?: string, activity?: string): string {
  if (activity) {
    const normalized = activity.toLowerCase();
    switch (normalized) {
      case 'initialize':
        return 'initialize';
      case 'calculate':
        return 'calculate';
      case 'validate':
        return 'validate';
      case 'click':
        return 'click';
      case 'change':
        return 'change';
      case 'enter':
        return 'enter';
      case 'exit':
        return 'exit';
      case 'mouseenter':
        return 'mouseEnter';
      case 'mouseexit':
        return 'mouseExit';
      case 'mouseup':
        return 'mouseUp';
      case 'mousedown':
        return 'mouseDown';
      case 'ready':
        return 'ready';
      case 'docready':
        return 'docReady';
      case 'docclose':
        return 'docClose';
      case 'presave':
        return 'preSave';
      case 'postsave':
        return 'postSave';
      case 'preprint':
        return 'prePrint';
      case 'postprint':
        return 'postPrint';
      case 'presubmit':
        return 'preSubmit';
      case 'postsubmit':
        return 'postSubmit';
      case 'preexecute':
        return 'preExecute';
      case 'postexecute':
        return 'postExecute';
      case 'presign':
        return 'preSign';
      case 'postsign':
        return 'postSign';
      case 'preopen':
        return 'preOpen';
      case 'postopen':
        return 'postOpen';
      case 'preclose':
        return 'preClose';
      case 'postclose':
        return 'postClose';
      case 'validationstate':
        return 'validationState';
      case 'overlay':
        return 'overlay';
      case 'full':
        return 'full';
      case 'indexchange':
        return 'indexChange';
      default:
        return normalized;
    }
  }

  if (name) {
    const sap = name.replace(/^event__/, '');
    return sap.toLowerCase();
  }

  return 'unknown';
}

function detectScriptLanguage(contentType?: string): 'formcalc' | 'javascript' {
  if (!contentType) return 'formcalc';
  const lower = contentType.toLowerCase();
  if (lower.includes('javascript') || lower.includes('ecmascript')) return 'javascript';
  return 'formcalc';
}

function applyModifiedValues(
  index: ScriptIndex,
  changeTracker: PropertyChangeTracker
): ApplyResult {
  return changeTracker.applyByIdentity(index.ordered);
}
