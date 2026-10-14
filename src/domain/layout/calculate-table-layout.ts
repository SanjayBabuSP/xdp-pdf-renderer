import { Result, LayoutModel, LayoutNode, SubformNode } from '../../types';
import { success } from '../../lib/result-type';

interface TableLayout {
  columnWidths: number[];
  totalWidth: number;
}

/**
 * Resolve table column widths.
 *
 * evidence (xfalayout_disasm.c):
 * - FUN_1857b5c0 (:97860) parses the `columnWidths` attr (0x1d8)
 *   space-tokenized; `-1`/non-positive tokens are stored as the auto marker.
 * - FUN_18579cd0 (:96505) resolves each auto slot as the MAX over rows of
 *   the covering cell's nominal (authored) width divided by its colSpan
 *   (attr 0x1d7), warning 0x72fb when nothing resolves.
 *
 * ponytail: how leftover width is shared (fixed sum ≠ table width) is not
 * evidenced — unresolved slots split the remainder equally, and a fully
 * unresolved table splits the full width (previous behaviour). Ceiling:
 * Adobe may stretch or leave trailing space differently; upgrade path is a
 * Designer oracle with mixed fixed/auto columns.
 */
export function calculateTableLayout(node: SubformNode, availableWidth: number): TableLayout {
  const colCount = Math.max(inferColumnCount(node), node.columnWidths?.length ?? 0, 1);

  // Seed from the authored attribute: fixed stay, -1/missing become auto.
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

/** Authored width of a cell (nominal extent), or undefined when unset. */
function cellWidth(cell: LayoutNode): number | undefined {
  const w =
    cell.type === 'field' || cell.type === 'draw' || cell.type === 'subform'
      ? cell.position?.w
      : undefined;
  return w != null && w > 0 ? w : undefined;
}

function cellSpan(cell: LayoutNode): number {
  if (cell.type === 'field') return Math.max(1, cell.colSpan ?? 1);
  return 1;
}

/**
 * Fill auto (-1) slots with the max covering-cell width/span across rows.
 * A spanned cell contributes its width/span to every slot it covers.
 */
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
          // Fixed authored widths always win; only auto slots resolve.
          if (isAuto[j] && w / span > widths[j]) widths[j] = w / span;
        }
      }
      col += span;
    }
  }
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
