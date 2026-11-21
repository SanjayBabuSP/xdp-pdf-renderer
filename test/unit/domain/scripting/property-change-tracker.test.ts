import { PropertyChangeTracker } from '../../../../src/domain/scripting/property-change-tracker';
import type { ScriptableNode } from '../../../../src/domain/scripting/script-types';
import type { FieldNode, RgbColor } from '../../../../src/types';

function makeNode(name: string, layoutNode?: FieldNode): ScriptableNode {
  return {
    type: 'field',
    name,
    key: name,
    path: name,
    layoutNode,
    presence: 'visible',
    access: 'open',
    resolvedValue: 'initial',
    children: [],
  };
}

function colors(node: object): {
  font?: { color?: RgbColor };
  border?: {
    fill?: { color?: RgbColor; presence?: string };
    edges?: Array<Record<string, unknown>>;
  };
} {
  return node as {
    font?: { color?: RgbColor };
    border?: {
      fill?: { color?: RgbColor; presence?: string };
      edges?: Array<Record<string, unknown>>;
    };
  };
}

describe('PropertyChangeTracker — detection and queries', () => {
  it('records explicit changes and filters them by node and property', () => {
    const tracker = new PropertyChangeTracker();
    tracker.recordChange('a', 'presence', 'visible', 'hidden');
    tracker.recordChange('b', 'resolvedValue', 1, 2);

    expect(tracker.getChanges()).toHaveLength(2);
    expect(tracker.getChangesForNode('a')).toEqual([
      {
        nodePath: 'a',
        property: 'presence',
        oldValue: 'visible',
        newValue: 'hidden',
        timestamp: expect.any(Number),
      },
    ]);
    expect(tracker.getChangesForNode('missing')).toEqual([]);
    expect(tracker.hasPresenceChanges()).toBe(true);
    expect(tracker.hasValueChanges()).toBe(true);
  });

  it('reports false for absent change kinds and clears all state on reset', () => {
    const tracker = new PropertyChangeTracker();
    expect(tracker.hasPresenceChanges()).toBe(false);
    expect(tracker.hasValueChanges()).toBe(false);

    const node = makeNode('a');
    tracker.snapshot('a', node);
    tracker.recordChange('a', 'presence', 'visible', 'hidden');
    tracker.reset();

    expect(tracker.getChanges()).toEqual([]);
    expect(tracker.getChangesForNode('a')).toEqual([]);
    expect(tracker.hasPresenceChanges()).toBe(false);
    const applied = tracker.applyByIdentity([node]);
    expect(applied).toEqual({
      valuesChanged: 0,
      presenceChanged: 0,
      accessChanged: 0,
      layoutDirty: false,
    });
  });

  it('detects value, presence, access and style differences against a snapshot', () => {
    const tracker = new PropertyChangeTracker();
    const node = makeNode('a');
    tracker.snapshot('a', node);
    tracker.detectChanges('a', node);
    expect(tracker.getChanges()).toEqual([]);

    node.resolvedValue = 'changed';
    node.presence = 'hidden';
    node.access = 'protected';
    node.fillColor = '255,0,0';
    node.fontColor = '0,0,0';
    node.borderColor = '1,2,3';
    tracker.detectChanges('a', node);

    expect(tracker.getChanges().map((change) => change.property)).toEqual([
      'resolvedValue',
      'presence',
      'access',
      'fillColor',
      'fontColor',
      'borderColor',
    ]);
    expect(tracker.getChanges()[0]).toMatchObject({
      nodePath: 'a',
      oldValue: 'initial',
      newValue: 'changed',
    });
  });

  it('ignores detection for a path without a snapshot', () => {
    const tracker = new PropertyChangeTracker();
    tracker.detectChanges('unknown', makeNode('a'));
    expect(tracker.getChanges()).toEqual([]);
  });
});

describe('PropertyChangeTracker — identity application', () => {
  it('writes changed values, presence and access onto the matching layout node', () => {
    const layout = { type: 'field', name: 'a' } as FieldNode;
    const node = makeNode('a', layout);
    const tracker = new PropertyChangeTracker();
    tracker.snapshot(node.key!, node);

    node.resolvedValue = 'next';
    node.presence = 'hidden';
    node.access = 'protected';
    const result = tracker.applyByIdentity([node]);

    expect(result).toEqual({
      valuesChanged: 1,
      presenceChanged: 1,
      accessChanged: 1,
      layoutDirty: true,
    });
    expect((layout as unknown as Record<string, unknown>).resolvedValue).toBe('next');
    expect(layout.presence).toBe('hidden');
    expect(layout.access).toBe('protected');
  });

  it('uses key, then path, then name as the snapshot identity', () => {
    const tracker = new PropertyChangeTracker();
    const byPath: ScriptableNode = {
      type: 'field',
      path: 'p',
      name: 'n',
      layoutNode: { type: 'field' },
      presence: 'visible',
    };
    const byName: ScriptableNode = {
      type: 'field',
      name: 'n2',
      layoutNode: { type: 'field' },
      presence: 'visible',
    };
    tracker.snapshot('p', byPath);
    tracker.snapshot('n2', byName);
    byPath.presence = 'hidden';
    byName.presence = 'hidden';

    const result = tracker.applyByIdentity([byPath, byName]);
    expect(result.presenceChanged).toBe(2);
  });

  it('skips nodes without a snapshot and without a layout node', () => {
    const tracker = new PropertyChangeTracker();
    const noLayout: ScriptableNode = { type: 'field', key: 'k', resolvedValue: 'x' };
    const noSnapshot: ScriptableNode = {
      type: 'field',
      key: 'other',
      layoutNode: { type: 'field' },
    };
    expect(tracker.applyByIdentity([noLayout, noSnapshot])).toEqual({
      valuesChanged: 0,
      presenceChanged: 0,
      accessChanged: 0,
      layoutDirty: false,
    });
  });

  it('applies font, fill and border colors and clears hidden fill/edge presence', () => {
    const layout = {
      type: 'field',
      border: {
        fill: { color: { r: 0, g: 0, b: 0 }, presence: 'hidden' },
        edges: [{ color: { r: 0, g: 0, b: 0 }, presence: 'invisible' }],
      },
    } as unknown as FieldNode;
    const node = makeNode('a', layout);
    const tracker = new PropertyChangeTracker();
    tracker.snapshot('a', node);

    node.fontColor = '#102030';
    node.fillColor = '40,50,60';
    node.borderColor = '70,80,90';
    const result = tracker.applyByIdentity([node]);

    expect(result.valuesChanged).toBe(3);
    expect(result.layoutDirty).toBe(true);
    expect(colors(layout).font?.color).toEqual({ r: 0x10, g: 0x20, b: 0x30 });
    expect(colors(layout).border?.fill?.color).toEqual({ r: 40, g: 50, b: 60 });
    expect('presence' in (colors(layout).border?.fill ?? {})).toBe(false);
    expect(colors(layout).border?.edges?.[0].color).toEqual({ r: 70, g: 80, b: 90 });
    expect('presence' in (colors(layout).border?.edges?.[0] ?? {})).toBe(false);
  });

  it('creates color containers when the layout node has none', () => {
    const layout = { type: 'field' } as FieldNode;
    const node = makeNode('a', layout);
    const tracker = new PropertyChangeTracker();
    tracker.snapshot('a', node);

    node.fontColor = '1,2,3';
    node.fillColor = '4,5,6';
    node.borderColor = '7,8,9';
    expect(tracker.applyByIdentity([node]).valuesChanged).toBe(3);
    expect(colors(layout).font?.color).toEqual({ r: 1, g: 2, b: 3 });
    expect(colors(layout).border?.fill?.color).toEqual({ r: 4, g: 5, b: 6 });
    expect(colors(layout).border?.edges).toEqual([{ color: { r: 7, g: 8, b: 9 } }]);
  });

  it('ignores non-string and unparseable color changes', () => {
    const layout = { type: 'field' } as FieldNode;
    const node = makeNode('a', layout);
    const tracker = new PropertyChangeTracker();
    tracker.snapshot('a', node);

    node.fillColor = undefined;
    (node as unknown as Record<string, unknown>).borderColor = 123;
    node.fontColor = 'not-a-color';
    expect(tracker.applyByIdentity([node].map((n) => n))).toEqual({
      valuesChanged: 0,
      presenceChanged: 0,
      accessChanged: 0,
      layoutDirty: false,
    });
  });
});
