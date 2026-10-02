import { Result, LayoutModel, LayoutNode, PresenceValue } from '../../types';
import { success } from '../../lib/result-type';
import { createRelevanceTest } from './relevance';

/**
 * Evaluate conditional visibility and remove hidden/inactive nodes.
 *
 * Two sources of visibility are honoured:
 *  1. `@presence` — already resolved by the script dispatcher
 *     (`$.presence = "hidden"`).
 *  2. `@relevant` — a FormCalc expression; false ⇒ the object is not part of
 *     the form (G2, see `relevance.ts`).
 *
 * `data` is optional: without it there is nothing for `@relevant` to resolve
 * references against, so only `@presence` is applied.
 */
export function evaluateConditions(
  layout: LayoutModel,
  data?: Record<string, unknown>
): Result<LayoutModel> {
  const relevant = createRelevanceTest(layout, data);
  const filtered = {
    ...layout,
    children: filterNodes(layout.children, relevant),
    pages: layout.pages.map((page) => ({
      ...page,
      masterPageChildren: filterNodes(page.masterPageChildren, relevant),
    })),
  };
  return success(filtered);
}

type RelevanceTest = (node: LayoutNode) => boolean | undefined;

function filterNodes(nodes: LayoutNode[], relevant?: RelevanceTest): LayoutNode[] {
  return nodes
    .map((node) => resolveNodePresence(node, relevant))
    .filter((node) => !isRemoved(node.presence));
}

function resolveNodePresence(node: LayoutNode, relevant?: RelevanceTest): LayoutNode {
  const resolved = evaluateNodeConditions(node, relevant);
  if (resolved.type === 'subform') {
    return { ...resolved, children: filterNodes(resolved.children, relevant) };
  }
  if (resolved.type === 'exclGroup') {
    return {
      ...resolved,
      children: resolved.children
        .map((child) => resolveNodePresence(child, relevant))
        .filter((child) => !isRemoved(child.presence)) as typeof resolved.children,
    };
  }
  return resolved;
}

function evaluateNodeConditions(node: LayoutNode, relevant?: RelevanceTest): LayoutNode {
  // `@relevant` may decorate any object type — field, subform, draw, exclGroup.
  const stillRelevant = relevant ? relevant(node) : undefined;
  if (stillRelevant === false) {
    return { ...node, presence: 'hidden' } as LayoutNode;
  }

  if (
    node.type === 'field' ||
    node.type === 'subform' ||
    node.type === 'draw' ||
    node.type === 'exclGroup'
  ) {
    const presence = resolveFieldPresence(node);
    if (presence !== node.presence) return { ...node, presence } as LayoutNode;
  }
  return node;
}

function resolveFieldPresence(node: {
  presence?: PresenceValue;
  resolvedValue?: unknown;
}): PresenceValue {
  const current = node.presence ?? 'visible';

  // Apply common pattern: hide if no resolved value
  if (current === 'visible' && node.resolvedValue == null) {
    // Keep visible — allow rendering with empty value
    return 'visible';
  }

  return current;
}

function isRemoved(presence?: PresenceValue): boolean {
  return presence === 'hidden' || presence === 'inactive';
}
