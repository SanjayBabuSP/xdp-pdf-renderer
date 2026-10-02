// ────────────────────────────────────────────────────────────────────────────
// Property Change Tracker — Tracks script-driven mutations to XFA nodes
//
// Reference: xfa.dll + xfaform.dll (property change propagation)
// When scripts modify node properties (presence, access, value, etc.),
// these changes must flow back to the LayoutModel for correct rendering.
// ────────────────────────────────────────────────────────────────────────────

import { LayoutModel, LayoutNode, PresenceValue } from '../../types';
import { ScriptableNode } from './script-types';

// ─── Property Change Record ────────────────────────────────────────────

export interface PropertyChange {
  /** SOM path of the node */
  nodePath: string;
  /** Property name that changed */
  property: string;
  /** Value before the change */
  oldValue: unknown;
  /** Value after the change */
  newValue: unknown;
  /** Timestamp of the change */
  timestamp: number;
}

/**
 * Tracks property mutations during script execution and applies them
 * back to the LayoutModel.
 */
export class PropertyChangeTracker {
  private changes: PropertyChange[] = [];
  private nodeSnapshots = new Map<string, Map<string, unknown>>();

  /**
   * Snapshot the current state of a node before scripts run.
   */
  snapshot(path: string, node: ScriptableNode): void {
    const props = new Map<string, unknown>();
    props.set('resolvedValue', node.resolvedValue);
    props.set('presence', node.presence);
    props.set('access', node.access);
    this.nodeSnapshots.set(path, props);
  }

  /**
   * Record a property change.
   */
  recordChange(path: string, property: string, oldValue: unknown, newValue: unknown): void {
    this.changes.push({
      nodePath: path,
      property,
      oldValue,
      newValue,
      timestamp: Date.now(),
    });
  }

  /**
   * Compare current node state against snapshot and record any differences.
   */
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
  }

  /**
   * Apply all tracked changes back onto the layout tree.
   *
   * Identity-based: every ScriptableNode carries a reference to the exact
   * LayoutNode it mirrors (`layoutNode`), so a `presence`/`resolvedValue`
   * change made against one scriptable can never leak onto a same-named
   * sibling. Only the properties that actually changed are written.
   */
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

      // Deliberately NOT guarded by `prop in layoutNode`: the parser only
      // creates optional keys it actually saw in the XDP, so a field with no
      // declared `presence` has no `presence` key at all — and that is exactly
      // the case a `$.presence = "hidden"` script needs to write.
      if (scriptable.resolvedValue !== snapshot.get('resolvedValue')) {
        (layoutNode as { resolvedValue?: unknown }).resolvedValue = scriptable.resolvedValue;
        result.valuesChanged++;
      }
      if (scriptable.presence !== snapshot.get('presence')) {
        (layoutNode as { presence?: PresenceValue }).presence =
          scriptable.presence as PresenceValue;
        result.presenceChanged++;
        result.layoutDirty = true; // Presence changes affect layout
      }
      if (scriptable.access !== snapshot.get('access')) {
        (layoutNode as { access?: string }).access = scriptable.access;
        result.accessChanged++;
      }
    }

    return result;
  }

  private keyOf(scriptable: ScriptableNode): string {
    return scriptable.key ?? scriptable.path ?? scriptable.name ?? '';
  }

  /**
   * Get all changes recorded.
   */
  getChanges(): ReadonlyArray<PropertyChange> {
    return this.changes;
  }

  /**
   * Get changes for a specific node path.
   */
  getChangesForNode(path: string): PropertyChange[] {
    return this.changes.filter((c) => c.nodePath === path);
  }

  /**
   * Check if any presence changes were made (requires re-layout).
   */
  hasPresenceChanges(): boolean {
    return this.changes.some((c) => c.property === 'presence');
  }

  /**
   * Check if any value changes were made.
   */
  hasValueChanges(): boolean {
    return this.changes.some((c) => c.property === 'resolvedValue');
  }

  /**
   * Reset the tracker for a new execution cycle.
   */
  reset(): void {
    this.changes = [];
    this.nodeSnapshots.clear();
  }
}

// ─── Apply Result ───────────────────────────────────────────────────────

export interface ApplyResult {
  /** Number of value (resolvedValue) changes applied */
  valuesChanged: number;
  /** Number of presence changes applied */
  presenceChanged: number;
  /** Number of access changes applied */
  accessChanged: number;
  /** Whether layout needs recalculation (presence or position changes) */
  layoutDirty: boolean;
}
