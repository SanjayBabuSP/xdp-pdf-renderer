import { LayoutModel, LayoutNode } from '../../types';
import { buildScriptIndex } from '../scripting/event-dispatcher';
import { createFieldAccessor } from '../scripting/xfa-object-model';
import { FormCalcParser, FormCalcEvaluator, formCalcTruthy } from '../scripting/formcalc';

/**
 * G2 — `@relevant` conditional visibility.
 *
 * XFA `@relevant` is a FormCalc expression evaluated in the context of the
 * node it decorates; when it is false the object is not part of the form
 * (equivalent to `presence="hidden"`).
 *
 * Evidence: the expression is parsed onto `SubformNode.relevant` /
 * `FieldNode.relevant` (`parse-xdp.ts:183`, `:217`) but nothing consumed it —
 * `evaluateConditions` only looked at a literal `presence` string, so every
 * conditional form in a template rendered unconditionally.
 *
 * Design notes:
 * - The expression can reference siblings and ancestors (`$.rawValue`,
 *   `OtherField.formattedValue`), so it is evaluated through the same
 *   `FieldAccessor` the script dispatcher uses — built from the *same*
 *   layout tree, therefore seeing the post-script values.
 * - Evaluation is read-only. A parse/evaluation error never hides a node;
 *   Adobe keeps rendering on a script failure, and silently dropping content
 *   is the more damaging failure mode.
 * - A top-level `|` list (an OR of alternative tests) is tried when the whole
 *   expression does not parse as one FormCalc program.
 */

export interface RelevantNode {
  node: LayoutNode;
  key: string;
  expression: string;
}

/** Collect every node carrying a non-empty `@relevant`. */
export function collectRelevantNodes(layout: LayoutModel): RelevantNode[] {
  const out: RelevantNode[] = [];
  const seen = new Map<LayoutNode, string>();

  const visit = (nodes: LayoutNode[]): void => {
    for (const node of nodes) {
      const expr = 'relevant' in node ? (node as { relevant?: string }).relevant : undefined;
      if (expr && expr.trim() !== '' && !seen.has(node)) {
        seen.set(node, '');
        out.push({ node, key: '', expression: expr.trim() });
      }
      if (node.type === 'subform' || node.type === 'exclGroup') {
        visit((node as { children: LayoutNode[] }).children);
      }
    }
  };

  visit(layout.children);
  for (const page of layout.pages) visit(page.masterPageChildren);

  // Resolve each collected node to its script index key so `$` binds to it.
  const index = buildScriptIndex(layout);
  const byIdentity = new Map<LayoutNode, string>();
  for (const scriptable of index.ordered) {
    const layoutNode = scriptable.layoutNode as LayoutNode | undefined;
    if (layoutNode && !byIdentity.has(layoutNode)) {
      byIdentity.set(layoutNode, scriptable.key ?? scriptable.path ?? '');
    }
  }
  for (const entry of out) entry.key = byIdentity.get(entry.node) ?? '';

  return out;
}

/**
 * Build a predicate that answers "is this node relevant?".
 *
 * Returns `undefined` when there is nothing to evaluate or no data is
 * available, so the caller can skip the work entirely.
 */
export function createRelevanceTest(
  layout: LayoutModel,
  data: Record<string, unknown> | undefined
): ((node: LayoutNode) => boolean | undefined) | undefined {
  const entries = collectRelevantNodes(layout);
  if (entries.length === 0) return undefined;
  if (!data) return undefined;

  const index = buildScriptIndex(layout);
  const accessor = createFieldAccessor(index.allNodes, data);
  const byNode = new Map<LayoutNode, RelevantNode>();
  for (const entry of entries) byNode.set(entry.node, entry);

  return (node: LayoutNode): boolean | undefined => {
    const entry = byNode.get(node);
    if (!entry) return undefined;
    return evaluateRelevance(accessor, entry);
  };
}

function evaluateRelevance(
  accessor: ReturnType<typeof createFieldAccessor>,
  entry: RelevantNode
): boolean | undefined {
  const key = entry.key;
  const run = (expr: string): boolean | undefined => {
    let value: unknown;
    try {
      const program = new FormCalcParser(expr).parse();
      accessor.setCurrentKey?.(key || null);
      value = new FormCalcEvaluator(accessor).evaluate(program).value;
    } catch {
      return undefined;
    }
    return formCalcTruthy(value);
  };

  const whole = run(entry.expression);
  if (whole !== undefined) return whole;

  // `@relevant="A | B"` — an OR list of alternative tests.
  const parts = splitTopLevel(entry.expression, '|');
  if (parts.length <= 1) return undefined;
  let anyParseFailure = false;
  let anyTrue = false;
  for (const part of parts) {
    const r = run(part);
    if (r === undefined) {
      anyParseFailure = true;
    } else if (r) {
      anyTrue = true;
    }
  }
  // Fail open: an unparseable branch means we cannot prove irrelevance.
  if (anyParseFailure) return undefined;
  return anyTrue;
}

/** Split on `sep` ignoring separators inside quotes or brackets. */
export function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}
