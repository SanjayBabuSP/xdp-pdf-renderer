import { LayoutNode, PresenceValue, RgbColor } from '../../types';
import { ScriptableNode } from './script-types';
import { parseStyleColor } from './xfa-object-model';

export interface PropertyChange {
  nodePath: string;
  property: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export class PropertyChangeTracker {
  private changes: PropertyChange[] = [];
  private nodeSnapshots = new Map<string, Map<string, unknown>>();

  snapshot(path: string, node: ScriptableNode): void {
    const props = new Map<string, unknown>();
    props.set('resolvedValue', node.resolvedValue);
    props.set('presence', node.presence);
    props.set('access', node.access);
    props.set('fillColor', node.fillColor ?? null);
    props.set('fontColor', node.fontColor ?? null);
    props.set('borderColor', node.borderColor ?? null);
    this.nodeSnapshots.set(path, props);
  }

  recordChange(path: string, property: string, oldValue: unknown, newValue: unknown): void {
    this.changes.push({
      nodePath: path,
      property,
      oldValue,
      newValue,
      timestamp: Date.now(),
    });
  }

  detectChanges(path: string, node: ScriptableNode): void {
    const snapshot = this.nodeSnapshots.get(path);
    if (!snapshot) return;

    const currentValue = node.resolvedValue;
    const currentPresence = node.presence;
    const currentAccess = node.access;

    const snapValue = snapshot.get('resolvedValue');
    const snapPresence = snapshot.get('presence');
    const snapAccess = snapshot.get('access');

    if (currentValue !== snapValue) {
      this.recordChange(path, 'resolvedValue', snapValue, currentValue);
    }
    if (currentPresence !== snapPresence) {
      this.recordChange(path, 'presence', snapPresence, currentPresence);
    }
    if (currentAccess !== snapAccess) {
      this.recordChange(path, 'access', snapAccess, currentAccess);
    }
    for (const prop of ['fillColor', 'fontColor', 'borderColor'] as const) {
      const cur = (node as unknown as Record<string, unknown>)[prop] ?? null;
      if (cur !== snapshot.get(prop)) {
        this.recordChange(path, prop, snapshot.get(prop), cur);
      }
    }
  }

  applyByIdentity(nodes: ScriptableNode[]): ApplyResult {
    const result: ApplyResult = {
      valuesChanged: 0,
      presenceChanged: 0,
      accessChanged: 0,
      layoutDirty: false,
    };

    for (const scriptable of nodes) {
      const snapshot = this.nodeSnapshots.get(this.keyOf(scriptable));
      if (!snapshot) continue;
      const layoutNode = scriptable.layoutNode as LayoutNode | undefined;
      if (!layoutNode) continue;

      if (scriptable.resolvedValue !== snapshot.get('resolvedValue')) {
        (layoutNode as { resolvedValue?: unknown }).resolvedValue = scriptable.resolvedValue;
        result.valuesChanged++;
      }
      if (scriptable.presence !== snapshot.get('presence')) {
        (layoutNode as { presence?: PresenceValue }).presence =
          scriptable.presence as PresenceValue;
        result.presenceChanged++;
        result.layoutDirty = true;
      }
      if (scriptable.access !== snapshot.get('access')) {
        (layoutNode as { access?: string }).access = scriptable.access;
        result.accessChanged++;
      }
      for (const prop of ['fillColor', 'fontColor', 'borderColor'] as const) {
        const cur = (scriptable as unknown as Record<string, unknown>)[prop] ?? null;
        if (cur !== snapshot.get(prop) && typeof cur === 'string') {
          const parsed = parseStyleColor(cur);
          if (parsed) {
            applyStyleToLayout(layoutNode, prop, parsed);
            result.valuesChanged++;
            if (prop !== 'fontColor') result.layoutDirty = true;
          }
        }
      }
    }

    return result;
  }

  private keyOf(scriptable: ScriptableNode): string {
    return scriptable.key ?? scriptable.path ?? scriptable.name ?? '';
  }

  getChanges(): ReadonlyArray<PropertyChange> {
    return this.changes;
  }

  getChangesForNode(path: string): PropertyChange[] {
    return this.changes.filter((c) => c.nodePath === path);
  }

  hasPresenceChanges(): boolean {
    return this.changes.some((c) => c.property === 'presence');
  }

  hasValueChanges(): boolean {
    return this.changes.some((c) => c.property === 'resolvedValue');
  }

  reset(): void {
    this.changes = [];
    this.nodeSnapshots.clear();
  }
}

export interface ApplyResult {
  valuesChanged: number;
  presenceChanged: number;
  accessChanged: number;
  layoutDirty: boolean;
}

function applyStyleToLayout(
  layoutNode: LayoutNode,
  prop: 'fillColor' | 'fontColor' | 'borderColor',
  color: RgbColor
): void {
  const ln = layoutNode as unknown as Record<string, unknown>;
  if (prop === 'fontColor') {
    const font = (ln.font as Record<string, unknown> | undefined) ?? {};
    font.color = color;
    ln.font = font;
    return;
  }
  if (prop === 'fillColor') {
    const border = (ln.border as Record<string, unknown> | undefined) ?? {};
    const fill = (border.fill as Record<string, unknown> | undefined) ?? {};
    fill.color = color;
    if (fill.presence === 'hidden' || fill.presence === 'invisible') delete fill.presence;
    border.fill = fill;
    ln.border = border;
    return;
  }
  const border = (ln.border as Record<string, unknown> | undefined) ?? {};
  const edges = border.edges as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(edges) && edges.length) {
    for (const e of edges) {
      if (e && typeof e === 'object') {
        e.color = color;
        if (e.presence === 'hidden' || e.presence === 'invisible') delete e.presence;
      }
    }
  } else {
    border.edges = [{ color }];
  }
  ln.border = border;
}
