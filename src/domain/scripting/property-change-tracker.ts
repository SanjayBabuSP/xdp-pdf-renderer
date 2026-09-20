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
   * Apply all tracked changes back to the LayoutModel.
   * This is called after script execution to update the rendering tree.
   */
  applyChangesToLayout(layout: LayoutModel): ApplyResult {
    const result: ApplyResult = {
      valuesChanged: 0,
      presenceChanged: 0,
      accessChanged: 0,
      layoutDirty: false,
    };

    if (this.changes.length === 0) return result;

    // Group changes by node path
    const changesByPath = new Map<string, PropertyChange[]>();
    for (const change of this.changes) {
      if (!changesByPath.has(change.nodePath)) {
        changesByPath.set(change.nodePath, []);
      }
      changesByPath.get(change.nodePath)!.push(change);
    }

    // Walk the layout tree and apply changes
    function walkNodes(nodes: LayoutNode[], parentPath: string) {
      for (const node of nodes) {
        const name = node.name ?? '';
        const path = parentPath ? `${parentPath}.${name}` : name;

        const nodeChanges = changesByPath.get(path);
        if (nodeChanges) {
          for (const change of nodeChanges) {
            applyChangeToNode(node, change, result);
          }
        }

        // Also try matching by terminal name (for path mismatches)
        if (!nodeChanges && name) {
          for (const [changePath, changes] of changesByPath) {
            if (changePath.endsWith(`.${name}`) || changePath === name) {
              for (const change of changes) {
                applyChangeToNode(node, change, result);
              }
              break;
            }
          }
        }

        if (node.type === 'subform') {
          walkNodes(node.children, path);
        } else if (node.type === 'exclGroup') {
          walkNodes(node.children, path);
        }
      }
    }

    walkNodes(layout.children, '');
    for (const page of layout.pages) {
      walkNodes(page.masterPageChildren, '');
    }

    return result;
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

// ─── Internal Helpers ───────────────────────────────────────────────────

function applyChangeToNode(
  node: LayoutNode,
  change: PropertyChange,
  result: ApplyResult
): void {
  switch (change.property) {
    case 'resolvedValue':
      if ('resolvedValue' in node) {
        (node as { resolvedValue?: unknown }).resolvedValue = change.newValue;
        result.valuesChanged++;
      }
      break;

    case 'presence':
      if ('presence' in node) {
        (node as { presence?: PresenceValue }).presence = change.newValue as PresenceValue;
        result.presenceChanged++;
        result.layoutDirty = true; // Presence changes affect layout
      }
      break;

    case 'access':
      if ('access' in node) {
        (node as { access?: string }).access = change.newValue as string;
        result.accessChanged++;
      }
      break;
  }
}
