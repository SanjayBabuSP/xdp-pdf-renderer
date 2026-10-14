import { calculatePositions } from '../../../../src/domain/layout/calculate-positions';
import { LayoutModel, LayoutNode, SubformNode, FieldNode, Position } from '../../../../src/types';

const CA = { x: 54, y: 54, w: 487, h: 734 };

function model(children: LayoutNode[]): LayoutModel {
  return {
    rootSubformName: 'form',
    pages: [
      {
        name: 'Page1',
        medium: { stock: 'a4', short: 595.28, long: 841.89 },
        contentArea: { ...CA },
        masterPageChildren: [],
      },
    ],
    children,
  };
}

function field(name: string, position: Position): FieldNode {
  return { type: 'field', name, position };
}

function subform(name: string, layout: SubformNode['layout'], position: Position, children: LayoutNode[]): SubformNode {
  return { type: 'subform', name, layout, position, children };
}

function run(children: LayoutNode[]): LayoutNode[] {
  const result = calculatePositions(model(children));
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('layout failed');
  return result.data.children;
}

describe('layout engines (dispatcher)', () => {
  it('tb flow stacks children and sizes the container to content', () => {
    const out = run([
      subform('flow', 'tb', { x: 0, y: 0 }, [
        field('a', { x: 0, y: 0, w: 100, h: 20 }),
        field('b', { x: 0, y: 0, w: 100, h: 30 }),
      ]),
    ]);
    const flow = out[0] as SubformNode;
    expect(flow.position!.x).toBe(54);
    expect(flow.position!.y).toBe(54);
    expect(flow.children[0].position!.y).toBe(54);
    expect(flow.children[1].position!.y).toBe(74);
    expect(flow.position!.h).toBe(50);
  });

  it('lr flow places children side by side', () => {
    const out = run([
      subform('flow', 'lr', { x: 0, y: 0, h: 40 }, [
        field('a', { h: 40, w: 100 }),
        field('b', { h: 40, w: 150 }),
      ]),
    ]);
    const flow = out[0] as SubformNode;
    expect(flow.children[0].position!.x).toBe(54);
    expect(flow.children[1].position!.x).toBe(154);
    expect(flow.position!.w).toBe(487);
    expect(flow.position!.h).toBe(40);
  });

  it('rl-tb flow lines run right to left', () => {
    const out = run([
      subform('flow', 'rl-tb', { x: 0, y: 0 }, [
        field('a', { w: 100, h: 20 }),
        field('b', { w: 150, h: 20 }),
      ]),
    ]);
    const flow = out[0] as SubformNode;
    // First child hugs the right edge of the 487-wide box.
    expect(flow.children[0].position!.x).toBe(54 + 487 - 100);
    expect(flow.children[1].position!.x).toBe(54 + 487 - 100 - 150);
  });

  it('centers a fixed-width child per para.hAlign', () => {
    const f = field('a', { w: 100, h: 20 });
    f.para = { hAlign: 'center' };
    const out = run([subform('flow', 'tb', { x: 0, y: 0 }, [f])]);
    const flow = out[0] as SubformNode;
    expect(flow.children[0].position!.x).toBe(54 + (487 - 100) / 2);
  });

  it('stacks consecutive repeat instances in a position subform', () => {
    const out = run([
      subform('pos', 'position', { x: 0, y: 0 }, [
        { ...field('row', { x: 0, y: 10, w: 200, h: 30 }), repeatIndex: 0 },
        { ...field('row', { x: 0, y: 10, w: 200, h: 30 }), repeatIndex: 1 },
        { ...field('row', { x: 0, y: 10, w: 200, h: 30 }), repeatIndex: 2 },
      ]),
    ]);
    const pos = out[0] as SubformNode;
    expect(pos.children.map((c) => c.position!.y)).toEqual([64, 94, 124]);
    expect(pos.position!.h).toBe(100); // 10 + 3×30
  });

  it('table with colSpan cells splits columns by span occupancy', () => {
    const spanned = field('wide', { h: 20 });
    spanned.colSpan = 2;
    const out = run([
      subform('tbl', 'table', { x: 0, y: 0 }, [
        { ...subform('r1', 'row', { y: 0 }, [field('a', { h: 20 }), spanned]) } as SubformNode,
      ]),
    ]);
    const tbl = out[0] as SubformNode;
    const row = tbl.children[0] as SubformNode;
    // 3 column slots → 159 each: first cell 159, spanned cell 318.
    expect(row.children[0].position!.w).toBeCloseTo(487 / 3, 5);
    expect(row.children[1].position!.w).toBeCloseTo((487 / 3) * 2, 5);
    expect(tbl.position!.h).toBe(20);
  });

  it('table without columnWidths infers columns from authored cell widths', () => {
    // evidence: auto slots take max cell width (xfalayout_disasm.c:96505).
    const out = run([
      subform('tbl', 'table', { x: 0, y: 0 }, [
        subform('r1', 'row', { y: 0 }, [field('a', { h: 20, w: 100 }), field('b', { h: 20, w: 200 })]),
      ]),
    ]);
    const row = (out[0] as SubformNode).children[0] as SubformNode;
    expect(row.children[0].position!.x).toBe(54);
    expect(row.children[0].position!.w).toBe(100);
    expect(row.children[1].position!.x).toBe(154);
    expect(row.children[1].position!.w).toBe(200);
  });

  it('table auto column takes the max cell width across rows', () => {
    const out = run([
      subform('tbl', 'table', { x: 0, y: 0 }, [
        subform('r1', 'row', { y: 0 }, [field('a', { h: 20, w: 80 }), field('b', { h: 20, w: 120 })]),
        subform('r2', 'row', { y: 0 }, [field('c', { h: 20, w: 150 }), field('d', { h: 20, w: 90 })]),
      ]),
    ]);
    const rows = (out[0] as SubformNode).children as SubformNode[];
    // col0 = max(80, 150) = 150, col1 = max(120, 90) = 120: columns align
    // across rows while cells keep their authored widths.
    expect(rows[0].children[1].position!.x).toBe(54 + 150);
    expect(rows[1].children[1].position!.x).toBe(54 + 150);
    expect(rows[0].children[0].position!.w).toBe(80);
    expect(rows[1].children[0].position!.w).toBe(150);
  });

  it('table spanned auto cell contributes width/span per slot', () => {
    const spanned = field('wide', { h: 20, w: 200 });
    spanned.colSpan = 2;
    const out = run([
      subform('tbl', 'table', { x: 0, y: 0 }, [
        { ...subform('r1', 'row', { y: 0 }, [spanned]) } as SubformNode,
      ]),
    ]);
    const row = (out[0] as SubformNode).children[0] as SubformNode;
    expect(row.children[0].position!.w).toBe(200);
  });

  it('sizes a leaf field from content when h is absent (1.2× line)', () => {
    const out = run([field('a', { x: 0, y: 0, w: 100 })]);
    expect(out[0].position!.h).toBeCloseTo(12, 5);
    expect(out[0].position!.w).toBe(100);
  });

  it('clamps leaf field height by minH', () => {
    const out = run([field('a', { x: 0, y: 0, w: 100, minH: 40 })]);
    expect(out[0].position!.h).toBe(40);
  });
});
