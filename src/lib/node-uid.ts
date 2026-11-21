import { LayoutNode } from '../types';

export function stampUids(forests: LayoutNode[][]): void {
  const seen = new Set<string>();
  let synthetic = 0;

  const walk = (nodes: LayoutNode[]): void => {
    for (const node of nodes) {
      const base = node.uid ?? node.name ?? `node${synthetic++}`;
      let uid = base;
      if (seen.has(uid)) {
        let n = 2;
        while (seen.has(`${base}#${n}`)) n++;
        uid = `${base}#${n}`;
      }
      seen.add(uid);
      node.uid = uid;

      if (node.type === 'subform') walk(node.children);
      else if (node.type === 'exclGroup') walk(node.children);
    }
  };

  for (const forest of forests) walk(forest);
}
