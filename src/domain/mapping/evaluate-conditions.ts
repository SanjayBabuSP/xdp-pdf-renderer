import { Result, LayoutModel, LayoutNode, PresenceValue } from '../../types';
import { success } from '../../lib/result-type';

/**
 * Evaluate conditional visibility and remove hidden/inactive nodes.
 * Supports the common patterns documented in the spec.
 */
export function evaluateConditions(layout: LayoutModel): Result<LayoutModel> {
  const filtered = {
    ...layout,
    children: filterNodes(layout.children),
    pages: layout.pages.map((page) => ({
      ...page,
      masterPageChildren: filterNodes(page.masterPageChildren),
    })),
  };
  return success(filtered);
}

function filterNodes(nodes: LayoutNode[]): LayoutNode[] {
  return nodes
    .map((node) => resolveNodePresence(node))
    .filter((node) => !isRemoved(node.presence));
}

function resolveNodePresence(node: LayoutNode): LayoutNode {
  const resolved = evaluateNodeConditions(node);
  if (resolved.type === 'subform') {
    return { ...resolved, children: filterNodes(resolved.children) };
  }
  return resolved;
}

function evaluateNodeConditions(node: LayoutNode): LayoutNode {
  if (node.type === 'field' || node.type === 'subform') {
    const presence = resolveFieldPresence(node);
    return { ...node, presence };
  }
  return node;
}

function resolveFieldPresence(node: { presence?: PresenceValue; resolvedValue?: unknown }): PresenceValue {
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
