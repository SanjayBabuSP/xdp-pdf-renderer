import { applyPagination } from '../../../../src/domain/layout/apply-pagination';
import { applyTableLayouts } from '../../../../src/domain/layout/calculate-table-layout';
import { calculatePositions } from '../../../../src/domain/layout/calculate-positions';
import { LayoutModel, SubformNode } from '../../../../src/types';

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
});
