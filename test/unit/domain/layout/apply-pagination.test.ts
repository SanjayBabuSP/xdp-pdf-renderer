import { applyPagination } from '../../../../src/domain/layout/apply-pagination';
import { applyTableLayouts } from '../../../../src/domain/layout/calculate-table-layout';
import { calculatePositions } from '../../../../src/domain/layout/calculate-positions';
import {
  ExclGroupNode,
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
});
