import { applyPagination } from '../../../../src/domain/layout/apply-pagination';
import {
  BreakValue,
  LayoutModel,
  LayoutNode,
  SubformNode,
  FieldNode,
  DrawNode,
  Position,
} from '../../../../src/types';

const CA = { x: 54, y: 54, w: 487, h: 734 };
const BOUNDARY = 788;

function model(children: LayoutNode[], templateCount = 1): LayoutModel {
  const templates = Array.from({ length: templateCount }, (_, i) => ({
    name: `Page${i + 1}`,
    medium: { stock: 'a4', short: 595.28, long: 841.89 },
    contentArea: { ...CA },
    masterPageChildren: [
      { type: 'draw' as const, name: `master${i}`, position: { x: 1, y: 2, w: 3, h: 4 } },
    ],
  }));
  return { rootSubformName: 'form', pages: templates, children };
}

function field(name: string, position: Position): FieldNode {
  return { type: 'field', name, position };
}

function subform(name: string, position: Position, children: LayoutNode[] = []): SubformNode {
  return { type: 'subform', name, layout: 'position', position, children };
}

function rule(name: string, position: Position, thickness = 1): DrawNode {
  return {
    type: 'draw',
    name,
    value: { type: 'rectangle' },
    border: { edges: [{ thickness }] },
    position,
  };
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
    expect(p0.position!.h).toBe(88);
    expect(p0.children.map((c) => c.position!.y)).toEqual([760]);

    const p1 = out.pages[1].children[0] as SubformNode;
    expect(p1.position!.y).toBe(54);
    expect(p1.position!.h).toBe(734);
    expect(p1.children.map((c) => c.position!.y)).toEqual([66]);

    const p2 = out.pages[2].children[0] as SubformNode;
    expect(p2.position!.y).toBe(54);
    expect(p2.position!.h).toBe(178);
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
    const out = run([
      { ...subform('first', { x: 54, y: 54, w: 100, h: 10 }), breakBefore: 'contentArea' },
    ]);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children[0].position!.y).toBe(54);
  });

  it('moves a straddling leaf whole to the next page top (atomic unit)', () => {
    const out = run([field('f', { x: 54, y: 760, w: 100, h: 50 })]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0].children).toHaveLength(0);
    expect(out.pages[1].children[0].position!.y).toBe(54);
  });

  it('moves a straddling table that fits on a page whole instead of splitting its rows', () => {
    const table: SubformNode = {
      type: 'subform',
      name: 'tbl',
      layout: 'table',
      position: { x: 54, y: 740, w: 200, h: 60 },
      children: [
        {
          type: 'subform',
          name: 'header',
          layout: 'row',
          position: { x: 54, y: 740, w: 200, h: 20 },
          children: [{ type: 'draw', name: 'h', position: { x: 54, y: 740, w: 200, h: 20 } }],
        },
        {
          type: 'subform',
          name: 'data',
          layout: 'row',
          position: { x: 54, y: 760, w: 200, h: 40 },
          children: [field('v', { x: 54, y: 760, w: 100, h: 40 })],
        },
      ],
    };
    const out = run([table]);
    expect(out.pages).toHaveLength(2);
    expect(out.pages[0].children).toHaveLength(0);
    const moved = out.pages[1].children[0] as SubformNode;
    expect(moved.name).toBe('tbl');
    expect(moved.position).toMatchObject({ y: 54, h: 60 });
    expect(moved.children.map((r) => (r as SubformNode).name)).toEqual(['header', 'data']);
    const dataRow = moved.children[1] as SubformNode;
    expect(dataRow.position).toMatchObject({ y: 74, h: 40 });
    expect(dataRow.children).toHaveLength(1);
  });

  it('honors explicit keep: unit-shifts a kept subform instead of splitting', () => {
    const out = run([
      {
        ...subform('kept', { x: 54, y: 760, w: 200, h: 100 }),
        keep: { contentArea: 'contentArea' },
      },
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
    expect(p0.position!.h).toBe(28);
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
    expect(frag.position!.x).toBe(40);
    expect(frag.position!.y).toBe(40);
  });

  it('produces a single page for empty content', () => {
    const out = run([]);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0].children).toEqual([]);
  });

  it('preserves a trailing breakBefore section as its own last page', () => {
    const out = run([
      subform('body', { x: 54, y: 54, w: 200, h: 5 * 734 }),
      {
        ...subform('revision', { x: 54, y: 54 + 5 * 734, w: 200, h: 30 }),
        breakBefore: 'contentArea',
      },
    ]);
    expect(out.pages).toHaveLength(6);
    const last = out.pages[5].children[0] as SubformNode;
    expect(last.name).toBe('revision');
    expect(last.position!.y).toBe(54);
  });

  it('breakBefore=pageFront advances to the next front (odd 1-based) page', () => {
    const out = run([
      subform('first', { x: 54, y: 54, w: 100, h: 10 }),
      { ...subform('second', { x: 54, y: 64, w: 100, h: 20 }), breakBefore: 'pageFront' },
    ]);
    expect(out.pages).toHaveLength(3);
    const second = out.pages[2].children[0] as SubformNode;
    expect(second.name).toBe('second');
    expect(second.position!.y).toBe(54);
  });

  function layeredModel(breakBefore: BreakValue): LayoutModel {
    return {
      rootSubformName: 'form',
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 200, long: 1000 },
          contentArea: { x: 0, y: 0, w: 200, h: 200 },
          masterPageChildren: [],
        },
      ],
      children: [
        subform('first', { x: 0, y: 0, w: 100, h: 10 }),
        { ...subform('second', { x: 0, y: 20, w: 100, h: 10 }), breakBefore },
      ],
    };
  }

  it('contentArea break advances within the physical page when it has multiple content areas', () => {
    const result = applyPagination(layeredModel('contentArea'), 1000);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(1);
    const second = result.data.pages[0].children[1] as SubformNode;
    expect(second.name).toBe('second');
    expect(second.position!.y).toBe(200);
  });

  it('pageArea break advances to the next physical page', () => {
    const result = applyPagination(layeredModel('pageArea'), 1000);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    const second = result.data.pages[1].children[0] as SubformNode;
    expect(second.name).toBe('second');
    expect(second.position!.y).toBe(0);
  });

  it('uses options.pageHeight for bands when it differs from medium and content area', () => {
    const layout = model([
      subform('straddler', { x: 54, y: 290, w: 200, h: 40 }, [
        field('inner', { x: 54, y: 290, w: 100, h: 40 }),
      ]),
    ]);
    const result = applyPagination(layout, 250);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    const p0 = result.data.pages[0].children[0] as SubformNode;
    const p1 = result.data.pages[1].children[0] as SubformNode;
    expect(p0.position!.h).toBe(14);
    expect(p1.position!.y).toBe(54);
    expect(p1.position!.h).toBe(26);
  });

  it('moves a kept row inside a repeat instance wholly to the next page', () => {
    const out = run([
      {
        ...subform('repeat', { x: 54, y: BOUNDARY - 20, w: 200, h: 40 }, [
          {
            ...subform('keptRow', { x: 54, y: BOUNDARY - 20, w: 200, h: 40 }, [
              field('cell', { x: 54, y: BOUNDARY - 20, w: 100, h: 40 }),
            ]),
            keep: { intact: 'contentArea' },
          },
        ]),
        repeatIndex: 0,
      },
    ]);

    expect(out.pages).toHaveLength(2);
    const earlier = out.pages[0].children[0] as SubformNode;
    expect(earlier.children).toHaveLength(0);
    const later = out.pages[1].children[0] as SubformNode;
    expect(later.name).toBe('repeat');
    expect(later.children).toHaveLength(1);
    const row = later.children[0] as SubformNode;
    expect(row.name).toBe('keptRow');
    expect(row.children.map((c) => c.name)).toEqual(['cell']);
  });

  it('moves only the kept leaf when an ancestor has no keep', () => {
    const out = run([
      {
        ...subform('repeat', { x: 54, y: BOUNDARY - 20, w: 200, h: 40 }, [
          subform('row', { x: 54, y: BOUNDARY - 20, w: 200, h: 40 }, [
            {
              ...field('cell', { x: 54, y: BOUNDARY - 20, w: 100, h: 40 }),
              keep: { intact: 'contentArea' },
            },
          ]),
        ]),
        repeatIndex: 0,
      },
    ]);

    expect(out.pages).toHaveLength(2);
    const earlier = out.pages[0].children[0] as SubformNode;
    const earlierRow = earlier.children[0] as SubformNode;
    expect(earlierRow.children).toHaveLength(0);
    const later = out.pages[1].children[0] as SubformNode;
    expect(later.name).toBe('repeat');
    const laterRow = later.children[0] as SubformNode;
    expect(laterRow.name).toBe('row');
    expect(laterRow.children.map((c) => c.name)).toEqual(['cell']);
  });

  it('does not treat keep intact="none" as an explicit keep inside a repeat', () => {
    const out = run([
      {
        ...subform('repeat', { x: 54, y: BOUNDARY - 20, w: 200, h: 40 }, [
          {
            ...subform('row', { x: 54, y: BOUNDARY - 20, w: 200, h: 40 }, [
              field('cell', { x: 54, y: BOUNDARY - 20, w: 100, h: 40 }),
            ]),
            keep: { intact: 'none' },
          },
        ]),
        repeatIndex: 0,
      },
    ]);

    expect(out.pages).toHaveLength(2);
    const firstRow = (out.pages[0].children[0] as SubformNode).children[0] as SubformNode;
    expect(firstRow.position!.h).toBeLessThan(40);
  });

  it('carries the original box on clipped field fragments', () => {
    const out = run([
      subform('holder', { x: 54, y: 780, w: 100, h: 40 }, [
        {
          ...field('multi', { x: 54, y: 780, w: 100, h: 40 }),
          ui: { type: 'textEdit', multiLine: true },
          font: { size: 10 },
          resolvedValue: 'a\nb\nc',
        },
      ]),
    ]);

    expect(out.pages).toHaveLength(2);
    const first = (out.pages[0].children[0] as SubformNode).children[0] as FieldNode;
    const second = (out.pages[1].children[0] as SubformNode).children[0] as FieldNode;
    expect(first.originalBox).toEqual({ topOffset: 0, height: 40 });
    expect(second.originalBox).toEqual({ topOffset: -8, height: 40 });
    expect(second.textLineRange).toEqual({ start: 0, end: 3 });
  });

  it('assigns a thin bordered rule crossing a boundary to one page without duplicating it', () => {
    const out = run([
      subform('section', { x: 54, y: BOUNDARY - 10, w: 200, h: 20 }, [
        rule('hairline', { x: 54, y: BOUNDARY - 0.5, w: 200, h: 1 }),
      ]),
    ]);

    expect(out.pages).toHaveLength(2);
    const rules = out.pages.flatMap((p) =>
      (p.children[0] as SubformNode).children.filter((c) => c.name === 'hairline')
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].position).toMatchObject({ h: 1 });
  });

  it('shifts a post-shift straddling draw whole into the later band', () => {
    const leaf: DrawNode = {
      type: 'draw',
      name: 'leaf',
      value: { type: 'text', content: 'alpha beta' },
      font: { size: 10 },
      position: { x: 54, y: 700, w: 50, h: 30 },
    };
    const out = run([
      subform('block', { x: 54, y: 680, w: 200, h: 220 }, [
        field('first', { x: 54, y: 700, w: 50, h: 10 }),
        { ...field('trigger', { x: 54, y: 720, w: 50, h: 10 }), breakBefore: 'pageArea' },
        leaf,
      ]),
    ]);

    expect(out.pages).toHaveLength(2);
    const found = out.pages
      .map((p) => (p.children[0] as SubformNode).children.filter((c) => c.name === 'leaf'))
      .flat();
    expect(found).toHaveLength(1);
    expect(found[0].position).toMatchObject({ y: 54, h: 30 });
    expect((found[0] as DrawNode).originalBox).toBeUndefined();
    expect((found[0] as DrawNode).textLineRange).toBeUndefined();
    expect(leaf.position).toEqual({ x: 54, y: 700, w: 50, h: 30 });
  });

  it('leaves a node that does not straddle a band unfragmented', () => {
    const inside: FieldNode = field('inside', { x: 54, y: 760, w: 100, h: 20 });
    const out = run([
      subform('section', { x: 54, y: 760, w: 200, h: 70 }, [
        inside,
        field('crossing', { x: 54, y: 785, w: 100, h: 10 }),
      ]),
    ]);

    expect(out.pages).toHaveLength(2);
    const first = out.pages[0].children[0] as SubformNode;
    expect(first.children[0]).toMatchObject({ name: 'inside', position: inside.position });
    expect(first.children[0].position).toEqual({ x: 54, y: 760, w: 100, h: 20 });
    expect(inside.originalBox).toBeUndefined();
    expect(inside.textLineRange).toBeUndefined();
  });

  it('drops a sub-tenth-point sliver instead of returning a clipped fragment', () => {
    const out = run([
      subform('section', { x: 54, y: BOUNDARY - 10, w: 200, h: 20 }, [
        field('sliver', { x: 54, y: BOUNDARY - 0.02, w: 100, h: 0.04 }),
      ]),
    ]);

    expect(out.pages).toHaveLength(2);
    for (const page of out.pages) {
      const section = page.children[0] as SubformNode;
      expect(section.children).toHaveLength(0);
    }
  });
});
