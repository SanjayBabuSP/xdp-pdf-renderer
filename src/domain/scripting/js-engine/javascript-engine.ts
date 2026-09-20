// ────────────────────────────────────────────────────────────────────────────
// JavaScript Script Engine — Sandboxed execution using Node.js vm module
// ────────────────────────────────────────────────────────────────────────────

import * as vm from 'vm';
import { XfaNode, ScriptEngineConfig, ScriptableNode } from '../script-types';
import { FieldAccessor } from '../formcalc/evaluator';
import { createXfaFormProxy } from './xfa-form-proxy';

export class JavaScriptEngineError extends Error {
  constructor(message: string) {
    super(`JavaScript Engine Error: ${message}`);
  }
}

export interface JsExecutionResult {
  value: unknown;
  modifiedFields: string[];
  logs: string[];
}

function createNullProxy(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.toStringTag) return 'NullXfaNode';
      if (typeof prop === 'string') {
        if (prop === 'isNull' || prop === 'isHidden') return () => true;
        if (prop === 'isVisible') return () => false;
        if (prop === 'value' || prop === 'rawValue') return null;
        if (prop === 'presence') return 'hidden';
        if (prop === 'children') return [];
        if (prop === 'resolveNode') return () => null;
        if (prop === 'getAttribute' || prop === 'setValue') return () => {};
      }
      return undefined;
    },
    set() { return true; },
  });
}

/**
 * Sandboxed JavaScript engine for XFA scripts.
 * Provides $, xfa, event, and host objects matching Adobe LiveCycle behavior.
 */
export class JavaScriptEngine {
  private fieldAccessor: FieldAccessor;
  private config: Required<ScriptEngineConfig>;
  private modifiedFields: string[] = [];
  private nodeMap: Map<string, ScriptableNode> = new Map();

  constructor(fieldAccessor: FieldAccessor, config: ScriptEngineConfig = {}) {
    this.fieldAccessor = fieldAccessor;
    this.config = {
      maxExecutionTime: config.maxExecutionTime ?? 5000,
      maxRecursionDepth: config.maxRecursionDepth ?? 50,
      enableConsole: config.enableConsole ?? false,
      strictMode: config.strictMode ?? false,
    };
  }

  /**
   * Set the node map for deep xfa.form navigation.
   * Should be called before execute() with the full layout tree node map.
   */
  setNodeMap(nodeMap: Map<string, ScriptableNode>): void {
    this.nodeMap = nodeMap;
  }

  execute(
    script: string,
    currentNode: XfaNode | null,
    eventName: string,
    formData: unknown
  ): JsExecutionResult {
    this.modifiedFields = [];
    const logs: string[] = [];

    const context = this.createSandboxContext(currentNode, eventName, formData, logs);

    try {
      const wrappedScript = this.wrapScript(script, eventName);
      const sandbox = vm.createContext(context);
      vm.runInContext(wrappedScript, sandbox, {
        filename: `xfa-${eventName}.js`,
        timeout: this.config.maxExecutionTime,
      });

      return {
        value: (context as Record<string, unknown>).returnValue ?? undefined,
        modifiedFields: [...this.modifiedFields],
        logs,
      };
    } catch (e) {
      if (e instanceof Error && e.message.includes('timed out')) {
        throw new JavaScriptEngineError(
          `Script timed out after ${this.config.maxExecutionTime}ms`
        );
      }
      throw new JavaScriptEngineError(e instanceof Error ? e.message : String(e));
    }
  }

  private createSandboxContext(
    currentNode: XfaNode | null,
    eventName: string,
    formData: unknown,
    logs: string[]
  ): Record<string, unknown> {
    const self = this;

    const dollarSign = currentNode ? this.createNodeProxy(currentNode) : createNullProxy();
    const xfaObj = this.createXfaObject(formData);
    const eventObj = this.createEventObject(currentNode, eventName);
    const hostObj = this.createHostObject();

    const consoleObj = {
      log: (...args: unknown[]) => {
        if (self.config.enableConsole) logs.push(args.map(String).join(' '));
      },
      warn: (...args: unknown[]) => {
        if (self.config.enableConsole) logs.push('[WARN] ' + args.map(String).join(' '));
      },
      error: (...args: unknown[]) => {
        if (self.config.enableConsole) logs.push('[ERROR] ' + args.map(String).join(' '));
      },
    };

    return {
      $: dollarSign,
      xfa: xfaObj,
      event: eventObj,
      host: hostObj,
      console: consoleObj,
      app: this.createAppObject(),
      util: this.createUtilObject(),
      FormCalc: { eval: () => null },
      this: dollarSign,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Math,
      Date,
      String,
      Number,
      Boolean,
      Array,
      Object,
      RegExp,
      JSON,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      escape,
      unescape,
      returnValue: undefined,
    };
  }

  private createNodeProxy(node: XfaNode): Record<string, unknown> {
    const self = this;
    const childProxies = (node.children ?? []).map((child) => self.createNodeProxy(child));

    // Use a Proxy to handle both get and set for value/rawValue/presence
    const target: Record<string, unknown> = {
      name: node.name,
      type: node.type,
      _value: node.value,
      _rawValue: node.rawValue ?? (node.value != null ? String(node.value) : null),
      _presence: node.presence,
      access: node.access,
      mandatory: node.mandatory ?? 'optional',
      relevant: node.relevant ?? '',
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      index: node.index ?? 1,
      repeating: node.repeating ?? false,
      boundNode: node.boundNode ?? null,
      children: childProxies,
      resolveNode: (somExpr: string) => self.resolveSomExpression(somExpr, node),
      getAttribute: (attrName: string) => (node as unknown as Record<string, unknown>)[attrName] ?? null,
      setAttribute: (attrName: string, val: unknown) => { (node as unknown as Record<string, unknown>)[attrName] = val; },
      getValue: () => node.value,
      setValue: (val: unknown) => {
        node.value = val;
        node.rawValue = val != null ? String(val) : null;
        target._value = val;
        target._rawValue = val != null ? String(val) : null;
        self.modifiedFields.push(node.name ?? '<unknown>');
      },
      getRawValue: () => node.rawValue,
      setRawValue: (val: string) => {
        node.rawValue = val;
        node.value = val;
        target._rawValue = val;
        target._value = val;
        self.modifiedFields.push(node.name ?? '<unknown>');
      },
      isNull: () => node.value == null,
      isHidden: () => node.presence === 'hidden',
      isVisible: () => node.presence === 'visible',
      isRelevant: () => node.relevant !== '',
      equals: (other: unknown) => {
        if (other && typeof other === 'object' && '_value' in other) {
          return node.value === (other as Record<string, unknown>)._value;
        }
        return node.value === other;
      },
    };

    return new Proxy(target, {
      get(t, prop) {
        if (prop === 'value') return t._value;
        if (prop === 'rawValue') return t._rawValue;
        if (prop === 'presence') return t._presence;
        return t[prop as string];
      },
      set(t, prop, val) {
        if (prop === 'value') {
          t._value = val;
          node.value = val;
          node.rawValue = val != null ? String(val) : null;
          t._rawValue = val != null ? String(val) : null;
          self.modifiedFields.push(node.name ?? '<unknown>');
          return true;
        }
        if (prop === 'rawValue') {
          t._rawValue = val;
          node.rawValue = val as string | null;
          node.value = val;
          t._value = val;
          self.modifiedFields.push(node.name ?? '<unknown>');
          return true;
        }
        if (prop === 'presence') {
          t._presence = val;
          node.presence = val as string;
          return true;
        }
        t[prop as string] = val;
        return true;
      },
    });
  }

  private createXfaObject(formData: unknown): Record<string, unknown> {
    // Use deep xfa.form proxy if nodeMap is available (Component 3 enhancement)
    const formProxy = this.nodeMap.size > 0
      ? createXfaFormProxy(this.nodeMap, '', this.modifiedFields)
      : this.createFallbackFormProxy(formData);

    // Create template proxy from nodeMap (access to layout structure)
    const templateProxy = this.nodeMap.size > 0
      ? this.createTemplateProxy()
      : createNullProxy();

    // Create datasets proxy from formData
    const datasetsProxy = this.createDatasetsProxy(formData);

    return {
      form: formProxy,
      resolveNode: (somExpr: string) => this.resolveSomExpression(somExpr, null),
      resolveNodes: (somExpr: string) => {
        // Resolve all matching nodes for wildcard expressions
        const results: Record<string, unknown>[] = [];
        if (somExpr.includes('[*]')) {
          const basePath = somExpr.replace(/\[\*\]/g, '');
          for (const [path] of this.nodeMap) {
            if (path.includes(basePath)) {
              results.push(createXfaFormProxy(this.nodeMap, path, this.modifiedFields));
            }
          }
        } else {
          const single = this.resolveSomExpression(somExpr, null);
          if (single) results.push(single);
        }
        return results;
      },
      template: templateProxy,
      datasets: datasetsProxy,
      host: this.createHostObject(),
      event: createNullProxy(), // xfa.event is also accessible via xfa.event
    };
  }

  private createTemplateProxy(): Record<string, unknown> {
    // Create a proxy that allows navigation of the template structure
    const self = this;
    const templateNodes: Record<string, unknown> = {};

    // Build a proxy representation of all template nodes
    for (const [path, node] of this.nodeMap) {
      templateNodes[path] = {
        name: node.name,
        type: node.type,
        presence: node.presence,
        access: node.access,
        children: (node.children ?? []).map((c, i) => ({
          name: c.name ?? `<child_${i}>`,
          type: c.type,
        })),
      };
    }

    return new Proxy(templateNodes, {
      get(target, prop) {
        if (typeof prop === 'string') {
          // Allow direct path lookup
          if (target[prop]) return target[prop];
          // Allow name-based lookup
          for (const [path, node] of Object.entries(target)) {
            if (path.endsWith(`.${prop}`) || path === prop) return node;
          }
          // Return a resolveNode function for SOM expressions
          if (prop === 'resolveNode') {
            return (somExpr: string) => self.resolveSomExpression(somExpr, null);
          }
        }
        return undefined;
      },
    });
  }

  private createDatasetsProxy(formData: unknown): Record<string, unknown> {
    // Create a proxy for xfa.datasets.data that wraps the actual data
    const data = formData as Record<string, unknown>;
    return new Proxy(data ?? {}, {
      get(target, prop) {
        if (typeof prop === 'string') {
          return target[prop];
        }
        return undefined;
      },
      set(target, prop, val) {
        if (typeof prop === 'string') {
          target[prop] = val;
          return true;
        }
        return false;
      },
    });
  }

  private createFallbackFormProxy(formData: unknown): Record<string, unknown> {
    const self = this;
    return {
      value: null,
      rawValue: null,
      presence: 'visible',
      name: 'form',
      type: 'form',
      resolveNode: (somExpr: string) => self.resolveSomExpression(somExpr, null),
    };
  }

  private createEventObject(currentNode: XfaNode | null, eventName: string): Record<string, unknown> {
    // Enhanced xfa.event matching Adobe LiveCycle Designer (Reference: EScript.ppi)
    let _cancelAction = false;
    return {
      name: eventName,
      target: currentNode ? this.createNodeProxy(currentNode) : null,
      fullTrigger: true,
      type: 'execute',
      changed: false,
      propagated: false,
      rejected: false,
      submitTrigger: null,
      // Enhanced properties matching Adobe's event object
      prevText: currentNode?.rawValue ?? '',
      newText: currentNode?.rawValue ?? '',
      change: '',
      commitKey: 0, // 0=none, 1=enter, 2=tab
      modifier: false,
      keyDown: 0,
      shift: false,
      // Cancel action method
      get cancelAction() { return _cancelAction; },
      set cancelAction(val: boolean) { _cancelAction = val; },
      // Locking methods
      lock: () => {},
      unlock: () => {},
    };
  }

  private createHostObject(): Record<string, unknown> {
    const now = new Date();
    let _calculationsEnabled = true;
    let _validationsEnabled = true;
    let _currentPage = 1;
    const engine = this;
    return {
      // Identity
      name: 'Adobe LiveCycle Designer',
      appType: 'Exchange', // 'Exchange' = Acrobat, 'Reader' = Reader
      version: '11.0',
      language: 'ENU',
      platform: 'Cross-platform',
      certificateAlias: '',
      pathSeparator: '.',

      // Page info
      numPages: 1, // Will be set by the pipeline
      get currentPage() { return _currentPage; },
      set currentPage(val: number) { _currentPage = val; },
      title: '',

      // Script execution control
      get calculationsEnabled() { return _calculationsEnabled; },
      set calculationsEnabled(val: boolean) { _calculationsEnabled = val; },
      get validationsEnabled() { return _validationsEnabled; },
      set validationsEnabled(val: boolean) { _validationsEnabled = val; },

      // Date/time
      now,

      // Methods
      alert: () => {},
      messageBox: (msg: string, _title?: string, _icon?: number, _buttons?: number) => {
        // In static PDF generation, messageBox returns the default button (1 = OK)
        return 1;
      },
      formatValue: (value: unknown, picture?: string) => {
        if (value == null) return '';
        if (!picture) return String(value);
        return engine.formatWithPictureClause(value, picture);
      },
      unformatValue: (value: string, picture?: string) => {
        if (!picture) return value;
        return engine.unformatWithPictureClause(value, picture);
      },
      resetData: () => {},
      pageUp: () => {},
      pageDown: () => {},
      gotoURL: (_url: string) => {},
      importData: (_path: string) => {},
      exportData: (_path: string) => {},
      print: (_startPage?: number, _endPage?: number) => {},
      response: (_question: string, _title?: string, _default?: string, _hideAnswer?: boolean) => '',
      setFocus: (_somExpr: string) => {},
      getFocus: () => null,
    };
  }

  private createAppObject(): Record<string, unknown> {
    return {
      alert: () => {},
      beeper: () => {},
      cancelDoc: () => {},
      closeDoc: () => {},
      execEvent: () => {},
      execMenuItem: () => {},
      getFile: () => null,
      getForm: () => null,
      getLock: () => false,
      getMenuItem: () => ({ enable: false, exist: false, mark: false }),
      goToPage: () => {},
      language: 'ENU',
      locked: false,
      mailDoc: () => {},
      newDoc: () => null,
      openDoc: () => null,
      openForm: () => null,
      platform: 'Cross',
      print: () => {},
      respond: () => {},
      saveAs: () => {},
      submitForm: () => {},
      timer: () => 0,
      types: {},
      version: '11.0',
    };
  }

  private createUtilObject(): Record<string, unknown> {
    return {
      printf: (format: string, ...args: unknown[]) => {
        let result = format;
        for (const arg of args) {
          result = result.replace(/%[^%]*?s/, String(arg));
        }
        return result;
      },
      printd: (format: string, date: Date) => {
        if (!(date instanceof Date)) return '';
        return format
          .replace(/YYYY/g, String(date.getFullYear()))
          .replace(/MM/g, String(date.getMonth() + 1).padStart(2, '0'))
          .replace(/DD/g, String(date.getDate()).padStart(2, '0'))
          .replace(/HH/g, String(date.getHours()).padStart(2, '0'))
          .replace(/mm/g, String(date.getMinutes()).padStart(2, '0'))
          .replace(/ss/g, String(date.getSeconds()).padStart(2, '0'));
      },
      scand: (_format: string, str: string) => new Date(str),
      dateToNumber: (d: Date) => d.getTime(),
      numToDate: (n: number) => new Date(n),
      stringFromStream: () => '',
      streamFromString: () => null,
      iconStreamFromFile: () => null,
      fileFromIconStream: () => null,
      byte2char: () => '',
      char2byte: () => 0,
      MemoryStream: class {},
      Report: class {},
    };
  }

  private formatWithPictureClause(value: unknown, picture: string): string {
    if (value == null) return '';
    const trimmed = picture.trim();

    // Date picture patterns
    if (/(YYYY|YY|MM|DD|HH|mm|ss|AMPM|am|pm)/i.test(trimmed)) {
      const date = value instanceof Date ? value : new Date(String(value));
      if (isNaN(date.getTime())) return String(value);
      const replacements: Record<string, string> = {
        'YYYY': String(date.getFullYear()),
        'YY': String(date.getFullYear()).slice(-2),
        'MM': String(date.getMonth() + 1).padStart(2, '0'),
        'M': String(date.getMonth() + 1),
        'DD': String(date.getDate()).padStart(2, '0'),
        'D': String(date.getDate()),
        'HH': String(date.getHours()).padStart(2, '0'),
        'H': String(date.getHours()),
        'mm': String(date.getMinutes()).padStart(2, '0'),
        'm': String(date.getMinutes()),
        'ss': String(date.getSeconds()).padStart(2, '0'),
        's': String(date.getSeconds()),
        'AMPM': date.getHours() >= 12 ? 'PM' : 'AM',
        'am': date.getHours() >= 12 ? 'pm' : 'am',
      };
      let formatted = trimmed;
      for (const [token, replacement] of Object.entries(replacements)) {
        formatted = formatted.replace(new RegExp(token, 'g'), replacement);
      }
      return formatted;
    }

    // Number picture patterns
    if (/[0#.,]/.test(trimmed) && typeof value === 'number') {
      const mask = trimmed.replace(/\s+/g, '');
      const prefix = mask.match(/^[^0-9#.,]+/)?.[0] ?? '';
      const suffix = mask.match(/[^0-9#.,]+$/)?.[0] ?? '';
      const digitsMask = mask.slice(prefix.length, mask.length - suffix.length);
      const hasDecimal = digitsMask.includes('.');
      const decimalPlaces = hasDecimal ? digitsMask.split('.')[1]?.replace(/[^0#]/g, '').length ?? 0 : 0;
      const hasGrouping = digitsMask.includes(',');
      const absValue = Math.abs(value);
      const rounded = absValue.toFixed(decimalPlaces);
      const [wholeRaw, fractionRaw = ''] = rounded.split('.');
      let whole = wholeRaw;
      if (hasGrouping) {
        whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
      const sign = value < 0 ? '-' : '';
      const numeric = hasDecimal ? `${whole}.${fractionRaw}` : whole;
      return `${prefix}${sign}${numeric}${suffix}`;
    }

    return String(value);
  }

  private unformatWithPictureClause(value: string, picture: string): unknown {
    if (!value) return value;
    const trimmed = picture.trim();

    // For date patterns, try to parse
    if (/(YYYY|YY|MM|DD|HH|mm|ss|AMPM|am|pm)/i.test(trimmed)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) return date;
    }

    // For number patterns, extract numeric value
    if (/[0#.,]/.test(trimmed)) {
      const cleaned = value.replace(/[^0-9.\-]/g, '');
      const num = parseFloat(cleaned);
      if (!isNaN(num)) return num;
    }

    return value;
  }

  private resolveSomExpression(somExpr: string, contextNode: XfaNode | null): Record<string, unknown> | null {
    // Try the nodeMap first (deep proxy with full navigation)
    if (this.nodeMap.size > 0) {
      // Try direct path
      if (this.nodeMap.has(somExpr)) {
        return createXfaFormProxy(this.nodeMap, somExpr, this.modifiedFields);
      }
      // Try scoped resolution from nodeMap keys
      for (const [path] of this.nodeMap) {
        if (path.endsWith(`.${somExpr}`) || path === somExpr) {
          return createXfaFormProxy(this.nodeMap, path, this.modifiedFields);
        }
      }
    }

    // Fall back to fieldAccessor
    const value = this.fieldAccessor.getField(somExpr, '$');
    if (value === undefined) return null;
    const name = somExpr.split('.').pop() ?? somExpr;
    const node: XfaNode = {
      name,
      type: 'field',
      value,
      rawValue: value != null ? String(value) : null,
      presence: 'visible',
      access: 'open',
      mandatory: 'optional',
      relevant: '',
      boundNode: null,
      children: [],
      parent: contextNode,
    };
    return this.createNodeProxy(node);
  }

  private wrapScript(script: string, _eventName: string): string {
    return `
      (function($, xfa, event, host) {
        var returnValue;
        ${script}
      })($, xfa, event, host);
    `;
  }
}
