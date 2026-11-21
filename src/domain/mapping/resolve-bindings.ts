import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, DataObject } from '../../types';
import { success, failure } from '../../lib/result-type';
import { resolveXPath, resolveXPathRelative } from '../../lib/xpath-resolver';
import { ERROR_CODES } from '../../errors/error-codes';

export function resolveBindings(layout: LayoutModel, data: DataObject): Result<LayoutModel> {
  try {
    const cloned = deepCloneLayout(layout);
    cloned.children = resolveNodes(cloned.children, data, data);
    cloned.pages = cloned.pages.map((page) => ({
      ...page,
      masterPageChildren: resolveNodes(page.masterPageChildren, data, data),
    }));
    return success(cloned);
  } catch (e) {
    return failure(ERROR_CODES.BINDING_FAILED.code, `${ERROR_CODES.BINDING_FAILED.message}: ${e}`);
  }
}

function resolveNodes(nodes: LayoutNode[], data: DataObject, scope: DataObject): LayoutNode[] {
  return nodes.map((node) => resolveNode(node, data, scope));
}

function resolveNode(node: LayoutNode, data: DataObject, scope: DataObject): LayoutNode {
  if (node.type === 'subform') return resolveSubform(node, data, scope);
  if (node.type === 'field') return resolveField(node, data, scope);
  if (node.type === 'draw') return resolveDraw(node, data);
  if (node.type === 'exclGroup') return resolveExclGroup(node, data, scope);
  return node;
}

function resolveRef(ref: string, data: DataObject, scope: DataObject): unknown {
  const scoped = scope !== data ? resolveXPathRelative(ref, scope) : undefined;
  return scoped !== undefined ? scoped : resolveXPath(ref, data);
}

function isDataScope(value: unknown): value is DataObject {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function resolveSubform(node: SubformNode, data: DataObject, scope: DataObject): SubformNode {
  let childScope = scope;
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    const resolved = resolveRef(node.bindRef, data, scope);
    if (isDataScope(resolved)) childScope = resolved;
  }
  return {
    ...node,
    children: resolveNodes(node.children, data, childScope),
  };
}

function resolveField(node: FieldNode, data: DataObject, scope: DataObject): FieldNode {
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    const resolved = resolveRef(node.bindRef, data, scope);
    if (resolved !== undefined) {
      return { ...node, resolvedValue: resolved };
    }
    if (node.defaultValue !== undefined) {
      return { ...node, resolvedValue: node.defaultValue };
    }
    return { ...node, resolvedValue: resolved };
  }
  if (node.defaultValue !== undefined && node.resolvedValue === undefined) {
    return { ...node, resolvedValue: node.defaultValue };
  }
  return node;
}

function resolveDraw(node: DrawNode, data: DataObject): DrawNode {
  return node;
}

function resolveExclGroup(node: ExclGroupNode, data: DataObject, scope: DataObject): ExclGroupNode {
  let childScope = scope;
  let resolvedValue: unknown;
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    resolvedValue = resolveRef(node.bindRef, data, scope);
    if (isDataScope(resolvedValue)) childScope = resolvedValue;
  }
  const resolvedChildren = resolveNodes(node.children, data, childScope);
  if (resolvedValue !== undefined) {
    return { ...node, children: resolvedChildren, resolvedValue };
  }
  return { ...node, children: resolvedChildren };
}

function deepCloneLayout(layout: LayoutModel): LayoutModel {
  return JSON.parse(JSON.stringify(layout));
}
