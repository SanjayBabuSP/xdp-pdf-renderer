import { evaluateConditions } from '../../../../src/domain/mapping/evaluate-conditions';
import { calculatePositions } from '../../../../src/domain/layout/calculate-positions';
import { LayoutModel, LayoutNode, SubformNode, FieldNode } from '../../../../src/types';

/**
 * Adobe presence semantics, verified against xfalayout_disasm.c:
 *  - hidden/inactive are NOT layoutable (no space) — isLayoutableObject
 *    (:66815) returns 0 for 0x2a0002/0x2a0003, and isHiddenObject (:66682)
 *    marks them hidden.
 *  - invisible IS layoutable (occupies space, excluded from the visible list at
 *    :71155 where only 0x2a0000/0x2a0001 are appended) but is not painted
 *    (isRenderable, renderer_disasm.c:35690, consults the XDC hidden/invisible
 *    options — both disabled in adobepdf.xdc).
 */

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

function field(name: string, presence: FieldNode['presence']): FieldNode {
  return { type: 'field', name, presence, position: { w: 100, h: 10 } };
}

function flow(children: LayoutNode[]): SubformNode {
  return { type: 'subform', name: 'flow', layout: 'tb', position: { w: 200 }, children };
}

describe('presence semantics (XFA hidden/inactive take no space, invisible does)', () => {
  it('drops hidden/inactive but keeps invisible during condition filtering', () => {
    const result = evaluateConditions(
      model([
        flow([
          field('a', 'visible'),
          field('b', 'invisible'),
          field('c', 'visible'),
          field('d', 'hidden'),
          field('e', 'inactive'),
          field('f', 'visible'),
        ]),
      ])
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    const names = (result.data.children[0] as SubformNode).children.map((n) => n.name);
    expect(names).toEqual(['a', 'b', 'c', 'f']);
  });

  it('invisible occupies flow space; hidden/inactive do not', () => {
    const filtered = evaluateConditions(
      model([
        flow([
          field('a', 'visible'),
          field('b', 'invisible'),
          field('c', 'visible'),
          field('d', 'hidden'),
          field('e', 'visible'),
        ]),
      ])
    );
    expect(filtered.success).toBe(true);
    if (!filtered.success) return;

    const positioned = calculatePositions(filtered.data);
    expect(positioned.success).toBe(true);
    if (!positioned.success) return;

    const flowNode = positioned.data.children[0] as SubformNode;
    const ys = Object.fromEntries(flowNode.children.map((n) => [n.name, n.position!.y]));
    // a at 54; b (invisible) at 64; c at 74; d removed; e at 84.
    expect(ys.a).toBe(54);
    expect(ys.b).toBe(64);
    expect(ys.c).toBe(74);
    expect(ys.e).toBe(84);
    expect(ys.d).toBeUndefined();
  });
});
