import { XfaEventDispatcher, eventBubbles, BUBBLING_EVENTS, NON_BUBBLING_EVENTS } from '../../../src/adobe/xfa-event-bubbling';

/**
 * G3 — the XFA event propagation model. The dispatcher is generic over node
 * type; these tests use strings to make the propagation order obvious.
 */

const parents: Record<string, string | null> = {
  root: null,
  container: 'root',
  field: 'container',
};
const getParent = (node: string): string | null => parents[node] ?? null;

describe('G3 — XfaEventDispatcher propagation', () => {
  it('bubbles target → ancestors for bubbling events', () => {
    const order: string[] = [];
    const d = new XfaEventDispatcher<string>(getParent);
    d.addEventListener('field', 'click', () => order.push('field'));
    d.addEventListener('container', 'click', () => order.push('container'));
    d.addEventListener('root', 'click', () => order.push('root'));

    d.dispatch('field', 'click');
    expect(order).toEqual(['field', 'container', 'root']);
  });

  it('fires only the target for non-bubbling events', () => {
    const order: string[] = [];
    const d = new XfaEventDispatcher<string>(getParent);
    d.addEventListener('field', 'calculate', () => order.push('field'));
    d.addEventListener('container', 'calculate', () => order.push('container'));

    d.dispatch('field', 'calculate');
    expect(order).toEqual(['field']);
  });

  it('runs capture listeners root → target before the target phase', () => {
    const order: string[] = [];
    const d = new XfaEventDispatcher<string>(getParent);
    d.addEventListener('container', 'click', () => order.push('capture-container'), { capture: true });
    d.addEventListener('field', 'click', () => order.push('target-field'));
    d.addEventListener('container', 'click', () => order.push('bubble-container'));

    d.dispatch('field', 'click');
    expect(order).toEqual(['capture-container', 'target-field', 'bubble-container']);
  });

  it('stopPropagation halts the bubble phase', () => {
    const order: string[] = [];
    const d = new XfaEventDispatcher<string>(getParent);
    d.addEventListener('field', 'click', (e) => {
      order.push('field');
      e.propagationStopped = true;
    });
    d.addEventListener('container', 'click', () => order.push('container'));

    d.dispatch('field', 'click');
    expect(order).toEqual(['field']);
  });

  it('preventDefault makes dispatch return false', () => {
    const d = new XfaEventDispatcher<string>(getParent);
    d.addEventListener('field', 'click', (e) => {
      e.defaultPrevented = true;
    });
    expect(d.dispatch('field', 'click')).toBe(false);
  });

  it('reports phase and currentTarget while dispatching', () => {
    const seen: Array<[string, string]> = [];
    const d = new XfaEventDispatcher<string>(getParent);
    d.addEventListener('container', 'click', (e) => seen.push([e.phase, e.currentTarget]));
    d.addEventListener('field', 'click', (e) => seen.push([e.phase, e.currentTarget]));

    d.dispatch('field', 'click');
    expect(seen).toEqual([
      ['target', 'field'],
      ['bubble', 'container'],
    ]);
  });
});

describe('G3 — bubbling taxonomy', () => {
  it('classifies interactive events as bubbling', () => {
    expect(eventBubbles('click')).toBe(true);
    expect(eventBubbles('change')).toBe(true);
    expect(eventBubbles('enter')).toBe(true);
    expect(eventBubbles('exit')).toBe(true);
  });

  it('classifies lifecycle events as non-bubbling', () => {
    expect(eventBubbles('initialize')).toBe(false);
    expect(eventBubbles('calculate')).toBe(false);
    expect(eventBubbles('validate')).toBe(false);
    expect(eventBubbles('ready')).toBe(false);
  });

  it('keeps the two sets disjoint', () => {
    for (const name of BUBBLING_EVENTS) expect(NON_BUBBLING_EVENTS.has(name)).toBe(false);
  });
});
