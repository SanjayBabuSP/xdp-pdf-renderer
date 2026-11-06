import { Result, LayoutModel, LayoutNode, SubformNode, DataObject, DataValue } from '../../types';
import { success, failure } from '../../lib/result-type';
import { resolveXPath, resolveXPathRelative } from '../../lib/xpath-resolver';
import { ERROR_CODES } from '../../errors/error-codes';
import { stampUids } from '../../lib/node-uid';

const MAX_OCCURRENCES = 10000;

/**
 * Expand repeating subforms (occur.max > 1 / -1) into concrete instances.
 *
 * Data binding only — no geometry. Plan Phase 2 task 2: repeat instances are
 * positioned by the layout engines, never pre-offset from the template
 * (evidence: addInstances xfalayout_disasm.c:6028 inserts nodes; the engine
 * assigns x/y). Each instance carries `repeatIndex` (0-based) so the
 * position engine can stack consecutive occurrence instances of the same
 * name; flow/table engines stack them naturally via their cursors.
 *
 * DataRefs are resolved relative to the enclosing occurrence's data node
 * (the XFA data-scope rule used by resolve-bindings), with a document-root
 * fallback. This is required for nested arrays such as Example-2:
 * `Element_2663[*]` rows contain `Field_0147[*]` sub-rows.
 */
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
    // Expansion clones subtrees, which would otherwise leave duplicate ids.
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
      // Every occurrence needs its own leaf identity (draws, excl groups).
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

  // XFA also repeats `bind match="none"` subforms when a descendant field is
  // bound to an array (`<occur max="-1"/>` on the wrapper, `<field bind
  // ref="$.Items[*]"/>` inside). Designer emits this shape for repeating
  // paragraph blocks; the wrapper has no data node of its own.
  if (isRepeating(node)) {
    const expanded = expandByDescendantArray(node, scope, root);
    if (expanded) return expanded;
  }

  // A non-repeating data-bound subform establishes a data scope for children.
  let childScope = scope;
  if (node.bindMatch === 'dataRef' && node.bindRef) {
    const bound = resolveInScope(node.bindRef, scope, root);
    if (bound != null && typeof bound === 'object' && !Array.isArray(bound)) {
      childScope = bound as DataObject;
    }
  }

  return [{ ...node, children: expandNodesScoped(node.children, childScope, root) }];
}

/** Find the first direct/descendant field whose dataRef ends in `[*]`. */
function findArrayBinding(node: SubformNode): { bindRef: string; arrayRef: string } | undefined {
  for (const child of node.children) {
    if (child.type === 'field' && child.bindMatch === 'dataRef' && child.bindRef?.endsWith('[*]')) {
      return { bindRef: child.bindRef, arrayRef: child.bindRef.replace(/\[\*\]$/, '') };
    }
    if (child.type === 'subform') {
      // Stop at an inner repeating subform: that subform owns its own repeat,
      // and expanding the outer wrapper too would duplicate headings/static
      // children (Example-2 Subform_0089 heading + Subform_0090/0091 rows).
      if (isRepeating(child)) continue;
      const nested = findArrayBinding(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Repeat a wrapper subform once per item of a descendant field's bound array.
 * The matching descendant receives that array item as its resolved value.
 */
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
      occur: undefined, // Resolved — no longer repeating
      bindRef: `${arrayRef}[${i}]`,
      repeatIndex: i,
      children: expandNodesScoped(node.children, itemData ?? {}, root),
    });
  }
  return instances;
}
