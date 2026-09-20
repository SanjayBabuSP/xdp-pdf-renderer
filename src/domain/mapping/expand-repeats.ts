import { Result, LayoutModel, LayoutNode, SubformNode, DataObject, DataValue } from '../../types';
import { success, failure } from '../../lib/result-type';
import { resolveXPath } from '../../lib/xpath-resolver';
import { ERROR_CODES } from '../../errors/error-codes';

const MAX_OCCURRENCES = 10000;

/** Expand repeating subforms (occur.max === -1) into concrete instances. */
export function expandRepeats(layout: LayoutModel, data: DataObject): Result<LayoutModel> {
  try {
    const expanded = {
      ...layout,
      children: expandNodes(layout.children, data),
      pages: layout.pages.map((page) => ({
        ...page,
        masterPageChildren: expandNodes(page.masterPageChildren, data),
      })),
    };
    return success(expanded);
  } catch (e) {
    return failure(ERROR_CODES.BINDING_FAILED.code, `Expand repeats failed: ${e}`);
  }
}

function expandNodes(nodes: LayoutNode[], data: DataObject): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const node of nodes) {
    result.push(...expandNode(node, data));
  }
  return result;
}

function expandNode(node: LayoutNode, data: DataObject): LayoutNode[] {
  if (node.type === 'subform') return expandSubform(node, data);
  return [node];
}

function expandSubform(node: SubformNode, data: DataObject): LayoutNode[] {
  const isRepeating = node.occur?.max === -1 || (node.occur?.max !== undefined && node.occur.max > 1);

  if (isRepeating && node.bindMatch === 'dataRef' && node.bindRef) {
    return expandRepeatingSubform(node, data);
  }

  // Non-repeating: recurse into children
  return [{ ...node, children: expandNodes(node.children, data) }];
}

function expandRepeatingSubform(node: SubformNode, data: DataObject): LayoutNode[] {
  const arrayRef = node.bindRef!.replace(/\[\*\]$/, '');
  const arrayData = resolveXPath(arrayRef, data) as DataValue;

  if (!Array.isArray(arrayData)) {
    return [{ ...node, children: expandNodes(node.children, data) }];
  }

  const limit = Math.min(arrayData.length, MAX_OCCURRENCES);
  const instances: LayoutNode[] = [];

  // Determine the per-instance offset based on the subform's layout direction.
  // For "tb" layout, offset vertically by the row height; for "lr", horizontally by column width.
  // For "position" layout (XFA default), treat as implicit top-to-bottom flow.
  const rowHeight = estimateSubformHeight(node);
  const colWidth = node.position?.w ?? 0;

  for (let i = 0; i < limit; i++) {
    const itemData = arrayData[i] as DataObject;
    const offsetX = (node.layout === 'lr') ? i * colWidth : 0;
    const offsetY = (node.layout === 'tb' || node.layout === 'position' || !node.layout) ? i * rowHeight : 0;

    const instance: SubformNode = {
      ...node,
      occur: undefined, // Resolved — no longer repeating
      bindRef: `${arrayRef}[${i}]`,
      children: resolveChildrenWithData(node.children, itemData),
      position: node.position
        ? {
            ...node.position,
            x: (node.position.x ?? 0) + offsetX,
            y: (node.position.y ?? 0) + offsetY,
          }
        : undefined,
    };
    instances.push(instance);
  }
  return instances;
}

/** Estimate the height of a subform node for repeat offset calculation. */
function estimateSubformHeight(node: SubformNode): number {
  if (node.position?.h) return node.position.h;
  if (node.position?.minH) return node.position.minH;
  // Sum children heights as fallback
  let total = 0;
  for (const child of node.children) {
    if (child.type === 'field') {
      total += child.position?.h ?? child.position?.minH ?? 18;
    } else if (child.type === 'draw') {
      total += child.position?.h ?? 18;
    } else if (child.type === 'subform') {
      total += estimateSubformHeight(child);
    } else {
      total += 18;
    }
  }
  return total || 18;
}

function resolveChildrenWithData(children: LayoutNode[], itemData: DataObject): LayoutNode[] {
  return children.map((child) => {
    if (child.type === 'field' && child.bindMatch === 'dataRef' && child.bindRef) {
      const resolved = resolveXPath(child.bindRef, itemData);
      return { ...child, resolvedValue: resolved };
    }
    if (child.type === 'subform') {
      return { ...child, children: resolveChildrenWithData(child.children, itemData) };
    }
    return child;
  });
}
