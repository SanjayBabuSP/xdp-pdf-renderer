import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, DataObject } from '../../types';
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
  return node;
}

function resolveSubform(node: SubformNode, data: DataObject): SubformNode {
  return {
    ...node,
    children: resolveNodes(node.children, data),
  };
}

function resolveField(node: FieldNode, data: DataObject): FieldNode {
  if (node.bindMatch !== 'dataRef' || !node.bindRef) return node;
  const resolved = resolveXPath(node.bindRef, data);
  return { ...node, resolvedValue: resolved };
}

function resolveDraw(node: DrawNode, data: DataObject): DrawNode {
  // Draws are typically static; only resolve if they have a bind ref (rare)
  return node;
}

function deepCloneLayout(layout: LayoutModel): LayoutModel {
  return JSON.parse(JSON.stringify(layout));
}
