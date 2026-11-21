import { LayoutNode } from '../../../src/types';
import { stampUids } from '../../../src/lib/node-uid';

function field(name: string, uid?: string): LayoutNode {
  return { type: 'field', name, uid };
}

describe('stampUids', () => {
  it('assigns uids from uid, name and a synthetic counter', () => {
    const nodes: LayoutNode[] = [
      { type: 'field', uid: 'explicit' },
      { type: 'field', name: 'named' },
      { type: 'draw' },
    ];
    stampUids([nodes]);
    expect(nodes.map((node) => node.uid)).toEqual(['explicit', 'named', 'node0']);
  });

  it('suffixes duplicates with an incrementing number', () => {
    const nodes: LayoutNode[] = [
      field('dup'),
      field('dup'),
      { type: 'field', uid: 'dup' },
      field('dup'),
    ];
    stampUids([nodes]);
    expect(nodes.map((node) => node.uid)).toEqual(['dup', 'dup#2', 'dup#3', 'dup#4']);
  });

  it('walks subform and exclusion-group children across forests', () => {
    const subform: LayoutNode = {
      type: 'subform',
      name: 'group',
      children: [field('inner'), { type: 'exclGroup', name: 'excl', children: [field('inner')] }],
    };
    const otherRoot: LayoutNode = {
      type: 'exclGroup',
      name: 'group',
      children: [field('inner')],
    };
    stampUids([[subform], [otherRoot]]);
    expect(subform.uid).toBe('group');
    expect(otherRoot.uid).toBe('group#2');
    const subformChildren = (subform as { children: LayoutNode[] }).children;
    expect(subformChildren[0].uid).toBe('inner');
    const excl = subformChildren[1] as { uid: string; children: LayoutNode[] };
    expect(excl.uid).toBe('excl');
    expect(excl.children[0].uid).toBe('inner#2');
    const otherChildren = (otherRoot as { children: LayoutNode[] }).children;
    expect(otherChildren[0].uid).toBe('inner#3');
  });

  it('keeps distinct uids unique when a base already contains a suffix', () => {
    const nodes: LayoutNode[] = [field('dup', 'dup#2'), field('dup')];
    stampUids([nodes]);
    expect(nodes.map((node) => node.uid)).toEqual(['dup#2', 'dup']);
  });
});
