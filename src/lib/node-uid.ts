import { LayoutNode } from '../types';

/**
 * Stamp every node in the given forest with a unique `uid`.
 *
 * Adobe LiveCycle identifies template elements by their XDP `id` attribute
 * (falling back to `name`). Script results must be reconciled back onto the
 * exact node they were produced against, so every layout node needs a key
 * that is unique within the model.
 *
 * The base for a node is its already-assigned `uid` (XDP id/name captured at
 * parse time), then its `name`, then a synthetic counter. Collisions get a
 * `#N` suffix in document order.
 *
 * Called after parsing and again after repeat expansion (which clones nodes
 * and would otherwise leave duplicate ids behind).
 */
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
