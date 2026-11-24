import {
  drawValueHeight,
  getChildX,
  getChildY,
  layoutExclGroup,
  layoutLeafDraw,
  layoutLeafField,
  layoutPositionSubform,
} from '../../../../src/domain/layout/position-engine';
import { ChildLayouter, LayoutContext } from '../../../../src/domain/layout/engine-types';
import {
  DrawNode,
  ExclGroupNode,
  FieldNode,
  LayoutNode,
  Position,
  SubformNode,
} from '../../../../src/types';

function field(name: string, position?: Position): FieldNode {
  return { type: 'field', name, position };
}

function drawNode(name: string, value?: DrawNode['value']): DrawNode {
  return { type: 'draw', name, value };
}

function subform(
  name: string,
  layout: SubformNode['layout'],
  position: Position,
  children: LayoutNode[],
  extra: Partial<SubformNode> = {}
): SubformNode {
  return { type: 'subform', name, layout, position, children, ...extra };
}

function group(
  name: string,
  children: LayoutNode[],
  extra: Partial<ExclGroupNode> = {}
): ExclGroupNode {
  return { type: 'exclGroup', name, children, ...extra };
}

function context(overrides: Partial<LayoutContext> = {}): LayoutContext {
  return { x: 0, y: 0, availableWidth: 200, ...overrides };
}

function recording(heights: Record<string, number>): {
  layouter: ChildLayouter;
  contexts: LayoutContext[];
} {
  const contexts: LayoutContext[] = [];
  const layouter: ChildLayouter = (node, ctx) => {
    contexts.push(ctx);
    return {
      node: { ...node, position: { ...node.position, x: ctx.x, y: ctx.y, w: ctx.availableWidth } },
      height: heights[node.name ?? ''] ?? 10,
    };
  };
  return { layouter, contexts };
}

describe('child position helpers', () => {
  it('reads x and y for positioned node types', () => {
    const positionedDraw: DrawNode = { ...drawNode('d'), position: { x: 3 } };
    expect(getChildX(field('f', { x: 12 }))).toBe(12);
    expect(getChildY(field('f', { y: 8 }))).toBe(8);
    expect(getChildX(positionedDraw)).toBe(3);
    expect(getChildY(subform('s', 'tb', { y: 5 }, []))).toBe(5);
    expect(getChildY(group('g', [], { position: { y: 6 } }))).toBe(6);
  });

  it('shifts y by the width for 90-degree rotation only', () => {
    expect(getChildY(field('f', { y: 8, w: 20, rotate: 90 }))).toBe(-12);
    expect(getChildY(field('f', { y: 8, w: 20, rotate: 450 }))).toBe(-12);
    expect(getChildY(field('f', { y: 8, w: 20, rotate: 270 }))).toBe(8);
    expect(getChildY(field('f', { y: 8, w: 20, rotate: 0 }))).toBe(8);
  });

  it('returns zero for nodes without a position', () => {
    expect(getChildX(field('f'))).toBe(0);
    expect(getChildY(field('f'))).toBe(0);
  });

  it('honours anchorType when placing positioned nodes', () => {
    expect(getChildX(field('f', { x: 12, w: 4, anchorType: 'bottomRight' }))).toBe(8);
    expect(getChildY(field('f', { y: 10, h: 6, anchorType: 'bottomRight' }))).toBe(4);
    expect(getChildX(field('f', { x: 12, w: 4, anchorType: 'topRight' }))).toBe(8);
    expect(getChildY(field('f', { y: 10, h: 6, anchorType: 'topRight' }))).toBe(10);
    expect(getChildX(field('f', { x: 12, w: 4, anchorType: 'middleCenter' }))).toBe(10);
    expect(getChildY(field('f', { y: 10, h: 6, anchorType: 'middleCenter' }))).toBe(7);
    expect(getChildX(field('f', { x: 12, w: 4, anchorType: 'topLeft' }))).toBe(12);
    expect(getChildY(field('f', { y: 10, h: 6, anchorType: 'topLeft' }))).toBe(10);
  });

  it('keeps authored x and y when anchorType extents are unknown', () => {
    expect(getChildX(field('f', { x: 12, anchorType: 'bottomRight' }))).toBe(12);
    expect(getChildY(field('f', { y: 10, anchorType: 'bottomRight' }))).toBe(10);
  });
});

describe('layoutPositionSubform', () => {
  it('places children at authored coordinates plus container insets', () => {
    const node = subform(
      'pos',
      'position',
      { x: 5, y: 6, w: 200 },
      [field('a', { x: 2, y: 7, w: 30, h: 9 }), field('b', { x: 4, y: 8, w: 40, h: 11 })],
      { margin: { leftInset: 10, rightInset: 20, topInset: 3, bottomInset: 4 } }
    );
    const { layouter, contexts } = recording({ a: 10, b: 15 });
    const result = layoutPositionSubform(node, context(), layouter);
    expect(result.node.position).toEqual({ x: 0, y: 0, w: 200, h: 30 });
    expect(result.height).toBe(30);
    expect(contexts).toEqual([
      { x: 12, y: 10, availableWidth: 30, widthFromContent: true },
      { x: 14, y: 11, availableWidth: 40, widthFromContent: true },
    ]);
    const children = (result.node as SubformNode).children;
    expect(children.map((child) => child.position)).toEqual([
      { x: 12, y: 10, w: 30, h: 9 },
      { x: 14, y: 11, w: 40, h: 11 },
    ]);
  });

  it('stacks consecutive repeat instances using the previous result height', () => {
    const children: LayoutNode[] = [0, 1, 2].map((index) => ({
      ...field('row', { x: 0, y: 7, w: 50, h: 10 }),
      repeatIndex: index,
    }));
    const { layouter } = recording({ row: 12 });
    const result = layoutPositionSubform(
      subform('pos', 'position', { w: 200 }, children),
      context(),
      layouter
    );
    expect((result.node as SubformNode).children.map((child) => child.position?.y)).toEqual([
      7, 19, 31,
    ]);
    expect(result.height).toBe(43);
  });
});

describe('layoutLeafField', () => {
  it('uses authored width and clamps height by minH', () => {
    const result = layoutLeafField(field('f', { w: 100, minH: 40 }), context());
    expect(result.node.position).toEqual({ w: 100, minH: 40, x: 0, y: 0, h: 40 });
    expect(result.height).toBe(40);
  });

  it('keeps an explicit height and stretches to the available width when requested', () => {
    const result = layoutLeafField(field('f', { w: 80, h: 25 }), context({ stretchWidth: true }));
    expect(result.node.position).toEqual({ w: 200, h: 25, x: 0, y: 0 });
  });

  it('uses minW for content-driven width', () => {
    expect(
      layoutLeafField(field('f', { minW: 33 }), context({ widthFromContent: true })).node.position
    ).toEqual({
      minW: 33,
      x: 0,
      y: 0,
      w: 33,
      h: 12,
    });
  });

  it('sizes width from choice text', () => {
    const node = field('f');
    node.ui = { type: 'choiceList', items: [{ text: 'Red', value: 'r' }] };
    node.resolvedValue = 'r';
    const result = layoutLeafField(node, context({ widthFromText: true }));
    expect(result.node.position?.w).toBeCloseTo(18.34, 2);
  });

  it('wraps multi-line values and includes paragraph spacing', () => {
    const multiline = field('f', { w: 40 });
    multiline.ui = { type: 'textEdit', multiLine: true };
    multiline.resolvedValue = 'alpha beta gamma delta epsilon';
    expect(layoutLeafField(multiline, context()).height).toBe(60);

    const spaced = field('f', { w: 100 });
    spaced.resolvedValue = 'Hi';
    spaced.para = { spaceAbove: 3, spaceBelow: 4, lineHeight: 15, marginLeft: 2, marginRight: 3 };
    expect(layoutLeafField(spaced, context()).height).toBe(22);
  });

  it('adds reserved caption height for top and bottom captions', () => {
    const node = field('f', { w: 50 });
    node.caption = { placement: 'top', reserve: 7, text: 'Caption' };
    expect(layoutLeafField(node, context()).height).toBe(19);
    node.caption.placement = 'bottom';
    expect(layoutLeafField(node, context()).height).toBe(19);
    node.caption.placement = 'left';
    expect(layoutLeafField(node, context()).height).toBe(12);
  });

  it('sizes field content from the inherited font size', () => {
    const makeNode = (): FieldNode => {
      const node = field('f', { w: 400 });
      node.font = { family: 'Arial Narrow', size: 12 };
      node.margin = {
        topInset: 2.8346,
        bottomInset: 2.8346,
        leftInset: 2.8346,
        rightInset: 2.8346,
      };
      node.ui = { type: 'textEdit', multiLine: true };
      node.resolvedValue = 'Fdls ik n Proiozt Ugmmqfkjpl Rgwmqqt.';
      return node;
    };
    const stamped = makeNode();
    stamped.inheritedFontSize = 10;
    expect(layoutLeafField(stamped, context()).height).toBeCloseTo(17.67, 1);

    const unstamped = makeNode();
    expect(layoutLeafField(unstamped, context()).height).toBeCloseTo(20.07, 1);
  });

  it('keeps a smaller own size for field content below the inherited grid', () => {
    const node = field('f', { w: 400, h: 11.34 });
    node.font = { family: 'Arial', size: 6.5 };
    node.inheritedFontSize = 10;
    node.margin = { topInset: 1.42, bottomInset: 1.42, leftInset: 1.42, rightInset: 1.42 };
    node.resolvedValue = 'Xjbjrpvrjaphl';
    expect(layoutLeafField(node, context()).height).toBeCloseTo(11.34, 1);
  });
});

describe('drawValueHeight and layoutLeafDraw', () => {
  it('derives height from text and rich-text values', () => {
    expect(drawValueHeight(drawNode('d', { type: 'text', content: 'Hello' }), 100)).toBe(12);
    expect(drawValueHeight(drawNode('d', { type: 'richText', content: '<p>Hello</p>' }), 100)).toBe(
      12
    );
  });

  it('returns zero for empty or non-text values', () => {
    expect(drawValueHeight(drawNode('d', { type: 'text', content: '' }), 100)).toBe(0);
    expect(drawValueHeight(drawNode('d'), 100)).toBe(0);
    expect(drawValueHeight(drawNode('d', { type: 'image', content: 'x' }), 100)).toBe(0);
  });

  it('includes top and bottom insets in text and rich-text heights', () => {
    const margin = { topInset: 3, bottomInset: 5 };
    const text = drawNode('d', { type: 'text', content: 'Hello' });
    text.margin = margin;
    expect(drawValueHeight(text, 100)).toBe(20);

    const rich = drawNode('d', { type: 'richText', content: '<p>Hello</p>' });
    rich.margin = margin;
    expect(drawValueHeight(rich, 100)).toBe(20);
  });

  it('ignores para lineHeight when sizing rich text', () => {
    const node = drawNode('d', {
      type: 'richText',
      content: '<p>First</p><p style="line-height:22.5pt">Second</p>',
    });
    node.font = { size: 12 };
    node.para = { lineHeight: 30 };
    expect(drawValueHeight(node, 400)).toBeCloseTo(14.4 + 22.5, 6);
  });

  it('sizes a spacer-only rich paragraph using its authored line-height', () => {
    const node = drawNode('d', {
      type: 'richText',
      content:
        '<p style="font-size:8pt;line-height:7pt"><span style="xfa-spacerun:yes">\u00a0</span></p>',
    });
    expect(drawValueHeight(node, 100)).toBeCloseTo(7, 6);
  });

  it('sums authored rich paragraph advances and margins for the block height', () => {
    const node = drawNode('d', {
      type: 'richText',
      content:
        '<p style="font-size:10pt;line-height:18pt; margin-top:3pt; margin-bottom:4pt">First</p>' +
        '<p style="font-size:10pt;line-height:9pt">Second</p>',
    });
    expect(drawValueHeight(node, 100)).toBeCloseTo(34, 6);
  });

  it('caps an authored one-line draw at its minH instead of wrapped content height', () => {
    const node = drawNode('d', { type: 'text', content: 'www.example.com/805ee9e4' });
    node.position = { w: 40, minH: 8.86 };
    node.font = { size: 6.5 };
    expect(drawValueHeight(node, 40)).toBeGreaterThan(15);

    const result = layoutLeafDraw(node, context());
    expect(result.node.position).toEqual({ w: 40, minH: 8.86, x: 0, y: 0, h: 8.86 });
    expect(result.height).toBeCloseTo(8.86, 6);
  });

  it('still grows an authored box that fits multiple lines', () => {
    const node = drawNode('d', {
      type: 'text',
      content: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu',
    });
    node.position = { w: 40, minH: 40 };
    node.font = { size: 6.5 };

    const result = layoutLeafDraw(node, context());
    expect(result.height).toBeGreaterThan(40);
  });

  it('defaults an empty draw to 18 points tall', () => {
    const result = layoutLeafDraw(drawNode('d'), context());
    expect(result.node.position).toEqual({ x: 0, y: 0, w: 200, h: 18 });
    expect(result.height).toBe(18);
  });

  it('sizes a draw from its value and honours a fixed height', () => {
    expect(
      layoutLeafDraw(drawNode('d', { type: 'text', content: 'Hello' }), context()).height
    ).toBe(12);
    const fixed: DrawNode = drawNode('d', { type: 'text', content: 'Hello' });
    fixed.position = { h: 30, w: 90 };
    expect(layoutLeafDraw(fixed, context()).node.position).toEqual({ h: 30, w: 90, x: 0, y: 0 });
  });

  it('lays out a rotated draw at its visual height while keeping visual width in place', () => {
    const node = drawNode('d');
    node.position = { w: 11.34, h: 14.83, rotate: 90 };
    const result = layoutLeafDraw(node, context());
    expect(result.height).toBeCloseTo(11.34, 6);
    expect(result.node.position?.h).toBeCloseTo(14.83, 6);
    expect(result.node.position?.w).toBeCloseTo(11.34, 6);
  });

  it('does not change flow height for unrotated draws', () => {
    const node = drawNode('d', { type: 'text', content: 'Hello' });
    node.position = { w: 90, h: 30 };
    const result = layoutLeafDraw(node, context());
    expect(result.height).toBe(30);
    expect(result.node.position?.h).toBe(30);
  });
});

describe('layoutExclGroup', () => {
  it('stacks children vertically and accounts for insets', () => {
    const node = group('eg', [field('a'), field('b')], {
      position: { y: 2 },
      margin: { topInset: 3, bottomInset: 4, leftInset: 5 },
    });
    const { layouter, contexts } = recording({ a: 10, b: 20 });
    const result = layoutExclGroup(node, context(), layouter);
    expect(result.node.position).toEqual({ y: 0, x: 0, w: 200, h: 37 });
    expect(result.height).toBe(37);
    expect(contexts).toEqual([
      { x: 5, y: 3, availableWidth: 195 },
      { x: 5, y: 13, availableWidth: 195 },
    ]);
  });

  it('uses an authored height over the stacked content height', () => {
    const node = group('eg', [field('a')], {
      position: { h: 100 },
    });
    expect(layoutExclGroup(node, context(), recording({ a: 10 }).layouter).height).toBe(100);
  });
});
