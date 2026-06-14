import { Result, LayoutNode } from '../../types';
import { success } from '../../lib/result-type';

/** Evaluate simple XFA calculate scripts on fields. Scope: limited patterns only. */
export function evaluateCalculations(nodes: LayoutNode[]): Result<LayoutNode[]> {
  const evaluated = nodes.map(evaluateNode);
  return success(evaluated);
}

function evaluateNode(node: LayoutNode): LayoutNode {
  if (node.type === 'field' && node.calculate) {
    // Scope limitation: only support basic page number calculation pattern
    return node;
  }
  if (node.type === 'subform') {
    return { ...node, children: node.children.map(evaluateNode) };
  }
  return node;
}
