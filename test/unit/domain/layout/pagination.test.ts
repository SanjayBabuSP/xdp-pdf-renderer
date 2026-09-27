import { applyPagination } from '../../../../src/domain/layout/apply-pagination';
import { LayoutModel, LayoutNode, SubformNode, FieldNode, Position } from '../../../../src/types';

const CA = { x: 54, y: 54, w: 487, h: 734 };
const BOUNDARY = 788; // CA.y + CA.h — start of flow page 1

function model(children: LayoutNode[], templateCount = 1): LayoutModel {
  const templates = Array.from({ length: templateCount }, (_, i) => ({
    name: `Page${i + 1}`,
    medium: { stock: 'a4', short: 595.28, long: 841.89 },
    contentArea: { ...CA },
    masterPageChildren: [{ type: 'draw' as const, name: `master${i}`, position: { x: 1, y: 2, w: 3, h: 4 } }],
  }));
  return { rootSubformName: 'form', pages: templates, children };
}

function field(name: string, position: Position): FieldNode {
  return { type: 'field', name, position };
}

function subform(name: string, position: Position, children: LayoutNode[] = []): SubformNode {
  return { type: 'subform', name, layout: 'position', position, children };
}

function run(children: LayoutNode[], templateCount = 1) {
  const result = applyPagination(model(children, templateCount));
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('pagination failed');
  return result.data;
}

describe('applyPagination (coordinate-based)', () => {
  it('keeps content that fits on a single page untouched', () => {
    const out = run([subform('s', { x: 54, y: 100, w: 200, h: 50 })]);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children[0].position).toMatchObject({ x: 54, y: 100, w: 200, h: 50 });
  });

  it('splits a straddling container into per-page fragments anchored at each content area', () => {
    const out = run([
      subform('tall', { x: 54, y: 700, w: 200, h: 1000 }, [
        field('a', { x: 54, y: 760, w: 100, h: 20 }),
        field('b', { x: 54, y: 800, w: 100, h: 20 }),
      ]),
    ]);
    expect(out.pages).toHaveLength(3);

    const p0 = out.pages[0].children[0] as SubformNode;
    expect(p0.position!.y).toBe(700);
    expect(p0.position!.h).toBe(88); // clipped at 788
    expect(p0.children.map((c) => c.position!.y)).toEqual([760]);

    const p1 = out.pages[1].children[0] as SubformNode;
    expect(p1.position!.y).toBe(54); // translated by −734
    expect(p1.position!.h).toBe(734);
    expect(p1.children.map((c) => c.position!.y)).toEqual([66]); // 800 − 734

    const p2 = out.pages[2].children[0] as SubformNode;
    expect(p2.position!.y).toBe(54);
    expect(p2.position!.h).toBe(178); // 1700 − 1522
  });

  it('rebase breakBefore to the next content-area top', () => {
    const out = run([
      subform('first', { x: 54, y: 54, w: 100, h: 10 }),
      { ...subform('second', { x: 54, y: 64, w: 100, h: 20 }), breakBefore: 'contentArea' },
    ]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[1].children[0].position!.y).toBe(54);
    expect(out.pages[1].contentArea).toMatchObject(CA);
  });

  it('treats breakBefore on the very first node as a no-op', () => {
    const out = run([{ ...subform('first', { x: 54, y: 54, w: 100, h: 10 }), breakBefore: 'contentArea' }]);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children[0].position!.y).toBe(54);
  });

  it('moves a straddling leaf whole to the next page top (atomic unit)', () => {
    const out = run([field('f', { x: 54, y: 760, w: 100, h: 50 })]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0].children).toHaveLength(0);
    expect(out.pages[1].children[0].position!.y).toBe(54);
  });

  it('honors explicit keep: unit-shifts a kept subform instead of splitting', () => {
    const out = run([
      { ...subform('kept', { x: 54, y: 760, w: 200, h: 100 }), keep: { contentArea: 'contentArea' } },
    ]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[1].children[0].position).toMatchObject({ x: 54, y: 54, h: 100 });
  });

  it('prunes and clips non-kept containers across the page boundary', () => {
    const out = run([
      subform('box', { x: 54, y: 760, w: 200, h: 70 }, [
        field('a', { x: 54, y: 760, w: 100, h: 20 }),
        subform('b', { x: 54, y: 780, w: 100, h: 50 }),
      ]),
    ]);
    expect(out.pages).toHaveLength(2);

    const p0 = out.pages[0].children[0] as SubformNode;
    expect(p0.position!.h).toBe(28); // clipped at 788
    expect(p0.children.map((c) => [c.position!.y, c.position!.h])).toEqual([
      [760, 20],
      [780, 8],
    ]);

    const p1 = out.pages[1].children[0] as SubformNode;
    expect(p1.position).toMatchObject({ y: 54, h: 42 });
    expect(p1.children.map((c) => [c.position!.y, c.position!.h])).toEqual([[54, 42]]);
  });

  it('breakAfter pushes the following sibling to the next chunk', () => {
    const out = run([
      { ...subform('a', { x: 54, y: 54, w: 100, h: 10 }), breakAfter: 'contentArea' },
      subform('b', { x: 54, y: 64, w: 100, h: 20 }),
    ]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[1].children[0].position!.y).toBe(54);
  });

  it('breakBefore=pageOdd skips to the next odd (1-based) page', () => {
    const out = run([
      subform('first', { x: 54, y: 54, w: 100, h: 10 }),
      { ...subform('second', { x: 54, y: 64, w: 100, h: 20 }), breakBefore: 'pageOdd' },
    ]);
    // pageOdd → flow page index 2 (physical page 3): y = 54 + 2·734
    expect(out.pages.length).toBeGreaterThanOrEqual(3);
    expect(out.pages[2].children[0].position!.y).toBe(54);
  });

  it('cycles page templates and their master-page content across pages', () => {
    const out = run([subform('tall', { x: 54, y: 700, w: 200, h: 1000 })], 2);
    expect(out.pages).toHaveLength(3);
    expect(out.pages[1].masterPageChildren[0].name).toBe('master1');
    expect(out.pages[2].masterPageChildren[0].name).toBe('master0');
  });

  it('translates page content into a differing content-area origin', () => {
    const m = model([subform('tall', { x: 54, y: 700, w: 200, h: 200 })], 2);
    m.pages[1] = { ...m.pages[1], contentArea: { x: 40, y: 40, w: 487, h: 734 } };
    const out = applyPagination(m);
    expect(out.success).toBe(true);
    if (!out.success) return;
    const frag = out.data.pages[1].children[0];
    // t_1 = (40−54, 40−54−734) = (−14, −748): y 788→40, x 54→40.
    expect(frag.position!.x).toBe(40);
    expect(frag.position!.y).toBe(40);
  });

  it('produces a single page for empty content', () => {
    const out = run([]);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children).toEqual([]);
  });
});
