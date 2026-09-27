import { Result, LayoutModel, LayoutNode, SubformNode } from '../../types';
import { success } from '../../lib/result-type';

interface TableLayout {
  columnWidths: number[];
  totalWidth: number;
}

/** Resolve table column widths from columnWidths attribute or distribute evenly. */
export function calculateTableLayout(node: SubformNode, availableWidth: number): TableLayout {
  if (node.columnWidths && node.columnWidths.length > 0) {
    return {
      columnWidths: node.columnWidths,
      totalWidth: node.columnWidths.reduce((a, b) => a + b, 0),
    };
  }

  const colCount = inferColumnCount(node);
  if (colCount === 0) return { columnWidths: [], totalWidth: 0 };

  const colWidth = availableWidth / colCount;
  return {
    columnWidths: Array(colCount).fill(colWidth),
    totalWidth: availableWidth,
  };
}

/**
 * Column count = the max sum of colSpans across rows (colSpan-aware
 * occupancy — evidence: occupancy/tracking in xfalayout_disasm.c table
 * layout; a cell with colSpan="2" occupies two column slots).
 */
function inferColumnCount(node: SubformNode): number {
  let max = 0;
  for (const child of node.children) {
    if (child.type !== 'subform' || (child.layout !== 'row' && child.layout !== 'rl-row')) continue;
    let sum = 0;
    for (const cell of child.children) {
      sum += cell.type === 'field' ? Math.max(1, cell.colSpan ?? 1) : 1;
    }
    if (sum > max) max = sum;
  }
  return max;
}

/** Apply table layout computation across all table subforms in the layout. */
export function applyTableLayouts(layout: LayoutModel, availableWidth: number): Result<LayoutModel> {
  const updated = {
    ...layout,
    children: applyToNodes(layout.children, availableWidth),
  };
  return success(updated);
}

function applyToNodes(nodes: LayoutNode[], availableWidth: number): LayoutNode[] {
  return nodes.map((node) => {
    if (node.type !== 'subform') return node;
    if (node.layout === 'table') {
      const tableLayout = calculateTableLayout(node, availableWidth);
      return {
        ...node,
        columnWidths: tableLayout.columnWidths,
        children: applyToNodes(node.children, availableWidth),
      } as SubformNode;
    }
    return { ...node, children: applyToNodes(node.children, availableWidth) } as SubformNode;
  });
}
