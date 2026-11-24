import type { LayoutNode } from '../../../types';

export const PAGE_DEFAULT_FONT_SIZE = 10;

export function stampInheritedFontSizes(
  nodes: LayoutNode[],
  incoming: number = PAGE_DEFAULT_FONT_SIZE
): void {
  for (const node of nodes) {
    if (node.type === 'draw' || node.type === 'field') {
      node.inheritedFontSize = incoming;
      continue;
    }
    if (node.type === 'subform' || node.type === 'exclGroup') {
      stampInheritedFontSizes(node.children, incoming);
    }
  }
}
