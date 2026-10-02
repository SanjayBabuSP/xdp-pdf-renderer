// ────────────────────────────────────────────────────────────────────────────
// XFA DOM Event Bubbling Model — Event propagation and handling
// Implements the XFA event lifecycle matching Adobe LiveCycle Designer.
//
// XFA fires events on a target node and, for a documented subset, lets them
// *bubble* to enclosing containers. The propagation itself is generic: the
// scripting dispatcher registers one handler per (node, event) and this
// dispatcher walks target → root running whatever is registered.
// ────────────────────────────────────────────────────────────────────────────

import type { XfaNode, XfaEventName } from '../domain/scripting/script-types';

export type EventPhase = 'capture' | 'target' | 'bubble';

export interface XfaEvent<T = XfaNode> {
  /** Event name */
  name: string;
  /** Target node that triggered the event */
  target: T;
  /** Current node processing the event (changes while bubbling) */
  currentTarget: T;
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

export type EventHandler<T = XfaNode> = (event: XfaEvent<T>) => void;

/**
 * XFA event dispatcher implementing DOM-style propagation over an arbitrary
 * node type (the scripting dispatcher instantiates it with `ScriptableNode`).
 *
 * Order (matching Adobe LiveCycle):
 *   1. Capture phase: root → target (top-down) — only `capture` listeners.
 *   2. Target phase: all listeners on the target.
 *   3. Bubble phase: target → root (bottom-up) — only `bubble` listeners, and
 *      only when the event is a bubbling event.
 */
export class XfaEventDispatcher<T = XfaNode> {
  private listeners = new Map<string, Array<{ node: T; handler: EventHandler<T>; capture: boolean; priority: number }>>();

  /** @param parentProvider - returns a node's parent, or null at the root */
  constructor(private parentProvider: (node: T) => T | null = () => null) {}

  addEventListener(
    node: T,
    eventName: string,
    handler: EventHandler<T>,
    options: { capture?: boolean; priority?: number } = {},
  ): void {
    const key = String(eventName);
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key)!.push({
      node,
      handler,
      capture: options.capture ?? false,
      priority: options.priority ?? 0,
    });
  }

  removeEventListener(node: T, eventName: string, handler: EventHandler<T>): void {
    const list = this.listeners.get(String(eventName));
    if (!list) return;
    const idx = list.findIndex((l) => l.node === node && l.handler === handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /**
   * Dispatch an event at `target`. Returns `true` unless a handler called
   * `preventDefault()`. Propagation is governed by the event's
   * `propagationStopped` flag, which handlers may set.
   */
  dispatch(target: T, eventName: string, data?: unknown): boolean {
    const event: XfaEvent<T> = {
      name: String(eventName),
      target,
      currentTarget: target,
      phase: 'target',
      propagationStopped: false,
      defaultPrevented: false,
      handled: false,
      timestamp: Date.now(),
      data,
    };

    const chain = this.propagationChain(target);
    const bubbles = eventBubbles(event.name);

    // 1. Capture phase (root → target), capture listeners only.
    for (const node of chain) {
      if (event.propagationStopped) break;
      this.run(node, event, 'capture', true);
    }

    // 2. Target phase — every listener on the target.
    if (!event.propagationStopped) {
      this.run(target, event, 'target', false);
    }

    // 3. Bubble phase (parent → root) for bubbling events.
    if (bubbles && !event.propagationStopped) {
      for (let i = chain.length - 2; i >= 0; i--) {
        if (event.propagationStopped) break;
        this.run(chain[i], event, 'bubble', false);
      }
    }

    return !event.defaultPrevented;
  }

  private run(
    node: T,
    event: XfaEvent<T>,
    phase: EventPhase,
    captureOnly: boolean,
  ): void {
    const candidates = (this.listeners.get(event.name) ?? [])
      .filter((l) => l.node === node)
      .filter((l) => (captureOnly ? l.capture : phase === 'target' ? true : !l.capture))
      .sort((a, b) => b.priority - a.priority);
    for (const listener of candidates) {
      if (event.propagationStopped) break;
      event.currentTarget = node;
      event.phase = phase;
      listener.handler(event);
    }
  }

  private propagationChain(target: T): T[] {
    const chain: T[] = [];
    let node: T | null = target;
    while (node) {
      chain.unshift(node);
      node = this.parentProvider(node);
    }
    return chain;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Create an XfaEvent object.
 */
export function createXfaEvent<T = XfaNode>(name: string, target: T, data?: unknown): XfaEvent<T> {
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
  INITIALIZE: 'initialize',
  CALCULATE: 'calculate',
  VALIDATE: 'validate',
  CLICK: 'click',
  CHANGE: 'change',
  ENTER: 'enter',
  EXIT: 'exit',
  FORM_READY: 'ready',
  DOC_READY: 'docReady',
  PAGE_OPEN: 'pageOpen',
  PAGE_CLOSE: 'pageClose',
  PRE_SAVE: 'preSave',
  POST_SAVE: 'postSave',
  PRE_SIGN: 'preSign',
  POST_SIGN: 'postSign',
  PRE_PRINT: 'prePrint',
  POST_PRINT: 'postPrint',
  PRE_EXECUTE: 'preExecute',
  POST_EXECUTE: 'postExecute',
} as const;

/** Events that bubble up the XFA tree (target → ancestors). */
export const BUBBLING_EVENTS: ReadonlySet<string> = new Set<string>([
  'click',
  'change',
  'enter',
  'exit',
  'preExecute',
  'postExecute',
  'preSave',
  'postSave',
]);

/** Events that do NOT bubble (fire only on the target node). */
export const NON_BUBBLING_EVENTS: ReadonlySet<string> = new Set<string>([
  'initialize',
  'indexChange',
  'calculate',
  'validate',
  'overlay',
  'ready',
  'form:ready',
  'layout:ready',
  'docReady',
  'docOpen',
  'docClose',
  'pageOpen',
  'pageClose',
  'prePrint',
  'postPrint',
  'preSign',
  'postSign',
]);

/** Whether an event propagates to ancestor nodes. */
export function eventBubbles(eventName: string): boolean {
  return BUBBLING_EVENTS.has(eventName);
}

export type { XfaEventName };
