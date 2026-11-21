function scalarText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => scalarText(item)).join('');
  }
  if (typeof value === 'object') {
    return '';
  }
  return String(value);
}

export function createNullRecordNode(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.toStringTag) return 'NullXfaRecordNode';
      if (typeof prop === 'symbol') return undefined;
      switch (prop) {
        case 'value':
        case 'rawValue':
        case 'defaultValue':
          return '';
        case 'presence':
          return 'visible';
        case 'children':
        case 'all':
          return [];
        case 'length':
        case 'count':
          return 0;
        case 'isNull':
          return () => true;
        case 'isHidden':
          return () => false;
        case 'isVisible':
          return () => true;
        case 'resolveNode':
          return () => createNullRecordNode();
        case 'resolveNodes':
          return () => [];
        case 'setValue':
        case 'setRawValue':
        case 'getAttribute':
          return () => undefined;
        default:
          return createNullRecordNode();
      }
    },
    set() {
      return true;
    },
  });
}

function childAt(container: unknown, key: string): unknown {
  if (container == null) return undefined;
  if (Array.isArray(container)) {
    const idx = Number(key);
    if (Number.isInteger(idx)) return container[idx];
    for (const item of container) {
      const found = childAt(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof container === 'object') {
    return (container as Record<string, unknown>)[key];
  }
  return undefined;
}

function childKeys(container: unknown): string[] {
  if (container == null) return [];
  if (Array.isArray(container)) {
    return container.length ? childKeys(container[0]) : [];
  }
  if (typeof container === 'object') {
    return Object.keys(container as Record<string, unknown>).filter((k) => !k.startsWith('@_'));
  }
  return [];
}

export function createRecordNode(value: unknown): Record<string, unknown> {
  const target: Record<string, unknown> = {};

  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop === 'symbol') {
        if (prop === Symbol.toPrimitive) return () => scalarText(value);
        if (prop === Symbol.toStringTag) return 'XfaRecordNode';
        return undefined;
      }

      switch (prop) {
        case 'value':
        case 'rawValue':
        case 'defaultValue':
          return scalarText(value);
        case 'presence':
          return 'visible';
        case 'name':
          return '';
        case 'className':
        case 'type':
          return 'record';
        case 'length':
        case 'count':
          return Array.isArray(value) ? value.length : 0;
        case 'children':
        case 'all':
          return childKeys(value).map((k) => createRecordNode(childAt(value, k)));
        case 'nodes':
          return {
            length: childKeys(value).length,
            item: (idx: number) => {
              const keys = childKeys(value);
              return idx >= 0 && idx < keys.length
                ? createRecordNode(childAt(value, keys[idx]))
                : createNullRecordNode();
            },
          };
        case 'isNull':
          return () =>
            scalarText(value) === '' && !Array.isArray(value) && typeof value !== 'object';
        case 'isHidden':
          return () => false;
        case 'isVisible':
          return () => true;
        case 'setValue':
          return (val: unknown) => {
            value = val;
          };
        case 'setRawValue':
          return (val: string) => {
            value = val;
          };
        case 'resolveNode':
        case 'resolveNodes':
          return (expr: string) => {
            const rest = expr.replace(/^\$?\.?/, '');
            const parts = rest.split('.').filter(Boolean);
            let current: unknown = value;
            for (const part of parts) current = childAt(current, part);
            return current === undefined ? createNullRecordNode() : createRecordNode(current);
          };
        default: {
          if (Array.isArray(value) && /^\d+$/.test(prop)) {
            const item = value[Number(prop)];
            return item === undefined ? createNullRecordNode() : createRecordNode(item);
          }
          const child = childAt(value, prop);
          return child === undefined ? createNullRecordNode() : createRecordNode(child);
        }
      }
    },
    set(_t, prop, val) {
      if (typeof prop === 'string' && (prop === 'value' || prop === 'rawValue')) {
        value = val;
      }
      return true;
    },
  });
}

export function createRecordProxy(data: unknown): Record<string, unknown> {
  return createRecordNode(data ?? {});
}
