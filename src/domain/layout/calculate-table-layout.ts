import { Result, LayoutModel, LayoutNode, SubformNode } from '../../types';
import { success } from '../../lib/result-type';

interface TableLayout {
  columnWidths: number[];
  totalWidth: number;
}

export function calculateTableLayout(node: SubformNode, availableWidth: number): TableLayout {
  const colCount = Math.max(inferColumnCount(node), node.columnWidths?.length ?? 0, 1);

  const widths: number[] = [];
  const isAuto: boolean[] = [];
  for (let i = 0; i < colCount; i++) {
    const authored = node.columnWidths?.[i];
    const fixed = authored != null && authored > 0;
    widths.push(fixed ? authored : -1);
    isAuto.push(!fixed);
  }

  resolveAutoColumns(node, widths, isAuto);

  const unresolved = widths.reduce((n, w) => n + (w <= 0 ? 1 : 0), 0);
  if (unresolved > 0) {
    const fixedSum = widths.reduce((sum, w) => sum + Math.max(w, 0), 0);
    const share = Math.max(availableWidth - fixedSum, 0) / unresolved;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] <= 0) widths[i] = share;
    }
  }

  return { columnWidths: widths, totalWidth: widths.reduce((a, b) => a + b, 0) };
}

function cellWidth(cell: LayoutNode): number | undefined {
  const w =
    cell.type === 'field' || cell.type === 'draw' || cell.type === 'subform'
      ? cell.position?.w
      : undefined;
  return w != null && w > 0 ? w : undefined;
}

function cellSpan(cell: LayoutNode): number {
  const span = (cell as { colSpan?: number }).colSpan;
  return Math.max(1, span ?? 1);
}

function resolveAutoColumns(node: SubformNode, widths: number[], isAuto: boolean[]): void {
  for (const child of node.children) {
    if (child.type !== 'subform' || (child.layout !== 'row' && child.layout !== 'rl-row')) continue;
    const cells = child.layout === 'rl-row' ? [...child.children].reverse() : child.children;
    let col = 0;
    for (const cell of cells) {
      const span = cellSpan(cell);
      const w = cellWidth(cell);
      if (w != null) {
        for (let j = col; j < col + span && j < widths.length; j++) {
          if (isAuto[j] && w / span > widths[j]) widths[j] = w / span;
        }
      }
      col += span;
    }
  }
}

function inferColumnCount(node: SubformNode): number {
  let max = 0;
  for (const child of node.children) {
    if (child.type !== 'subform' || (child.layout !== 'row' && child.layout !== 'rl-row')) continue;
    let sum = 0;
    for (const cell of child.children) {
      sum += Math.max(1, (cell as { colSpan?: number }).colSpan ?? 1);
    }
    if (sum > max) max = sum;
  }
  return max;
}

export function applyTableLayouts(
  layout: LayoutModel,
  availableWidth: number
): Result<LayoutModel> {
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
