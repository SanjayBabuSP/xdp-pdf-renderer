// ────────────────────────────────────────────────────────────────────────────
// XFA DOM Event Bubbling Model — Event propagation and handling
// Implements the XFA event lifecycle matching Adobe LiveCycle Designer
// ────────────────────────────────────────────────────────────────────────────

import { XfaNode, XfaEventName } from '../domain/scripting/script-types';

export type EventPhase = 'capture' | 'target' | 'bubble';

export interface XfaEvent {
  /** Event name */
  name: XfaEventName;
  /** Target node that triggered the event */
  target: XfaNode;
  /** Current node processing the event */
  currentTarget: XfaNode;
  /** Event phase */
  phase: EventPhase;
  /** Whether event propagation is stopped */
  propagationStopped: boolean;
  /** Whether default behavior is prevented */
  defaultPrevented: boolean;
  /** Whether the event was already handled */
  handled: boolean;
  /** Event timestamp */
  timestamp: number;
  /** Custom event data */
  data?: unknown;
}

export type EventHandler = (event: XfaEvent) => void;

/**
 * Event target interface for XFA nodes.
 * Supports addEventListener/removeEventListener with capture/bubble phases.
 */
export interface EventTarget {
  addEventListener(
    eventName: XfaEventName,
    handler: EventHandler,
    options?: { capture?: boolean; priority?: number }
  ): void;
  removeEventListener(
    eventName: XfaEventName,
    handler: EventHandler,
    options?: { capture?: boolean }
  ): void;
  dispatchEvent(event: XfaEvent): boolean;
}

/**
 * XFA Event Dispatcher implementing DOM-style event bubbling.
 * Events propagate from target → parent (bubble) or parent → target (capture).
 *
 * Event propagation order (matching Adobe LiveCycle):
 * 1. Capture phase: root → target (top-down)
 * 2. Target phase: handlers on the target node
 * 3. Bubble phase: target → root (bottom-up)
 *
 * Events with no capture/bubble behavior fire only on the target.
 */
export class XfaEventDispatcher implements EventTarget {
  private listeners = new Map<string, Array<{ handler: EventHandler; capture: boolean; priority: number }>>();
  private eventTarget: XfaNode | null = null;
  private parentProvider: ((node: XfaNode) => XfaNode | null) | null = null;

  /**
   * @param parentProvider - Function to get a node's parent (for bubbling)
   */
  constructor(parentProvider?: (node: XfaNode) => XfaNode | null) {
    this.parentProvider = parentProvider ?? (() => null);
  }

  /**
   * Set the target node for this event target.
   */
  setTarget(node: XfaNode): void {
    this.eventTarget = node;
  }

  addEventListener(
    eventName: XfaEventName,
    handler: EventHandler,
    options: { capture?: boolean; priority?: number } = {}
  ): void {
    const key = String(eventName);
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key)!.push({
      handler,
      capture: options.capture ?? false,
      priority: options.priority ?? 0,
    });
  }

  removeEventListener(
    eventName: XfaEventName,
    handler: EventHandler,
    options: { capture?: boolean } = {}
  ): void {
    const key = String(eventName);
    const list = this.listeners.get(key);
    if (!list) return;
    const capture = options.capture ?? false;
    const idx = list.findIndex((l) => l.handler === handler && l.capture === capture);
    if (idx >= 0) list.splice(idx, 1);
  }

  dispatchEvent(event: XfaEvent): boolean {
    if (event.propagationStopped) return false;

    // Build the propagation chain
    const chain: XfaNode[] = [];
    let node: XfaNode | null = this.eventTarget;
    while (node) {
      chain.unshift(node);
      node = this.parentProvider ? this.parentProvider(node) : null;
    }

    // 1. Capture phase (root → target)
    for (const chainNode of chain) {
      if (event.propagationStopped) break;
      const handlers = this.getHandlersForPhase(chainNode, String(event.name), 'capture');
      for (const h of handlers) {
        if (event.propagationStopped) break;
        event.currentTarget = chainNode;
        event.phase = 'capture';
        h.handler(event);
      }
    }

    // 2. Target phase
    if (!event.propagationStopped) {
      const handlers = this.getHandlersForPhase(this.eventTarget!, String(event.name), 'target');
      for (const h of handlers) {
        if (event.propagationStopped) break;
        event.currentTarget = this.eventTarget!;
        event.phase = 'target';
        h.handler(event);
      }
    }

    // 3. Bubble phase (target → root)
    for (let i = chain.length - 1; i >= 0; i--) {
      if (event.propagationStopped) break;
      const chainNode = chain[i];
      const handlers = this.getHandlersForPhase(chainNode, String(event.name), 'bubble');
      for (const h of handlers) {
        if (event.propagationStopped) break;
        event.currentTarget = chainNode;
        event.phase = 'bubble';
        h.handler(event);
      }
    }

    return !event.defaultPrevented;
  }

  private getHandlersForPhase(
    node: XfaNode,
    eventName: string,
    phase: 'capture' | 'target' | 'bubble'
  ): Array<{ handler: EventHandler; priority: number }> {
    const list = this.listeners.get(eventName) ?? [];
    return list
      .filter((l) => {
        if (phase === 'target') return true; // All handlers fire on target
        if (phase === 'capture') return l.capture;
        return !l.capture; // Bubble handlers
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Clear all event listeners.
   */
  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Create an XfaEvent object.
 */
export function createXfaEvent(
  name: XfaEventName,
  target: XfaNode,
  data?: unknown
): XfaEvent {
  return {
    name,
    target,
    currentTarget: target,
    phase: 'target',
    propagationStopped: false,
    defaultPrevented: false,
    handled: false,
    timestamp: Date.now(),
    data,
  };
}

/**
 * Pre-defined XFA events matching Adobe LiveCycle Designer.
 */
export const XFA_EVENTS = {
  INITIALIZE: 'initialize' as const,
  CALCULATE: 'calculate' as const,
  VALIDATE: 'validate' as const,
  CLICK: 'click' as const,
  CHANGE: 'change' as const,
  ENTER: 'enter' as const,
  EXIT: 'exit' as const,
  FORM_READY: 'ready' as const,
  DOC_READY: 'docReady' as const,
  PAGE_OPEN: 'pageOpen' as const,
  PAGE_CLOSE: 'pageClose' as const,
  PRE_SAVE: 'preSave' as const,
  POST_SAVE: 'postSave' as const,
  PRE_SIGN: 'preSign' as const,
  POST_SIGN: 'postSign' as const,
  PRE_PRINT: 'prePrint' as const,
  POST_PRINT: 'postPrint' as const,
  PRE_EXECUTE: 'preExecute' as const,
  POST_EXECUTE: 'postExecute' as const,
} as const;

/**
 * Events that bubble up the XFA tree.
 */
export const BUBBLING_EVENTS = new Set<string>([
  'click',
  'change',
  'enter',
  'exit',
  'preExecute',
  'postExecute',
  'preSave',
  'postSave',
]);

/**
 * Events that do NOT bubble (fire only on target).
 */
export const NON_BUBBLING_EVENTS = new Set<string>([
  'initialize',
  'calculate',
  'validate',
  'ready',
  'docReady',
  'pageOpen',
  'pageClose',
  'prePrint',
  'postPrint',
  'preSign',
  'postSign',
]);
