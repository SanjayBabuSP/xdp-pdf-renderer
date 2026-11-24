import type { LayoutNode } from '../../../../src/types';
import {
  PAGE_DEFAULT_FONT_SIZE,
  stampInheritedFontSizes,
} from '../../../../src/domain/parsing/parse-xdp/inherit-font-size';

function draw(name: string): LayoutNode {
  return { type: 'draw', name };
}

function field(name: string): LayoutNode {
  return { type: 'field', name };
}

function subform(name: string, children: LayoutNode[]): LayoutNode {
  return { type: 'subform', name, layout: 'tb', children };
}

describe('stampInheritedFontSizes', () => {
  it('stamps the page default on top-level draws and fields', () => {
    const nodes = [draw('a'), field('b')];
    stampInheritedFontSizes(nodes);
    expect(nodes[0]).toMatchObject({ inheritedFontSize: PAGE_DEFAULT_FONT_SIZE });
    expect(nodes[1]).toMatchObject({ inheritedFontSize: PAGE_DEFAULT_FONT_SIZE });
    expect(PAGE_DEFAULT_FONT_SIZE).toBe(10);
  });

  it('propagates the incoming size through nested subforms', () => {
    const nodes = [subform('outer', [subform('inner', [draw('leaf')])])];
    stampInheritedFontSizes(nodes, 12);
    const leaf = (
      (nodes[0] as { children: LayoutNode[] }).children[0] as { children: LayoutNode[] }
    ).children[0] as { inheritedFontSize?: number };
    expect(leaf.inheritedFontSize).toBe(12);
  });

  it('descends into exclusive groups', () => {
    const nodes: LayoutNode[] = [{ type: 'exclGroup', name: 'g', children: [field('f')] }];
    stampInheritedFontSizes(nodes, 14);
    const leaf = (nodes[0] as { children: LayoutNode[] }).children[0] as {
      inheritedFontSize?: number;
    };
    expect(leaf.inheritedFontSize).toBe(14);
  });
});
