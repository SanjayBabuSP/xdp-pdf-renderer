import { layoutTableSubform } from '../../../../src/domain/layout/table-engine';
import { ChildLayouter, LayoutContext } from '../../../../src/domain/layout/engine-types';
import { DrawNode, FieldNode, LayoutNode, Position, SubformNode } from '../../../../src/types';

function field(name: string, position?: Position): FieldNode {
  return { type: 'field', name, position };
}

function drawNode(name: string, value: DrawNode['value']): DrawNode {
  return { type: 'draw', name, value };
}

function subform(
  name: string,
  layout: SubformNode['layout'],
  children: LayoutNode[],
  position: Position = {},
  extra: Partial<SubformNode> = {}
): SubformNode {
  return { type: 'subform', name, layout, children, position, ...extra };
}

function context(overrides: Partial<LayoutContext> = {}): LayoutContext {
  return { x: 0, y: 0, availableWidth: 200, ...overrides };
}

function recording(heights: Record<string, number>): ChildLayouter {
  return (node, ctx) => ({
    node: { ...node, position: { ...node.position, x: ctx.x, y: ctx.y, w: ctx.availableWidth } },
    height: heights[node.name ?? ''] ?? 10,
  });
}

describe('layoutTableSubform', () => {
  it('lays out rows using shared column widths and the tallest cell', () => {
    const table = subform(
      'tbl',
      'table',
      [
        subform('r1', 'row', [field('a', { h: 10 }), field('b', { h: 10 })]),
        subform('r2', 'rl-row', [field('c', { h: 10 }), field('d', { h: 10 })]),
      ],
      { x: 1, y: 2, w: 200 },
      { columnWidths: [100, 100] }
    );
    const result = layoutTableSubform(table, context(), recording({ a: 10, b: 15, c: 8, d: 12 }));
    const rows = (result.node as SubformNode).children as SubformNode[];
    expect(result.node.position).toEqual({ x: 0, y: 0, w: 200, h: 27 });
    expect(rows[0].position).toEqual({ x: 0, y: 0, w: 200, h: 15 });
    expect(rows[1].position).toEqual({ x: 0, y: 15, w: 200, h: 12 });
    expect(rows[0].children.map((cell) => cell.position)).toEqual([
      { h: 15, x: 0, y: 0, w: 100 },
      { h: 15, x: 100, y: 0, w: 100 },
    ]);
    expect(rows[1].children.map((cell) => cell.position)).toEqual([
      { h: 12, x: 100, y: 15, w: 100 },
      { h: 12, x: 0, y: 15, w: 100 },
    ]);
  });

  it('gives a spanning cell the sum of its columns', () => {
    const spanned = field('wide', { h: 10 });
    spanned.colSpan = 2;
    const table = subform(
      'tbl',
      'table',
      [subform('r', 'row', [spanned])],
      { w: 300 },
      {
        columnWidths: [100, 100],
      }
    );
    const result = layoutTableSubform(table, context(), recording({ wide: 10 }));
    const row = (result.node as SubformNode).children[0] as SubformNode;
    expect(row.position?.w).toBe(200);
    expect(row.children[0].position?.w).toBe(200);
  });

  it('applies minH to a field cell with a zero height', () => {
    const table = subform(
      'tbl',
      'table',
      [subform('r', 'row', [field('m', { h: 0, minH: 30 })])],
      { w: 200 },
      { columnWidths: [200] }
    );
    const result = layoutTableSubform(table, context(), recording({ m: 10 }));
    expect(result.height).toBeCloseTo(30, 3);
    const row = (result.node as SubformNode).children[0] as SubformNode;
    expect(row.children[0].position?.h).toBeCloseTo(30, 3);
  });

  it('lays out rows inside a subform set', () => {
    const set = subform(
      'set',
      'position',
      [subform('r', 'row', [field('a', { h: 10 })])],
      {},
      {
        isSubformSet: true,
      }
    );
    const table = subform('tbl', 'table', [set], { w: 200 }, { columnWidths: [200] });
    const result = layoutTableSubform(table, context(), recording({ a: 10 }));
    const laidSet = (result.node as SubformNode).children[0] as SubformNode;
    const row = laidSet.children[0] as SubformNode;
    expect(laidSet.position).toEqual({ x: 0, y: 0, w: 200, h: 10 });
    expect(row.position).toEqual({ x: 0, y: 0, w: 200, h: 10 });
    expect(row.children[0].position?.w).toBe(200);
  });

  it('lays out non-row children at the current table offset', () => {
    const table = subform('tbl', 'table', [field('f')], { w: 200 }, { columnWidths: [200] });
    const result = layoutTableSubform(table, context({ x: 3, y: 4 }), recording({ f: 9 }));
    expect(result.node.position).toEqual({ x: 3, y: 4, w: 200, h: 9 });
    expect((result.node as SubformNode).children[0].position).toEqual({ x: 3, y: 4, w: 200 });
  });

  it('accounts for table insets and rows with only empty draws', () => {
    const table = subform(
      'tbl',
      'table',
      [
        subform('r1', 'row', [
          drawNode('empty', { type: 'text', content: '' }),
          drawNode('text', { type: 'text', content: 'Hi' }),
        ]),
      ],
      { w: 300 },
      {
        columnWidths: [100, 200],
        margin: { leftInset: 10, rightInset: 20, topInset: 5, bottomInset: 6 },
      }
    );
    const result = layoutTableSubform(table, context(), recording({ empty: 5, text: 12 }));
    const row = (result.node as SubformNode).children[0] as SubformNode;
    expect(result.node.position).toEqual({ x: 0, y: 0, w: 300, h: 23 });
    expect(row.position).toEqual({ x: 10, y: 5, w: 300, h: 12 });
    expect(row.children.map((cell) => cell.position?.w)).toEqual([100, 200]);
  });

  it('infers column widths from authored cell widths when none are supplied', () => {
    const table = subform('tbl', 'table', [
      subform('r', 'row', [field('a', { w: 60, h: 10 }), field('b', { w: 80, h: 10 })]),
    ]);
    const result = layoutTableSubform(table, context(), recording({ a: 10, b: 10 }));
    const row = (result.node as SubformNode).children[0] as SubformNode;
    expect(row.children.map((cell) => cell.position?.w)).toEqual([60, 80]);
    expect(row.children.map((cell) => cell.position?.x)).toEqual([0, 60]);
  });
});
