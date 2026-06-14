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

function inferColumnCount(node: SubformNode): number {
  for (const child of node.children) {
    if (child.type === 'subform' && child.layout === 'row') {
      return child.children.length;
    }
  }
  return 0;
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
