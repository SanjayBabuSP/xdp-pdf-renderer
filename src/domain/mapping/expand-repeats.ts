import { Result, LayoutModel, LayoutNode, SubformNode, DataObject, DataValue } from '../../types';
import { success, failure } from '../../lib/result-type';
import { resolveXPath, resolveXPathRelative } from '../../lib/xpath-resolver';
import { ERROR_CODES } from '../../errors/error-codes';
import { stampUids } from '../../lib/node-uid';

const MAX_OCCURRENCES = 10000;

export function expandRepeats(layout: LayoutModel, data: DataObject): Result<LayoutModel> {
  try {
    const expanded = {
      ...layout,
      children: expandNodesScoped(layout.children, data, data),
      pages: layout.pages.map((page) => ({
        ...page,
        masterPageChildren: expandNodesScoped(page.masterPageChildren, data, data),
      })),
    };
    stampUids([expanded.children, ...expanded.pages.map((p) => p.masterPageChildren)]);
    return success(expanded);
  } catch (e) {
    return failure(ERROR_CODES.BINDING_FAILED.code, `Expand repeats failed: ${e}`);
  }
}

function resolveInScope(ref: string, scope: DataObject, root: DataObject): DataValue | undefined {
  return resolveXPathRelative(ref, scope) ?? resolveXPath(ref, root);
}

function expandNodesScoped(
  nodes: LayoutNode[],
  scope: DataObject,
  root: DataObject
): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const node of nodes) {
    if (node.type === 'subform') {
      result.push(...expandSubformScoped(node, scope, root));
    } else if (node.type === 'field') {
      const resolved =
        node.bindMatch === 'dataRef' && node.bindRef
          ? resolveInScope(node.bindRef, scope, root)
          : node.resolvedValue;
      result.push({ ...node, resolvedValue: resolved });
    } else {
      result.push({ ...node });
    }
  }
  return result;
}

function isRepeating(node: SubformNode): boolean {
  return node.occur?.max === -1 || (node.occur?.max !== undefined && node.occur.max > 1);
}

function expandSubformScoped(
  node: SubformNode,
  scope: DataObject,
  root: DataObject
): LayoutNode[] {
  if (isRepeating(node) && node.bindMatch === 'dataRef' && node.bindRef) {
    return expandRepeatingSubform(node, scope, root);
  }

  if (isRepeating(node)) {
    const expanded = expandByDescendantArray(node, scope, root);
    if (expanded) return expanded;
  }

  let childScope = scope;
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    const bound = resolveInScope(node.bindRef, scope, root);
    if (bound != null && typeof bound === 'object' && !Array.isArray(bound)) {
      childScope = bound as DataObject;
    }
  }

  return [{ ...node, children: expandNodesScoped(node.children, childScope, root) }];
}

function findArrayBinding(node: SubformNode): { bindRef: string; arrayRef: string } | undefined {
  for (const child of node.children) {
    if (child.type === 'field' && child.bindMatch === 'dataRef' && child.bindRef?.endsWith('[*]')) {
      return { bindRef: child.bindRef, arrayRef: child.bindRef.replace(/\[\*\]$/, '') };
    }
    if (child.type === 'subform') {
      if (isRepeating(child)) continue;
      const nested = findArrayBinding(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

function expandByDescendantArray(
  node: SubformNode,
  scope: DataObject,
  root: DataObject
): LayoutNode[] | undefined {
  const binding = findArrayBinding(node);
  if (!binding) return undefined;
  const arrayData = resolveInScope(binding.arrayRef, scope, root);
  if (!Array.isArray(arrayData)) return undefined;

  const limit = Math.min(arrayData.length, MAX_OCCURRENCES);
  const instances: SubformNode[] = [];
  for (let i = 0; i < limit; i++) {
    instances.push({
      ...node,
      occur: undefined,
      repeatIndex: i,
      children: applyArrayItem(
        expandNodesScoped(node.children, scope, root),
        binding.bindRef,
        arrayData[i]
      ),
    });
  }
  return instances;
}

function applyArrayItem(
  children: LayoutNode[],
  bindRef: string,
  value: DataValue
): LayoutNode[] {
  return children.map((child) => {
    if (child.type === 'field' && child.bindMatch === 'dataRef' && child.bindRef === bindRef) {
      return { ...child, resolvedValue: value } as LayoutNode;
    }
    if (child.type === 'subform') {
      return { ...child, children: applyArrayItem(child.children, bindRef, value) } as LayoutNode;
    }
    return { ...child } as LayoutNode;
  });
}

function expandRepeatingSubform(
  node: SubformNode,
  scope: DataObject,
  root: DataObject
): LayoutNode[] {
  const arrayRef = node.bindRef!.replace(/\[\*\]$/, '');
  const arrayData = resolveInScope(arrayRef, scope, root);

  if (!Array.isArray(arrayData)) {
    return [{ ...node, children: expandNodesScoped(node.children, scope, root) }];
  }

  const limit = Math.min(arrayData.length, MAX_OCCURRENCES);
  const instances: SubformNode[] = [];

  for (let i = 0; i < limit; i++) {
    const itemData = arrayData[i] as DataObject;
    instances.push({
      ...node,
      occur: undefined,
      bindRef: `${arrayRef}[${i}]`,
      repeatIndex: i,
      children: expandNodesScoped(node.children, itemData ?? {}, root),
    });
  }
  return instances;
}
