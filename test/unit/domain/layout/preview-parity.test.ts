import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';
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

function xdpWith(childrenXml: string, rootLayout = 'tb', rootAttrs = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">` +
    `<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">` +
    `<subform name="root" layout="${rootLayout}"${rootAttrs}>${childrenXml}</subform>` +
    `</template></xdp:xdp>`
  );
}

describe('Preview-as-PDF parity', () => {
  it('preserves mixed-type document order in flow containers', () => {
    const parsed = parseXdp(
      xdpWith(
        `<field name="f1" w="100pt" h="20pt"/>` +
          `<draw name="d1" w="100pt" h="20pt"><value><text>label</text></value></draw>` +
          `<field name="f2" w="100pt" h="20pt"/>` +
          `<subform name="s1" layout="position" w="100pt" h="20pt"/>`
      )
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('parse failed');
    expect(parsed.data.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      'field:f1',
      'draw:d1',
      'field:f2',
      'subform:s1',
    ]);
  });

  it('dispatches layout="lr-tb" to the flow engine (not position fallback)', () => {
    const out = run([
      subform('row', 'lr-tb', { w: 200 }, [
        field('a', { w: 120, h: 20 }),
        field('b', { w: 120, h: 20 }),
      ]),
    ]);
    const row = out[0] as SubformNode;
    // Second child wraps to the next line instead of overlapping at the origin.
    expect(row.children[0].position!.x).toBe(54);
    expect(row.children[0].position!.y).toBe(54);
    expect(row.children[1].position!.x).toBe(54);
    expect(row.children[1].position!.y).toBe(74);
    expect(row.position!.h).toBe(40);
  });

  it('honours exclGroup x/y in position layout', () => {
    const out = run([
      subform('wrap', 'position', { w: 400, h: 400 }, [
        { type: 'exclGroup', name: 'g', position: { x: 10, y: 20, w: 200 }, children: [field('a', { w: 200, h: 20 })] },
      ]),
    ]);
    const g = (out[0] as SubformNode).children[0];
    expect(g.position!.x).toBe(64); // content-area x (54) + authored 10
    expect(g.position!.y).toBe(74); // content-area y (54) + authored 20
  });

  it('lays flow children inside the container margin insets', () => {
    const out = run([
      subform(
        'm',
        'tb',
        { w: 200 },
        [field('b', { w: 100, h: 20 })]
      ),
    ]);
    const m = out[0] as SubformNode;
    // No margins: unchanged behaviour (child at container origin).
    expect(m.children[0].position!.x).toBe(54);

    const withMargin = run([
      {
        ...subform('m', 'tb', { w: 200 }, [field('b', { w: 100, h: 20 })]),
        margin: { leftInset: 10, topInset: 5 },
      },
    ]);
    const mm = withMargin[0] as SubformNode;
    expect(mm.children[0].position!.x).toBe(64);
    expect(mm.children[0].position!.y).toBe(59);
    // Growable box includes the insets (20 content + 5 top).
    expect(mm.position!.h).toBe(25);
  });

  it('uses the XFA 10pt default font height for growable fields', () => {
    const out = run([field('a', { w: 100 })]);
    // Single value line at 10pt × 1.2 advance.
    expect(out[0].position!.h).toBeCloseTo(12, 5);
  });
});
