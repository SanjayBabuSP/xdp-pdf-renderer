import type { XfaNode, XfaEventName } from '../domain/scripting/script-types';

export type EventPhase = 'capture' | 'target' | 'bubble';

export interface XfaEvent<T = XfaNode> {
  name: string;
  target: T;
  currentTarget: T;
  phase: EventPhase;
  propagationStopped: boolean;
  defaultPrevented: boolean;
  handled: boolean;
  timestamp: number;
  data?: unknown;
}

export type EventHandler<T = XfaNode> = (event: XfaEvent<T>) => void;

export class XfaEventDispatcher<T = XfaNode> {
  private listeners = new Map<
    string,
    Array<{ node: T; handler: EventHandler<T>; capture: boolean; priority: number }>
  >();

  constructor(private parentProvider: (node: T) => T | null = () => null) {}

  addEventListener(
    node: T,
    eventName: string,
    handler: EventHandler<T>,
    options: { capture?: boolean; priority?: number } = {}
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

    for (const node of chain) {
      if (event.propagationStopped) break;
      this.run(node, event, 'capture', true);
    }

    if (!event.propagationStopped) {
      this.run(target, event, 'target', false);
    }

    if (bubbles && !event.propagationStopped) {
      for (let i = chain.length - 2; i >= 0; i--) {
        if (event.propagationStopped) break;
        this.run(chain[i], event, 'bubble', false);
      }
    }

    return !event.defaultPrevented;
  }

  private run(node: T, event: XfaEvent<T>, phase: EventPhase, captureOnly: boolean): void {
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

export function eventBubbles(eventName: string): boolean {
  return BUBBLING_EVENTS.has(eventName);
}

export type { XfaEventName };
