import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, DataObject } from '../../types';
import { success, failure } from '../../lib/result-type';
import { resolveXPath } from '../../lib/xpath-resolver';
import { ERROR_CODES } from '../../errors/error-codes';

/** Deep-clone the layout model and attach resolvedValue to each data-bound field. */
export function resolveBindings(layout: LayoutModel, data: DataObject): Result<LayoutModel> {
  try {
    const cloned = deepCloneLayout(layout);
    cloned.children = resolveNodes(cloned.children, data);
    cloned.pages = cloned.pages.map((page) => ({
      ...page,
      masterPageChildren: resolveNodes(page.masterPageChildren, data),
    }));
    return success(cloned);
  } catch (e) {
    return failure(ERROR_CODES.BINDING_FAILED.code, `${ERROR_CODES.BINDING_FAILED.message}: ${e}`);
  }
}

function resolveNodes(nodes: LayoutNode[], data: DataObject): LayoutNode[] {
  return nodes.map((node) => resolveNode(node, data));
}

function resolveNode(node: LayoutNode, data: DataObject): LayoutNode {
  if (node.type === 'subform') return resolveSubform(node, data);
  if (node.type === 'field') return resolveField(node, data);
  if (node.type === 'draw') return resolveDraw(node, data);
  if (node.type === 'exclGroup') return resolveExclGroup(node, data);
  return node;
}

function resolveSubform(node: SubformNode, data: DataObject): SubformNode {
  return {
    ...node,
    children: resolveNodes(node.children, data),
  };
}

function resolveField(node: FieldNode, data: DataObject): FieldNode {
  // If data-bound, resolve from data
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    const resolved = resolveXPath(node.bindRef, data);
    if (resolved !== undefined) {
      return { ...node, resolvedValue: resolved };
    }
    // If binding failed but there's a defaultValue, use it
    if (node.defaultValue !== undefined) {
      return { ...node, resolvedValue: node.defaultValue };
    }
    return { ...node, resolvedValue: resolved };
  }
  // If no binding, use defaultValue if available
  if (node.defaultValue !== undefined && node.resolvedValue === undefined) {
    return { ...node, resolvedValue: node.defaultValue };
  }
  return node;
}

function resolveDraw(node: DrawNode, data: DataObject): DrawNode {
  // Draws are typically static; only resolve if they have a bind ref (rare)
  return node;
}

function resolveExclGroup(node: ExclGroupNode, data: DataObject): ExclGroupNode {
  const resolvedChildren = node.children.map((child) => resolveField(child, data));
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    const resolved = resolveXPath(node.bindRef, data);
    return { ...node, children: resolvedChildren, resolvedValue: resolved };
  }
  return { ...node, children: resolvedChildren };
}

function deepCloneLayout(layout: LayoutModel): LayoutModel {
  return JSON.parse(JSON.stringify(layout));
}
