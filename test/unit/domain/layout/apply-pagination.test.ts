import { applyPagination } from '../../../../src/domain/layout/apply-pagination';
import { applyTableLayouts } from '../../../../src/domain/layout/calculate-table-layout';
import { calculatePositions } from '../../../../src/domain/layout/calculate-positions';
import {
  ExclGroupNode,
  DrawNode,
  FieldNode,
  LayoutModel,
  LayoutNode,
  SubformNode,
} from '../../../../src/types';

describe('applyPagination', () => {
  it('keeps table rows together when splitting pages', () => {
    const layout: LayoutModel = {
      rootSubformName: 'value',
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 595.28, long: 841.89 },
          contentArea: { x: 54, y: 54, w: 487.28, h: 120 },
          masterPageChildren: [],
        },
      ],
      children: [
        {
          type: 'subform',
          name: 'RevisionHistoryTable',
          layout: 'table',
          columnWidths: [100, 100, 100],
          children: [
            {
              type: 'subform',
              name: 'Row1',
              layout: 'row',
              children: [
                {
                  type: 'field',
                  name: 'A',
                  bindMatch: 'none',
                  position: { x: 0, y: 0, w: 30, h: 20 },
                },
                {
                  type: 'field',
                  name: 'B',
                  bindMatch: 'none',
                  position: { x: 0, y: 0, w: 30, h: 20 },
                },
                {
                  type: 'field',
                  name: 'C',
                  bindMatch: 'none',
                  position: { x: 0, y: 0, w: 30, h: 20 },
                },
              ],
            },
            {
              type: 'subform',
              name: 'Row2',
              layout: 'row',
              children: [
                {
                  type: 'field',
                  name: 'D',
                  bindMatch: 'none',
                  position: { x: 0, y: 0, w: 30, h: 20 },
                },
                {
                  type: 'field',
                  name: 'E',
                  bindMatch: 'none',
                  position: { x: 0, y: 0, w: 30, h: 20 },
                },
                {
                  type: 'field',
                  name: 'F',
                  bindMatch: 'none',
                  position: { x: 0, y: 0, w: 30, h: 20 },
                },
              ],
            },
          ],
        },
      ],
    };

    const laidOut = applyTableLayouts(layout, layout.pages[0].contentArea.w);
    expect(laidOut.success).toBe(true);
    if (!laidOut.success) return;
    const positioned = calculatePositions(laidOut.data);
    expect(positioned.success).toBe(true);
    if (!positioned.success) return;

    const result = applyPagination(positioned.data, 25);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[0].children).toHaveLength(1);
    expect(result.data.pages[1].children).toHaveLength(1);
    const p0 = result.data.pages[0].children[0] as SubformNode;
    const p1 = result.data.pages[1].children[0] as SubformNode;
    expect(p0.type).toBe('subform');
    expect(p0.name).toBe('RevisionHistoryTable');
    expect(p1.name).toBe('RevisionHistoryTable');
    expect(p0.children.map((c) => c.name)).toEqual(['Row1']);
    expect(p1.children.map((c) => c.name)).toEqual(['Row2']);
  });

  it('splits a multi-line field by line instead of duplicating it', () => {
    const layout: LayoutModel = {
      rootSubformName: 'value',
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 100, long: 100 },
          contentArea: { x: 0, y: 0, w: 100, h: 50 },
          masterPageChildren: [],
        },
      ],
      children: [
        {
          type: 'subform',
          name: 'repeat',
          layout: 'tb',
          repeatIndex: 0,
          position: { x: 0, y: 40, w: 50, h: 36 },
          children: [
            {
              type: 'field',
              name: 'multi',
              ui: { type: 'textEdit', multiLine: true },
              font: { size: 10 },
              resolvedValue: 'first line second line',
              position: { x: 0, y: 40, w: 50, h: 36 },
            },
          ],
        },
      ],
    };

    const result = applyPagination(layout, 50);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    const first = (result.data.pages[0].children[0] as SubformNode).children[0] as FieldNode;
    const second = (result.data.pages[1].children[0] as SubformNode).children[0] as FieldNode;
    expect(first.textLineRange).toEqual({ start: 0, end: 1 });
    expect(second.textLineRange).toEqual({ start: 1, end: 3 });
  });
});

describe('applyPagination — edge paths', () => {
  function page(children: LayoutNode[]): LayoutModel {
    return {
      rootSubformName: 'value',
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 100, long: 200 },
          contentArea: { x: 0, y: 0, w: 100, h: 100 },
          masterPageChildren: [],
        },
      ],
      children,
    };
  }

  it('uses the default A4 page definition when the model has no pages', () => {
    const layout: LayoutModel = {
      rootSubformName: 'value',
      pages: [],
      children: [{ type: 'field', name: 'f', bindMatch: 'none' }],
      rootEvents: [{ name: 'init', activity: 'initialize' }],
    };

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(1);
    const only = result.data.pages[0];
    expect(only.pageIndex).toBe(0);
    expect(only.medium).toEqual({ stock: 'a4', short: 595.28, long: 841.89 });
    expect(only.contentArea).toEqual({ x: 54, y: 54, w: 487.28, h: 733.89 });
    expect(only.masterPageChildren).toEqual([]);
    expect(only.children).toEqual(layout.children);
    expect(result.data.rootEvents).toEqual([{ name: 'init', activity: 'initialize' }]);
  });

  it('keeps nodes that have no usable y position on the first page', () => {
    const layout = page([
      { type: 'field', name: 'nopos', bindMatch: 'none' },
      { type: 'field', name: 'noy', bindMatch: 'none', position: { x: 0, w: 10, h: 10 } },
      { type: 'field', name: 'placed', bindMatch: 'none', position: { x: 0, y: 10, w: 10, h: 10 } },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.pages[0].children.map((c) => c.name)).toEqual(['nopos', 'noy', 'placed']);
  });

  it('moves a node with breakBefore=pageEven onto the next even page', () => {
    const layout = page([
      { type: 'field', name: 'first', bindMatch: 'none', position: { x: 0, y: 10, w: 10, h: 10 } },
      {
        type: 'field',
        name: 'second',
        bindMatch: 'none',
        breakBefore: 'pageEven',
        position: { x: 0, y: 30, w: 10, h: 10 },
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    const second = result.data.pages[1].children[0];
    expect(second.name).toBe('second');
    expect(second.position?.y).toBe(0);
  });

  it('moves a node with breakBefore=pageOdd onto an odd page', () => {
    const layout = page([
      { type: 'field', name: 'first', bindMatch: 'none', position: { x: 0, y: 10, w: 10, h: 10 } },
      {
        type: 'field',
        name: 'second',
        bindMatch: 'none',
        breakBefore: 'pageOdd',
        position: { x: 0, y: 30, w: 10, h: 10 },
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(3);
    expect(result.data.pages[2].children[0].name).toBe('second');
  });

  it('carries breakAfter forward as a pending break for the next sibling', () => {
    const layout = page([
      {
        type: 'field',
        name: 'first',
        bindMatch: 'none',
        breakAfter: 'pageEven',
        position: { x: 0, y: 10, w: 10, h: 10 },
      },
      { type: 'field', name: 'second', bindMatch: 'none', position: { x: 0, y: 30, w: 10, h: 10 } },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[1].children[0].name).toBe('second');
  });

  it('clips an exclGroup and its children across page boundaries', () => {
    const group: ExclGroupNode = {
      type: 'exclGroup',
      name: 'group',
      position: { x: 0, y: 90, w: 20, h: 120 },
      children: [
        {
          type: 'field',
          name: 'gfield',
          resolvedValue: 'hello',
          font: { size: 10 },
          position: { x: 0, y: 90, w: 20, h: 120 },
        },
      ],
    };

    const result = applyPagination(page([group]));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(3);
    const fragments = result.data.pages.map((p) => p.children[0]);
    if (fragments.some((f) => f.type !== 'exclGroup')) throw new Error('expected group');
    expect(fragments.map((f) => f.position?.y)).toEqual([90, 0, 0]);
    expect(fragments.map((f) => f.position?.h)).toEqual([10, 100, 10]);
  });

  it('uses choice-list display text when splitting a field across pages', () => {
    const field: FieldNode = {
      type: 'field',
      name: 'choice',
      ui: { type: 'choiceList', items: [{ text: 'Yes', value: 'y' }] },
      resolvedValue: 'y',
      font: { size: 10 },
      position: { x: 0, y: 95, w: 20, h: 120 },
    };

    const result = applyPagination(page([field]));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
  });

  it('uses draw text, rich text and non-text values when splitting draws', () => {
    const layout = page([
      {
        type: 'draw',
        name: 'plain',
        value: { type: 'text', content: 'alpha beta' },
        font: { size: 10 },
        position: { x: 0, y: 95, w: 20, h: 120 },
      },
      {
        type: 'draw',
        name: 'rich',
        value: { type: 'richText', content: '<p>gamma delta</p>' },
        font: { size: 10 },
        position: { x: 0, y: 95, w: 20, h: 120 },
      },
      {
        type: 'draw',
        name: 'rectangle',
        value: { type: 'rectangle' },
        position: { x: 0, y: 95, w: 20, h: 120 },
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(3);
  });

  it('anchors clipped rich-text fragments to the original box and selects lines by it', () => {
    const rich: DrawNode = {
      type: 'draw',
      name: 'tall',
      value: {
        type: 'richText',
        content: '<body style="font-size:12pt"><p>one</p><p>two</p><p>three</p><p>four</p></body>',
      },
      position: { x: 0, y: 80, w: 100, h: 66.5 },
    };

    const holder: SubformNode = {
      type: 'subform',
      name: 'holder',
      layout: 'tb',
      position: { x: 0, y: 80, w: 100, h: 66.5 },
      children: [rich],
    };
    const result = applyPagination(page([holder]));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    const first = (result.data.pages[0].children[0] as SubformNode).children[0] as DrawNode;
    const second = (result.data.pages[1].children[0] as SubformNode).children[0] as DrawNode;
    expect(first.position).toMatchObject({ y: 80, h: 20 });
    expect(first.originalBox).toEqual({ topOffset: 0, height: 66.5 });
    expect(second.position).toMatchObject({ y: 0, h: 46.5 });
    expect(second.originalBox).toEqual({ topOffset: -20, height: 66.5 });
    expect(second.textLineRange).toEqual({ start: 1, end: 4 });
  });

  it('a trailing breakAfter creates a following page', () => {
    const layout = page([
      {
        type: 'field',
        name: 'only',
        bindMatch: 'none',
        breakAfter: 'pageArea',
        position: { x: 0, y: 10, w: 10, h: 10 },
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[0].children.map((c) => c.name)).toEqual(['only']);
    expect(result.data.pages[1].children).toEqual([]);
  });

  it('treats vAlign=center like middle when selecting lines across pages', () => {
    const lineRangesFor = (vAlign: string): Array<{ start: number; end: number } | undefined> => {
      const layout = page([
        {
          type: 'subform',
          name: 'wrap',
          layout: 'tb',
          position: { x: 0, y: 70, w: 100, h: 60 },
          children: [
            {
              type: 'field',
              name: 'multi',
              ui: { type: 'textEdit', multiLine: true },
              para: { vAlign },
              font: { size: 10 },
              resolvedValue: 'line one\nline two',
              position: { x: 0, y: 70, w: 100, h: 60 },
            },
          ],
        },
      ]);
      const result = applyPagination(layout);
      if (!result.success) throw new Error('pagination failed');
      return result.data.pages.map(
        (p) =>
          ((p.children[0] as SubformNode | undefined)?.children[0] as FieldNode | undefined)
            ?.textLineRange
      );
    };

    const center = lineRangesFor('center');
    const middle = lineRangesFor('middle');
    const top = lineRangesFor('top');

    expect(center).toEqual(middle);
    expect(center).not.toEqual(top);
  });

  it('moves a table that fits the content area whole to the next page', () => {
    const rows = [0, 1, 2].map((i) => ({
      type: 'subform' as const,
      name: `row${i}`,
      layout: 'row' as const,
      position: { x: 0, y: 80 + i * 20, w: 100, h: 20 },
      children: [
        {
          type: 'field' as const,
          name: `cell${i}`,
          bindMatch: 'none' as const,
          position: { x: 0, y: 80 + i * 20, w: 100, h: 20 },
        },
      ],
    }));
    const layout = page([
      {
        type: 'subform',
        name: 'table',
        layout: 'table',
        position: { x: 0, y: 80, w: 100, h: 60 },
        children: rows,
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[0].children).toHaveLength(0);
    const table = result.data.pages[1].children[0] as SubformNode;
    expect(table.position).toMatchObject({ y: 0, h: 60 });
    expect(table.children.map((c) => c.name)).toEqual(['row0', 'row1', 'row2']);
    expect(table.children.map((c) => c.position?.y)).toEqual([0, 20, 40]);
  });

  it('paints a straddling line on exactly one side of the page boundary', () => {
    const layout = page([
      {
        type: 'subform',
        name: 'wrap',
        layout: 'tb',
        position: { x: 0, y: 79, w: 100, h: 40 },
        children: [
          {
            type: 'field',
            name: 'multi',
            ui: { type: 'textEdit', multiLine: true },
            font: { size: 10 },
            resolvedValue: 'a\nb\nc',
            position: { x: 0, y: 79, w: 100, h: 40 },
          },
        ],
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const ranges = result.data.pages.map(
      (p) =>
        ((p.children[0] as SubformNode | undefined)?.children[0] as FieldNode | undefined)
          ?.textLineRange
    );
    expect(ranges).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ]);
    const painted = ranges.flatMap((range) =>
      range == null
        ? []
        : Array.from({ length: range.end - range.start }, (_, i) => range.start + i)
    );
    expect(new Set(painted).size).toBe(painted.length);
    expect(painted.sort()).toEqual([0, 1, 2]);
  });

  it('keeps a line whose glyphs overlap the page band even when its baseline is outside', () => {
    const layout = page([
      {
        type: 'subform',
        name: 'wrap',
        layout: 'tb',
        position: { x: 0, y: 79, w: 100, h: 40 },
        children: [
          {
            type: 'field',
            name: 'multi',
            ui: { type: 'textEdit', multiLine: true },
            font: { size: 10 },
            resolvedValue: 'a\nb\nc',
            position: { x: 0, y: 79, w: 100, h: 40 },
          },
        ],
      },
    ]);

    const result = applyPagination(layout);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(2);
    const second = (result.data.pages[1].children[0] as SubformNode).children[0] as FieldNode;
    expect(second.textLineRange).toEqual({ start: 1, end: 3 });
  });
});

describe('fragment band extension', () => {
  function draw(name: string, y: number, h: number, value: DrawNode['value']): DrawNode {
    return {
      type: 'draw',
      name,
      position: { x: 0, y, w: 484, h },
      font: { size: 12 },
      value,
    } as DrawNode;
  }

  it('extends a mid-line fragment band and moves trailing content to the next page', () => {
    const words = Array.from({ length: 20 }, (_, i) => String.fromCharCode(97 + (i % 26)));
    const layout: LayoutModel = {
      rootSubformName: 'value',
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 595.28, long: 841.89 },
          contentArea: { x: 0, y: 100, w: 500, h: 200 },
          masterPageChildren: [],
        },
      ],
      children: [
        draw('rich', 107, 288, {
          type: 'richText',
          content: `<body>${words.map((w) => `<p>${w}</p>`).join('')}</body>`,
        }),
        draw('next', 395, 14.4, { type: 'text', content: 'next' }),
        draw('tail', 409.4, 90, { type: 'text', content: 'tail' }),
        draw('paged', 500, 50, { type: 'text', content: 'paged' }),
      ],
    };

    const result = applyPagination(layout, 200);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pages).toHaveLength(3);

    const second = result.data.pages[1].children as DrawNode[];
    const frag = second[0];
    expect(frag.name).toBe('rich');
    expect(frag.textLineRange).toEqual({ start: 13, end: 20 });
    expect(frag.position?.y).toBeCloseTo(100, 6);
    expect(frag.position?.h ?? 0).toBeCloseTo(98.4, 1);
    expect(second[1].name).toBe('next');
    expect(second[1].position?.y).toBeCloseTo(198.4, 6);
    expect(second.map((node) => (node as DrawNode).name)).not.toContain('tail');

    const third = result.data.pages[2].children as DrawNode[];
    expect(third[0].name).toBe('tail');
    expect(third[0].position?.y).toBeCloseTo(100, 6);
    expect(third[1].name).toBe('paged');
    expect(third[1].position?.y).toBeCloseTo(190, 6);
  });
});
