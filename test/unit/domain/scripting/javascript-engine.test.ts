import {
  JavaScriptEngine,
  JavaScriptEngineError,
} from '../../../../src/domain/scripting/js-engine/javascript-engine';
import { XFA_NODE_KEY } from '../../../../src/domain/scripting/js-engine/xfa-form-proxy';
import { createFieldAccessor } from '../../../../src/domain/scripting/xfa-object-model';
import type { FieldAccessor } from '../../../../src/domain/scripting/formcalc';
import type { ScriptableNode, XfaNode } from '../../../../src/domain/scripting/script-types';
import type { FieldNode, LayoutNode } from '../../../../src/types';

const DATA = { flag: 'yes', nested: { value: 7 } };

function scriptable(extra: Partial<ScriptableNode> = {}): ScriptableNode {
  return { type: 'field', name: 'subject', key: 'form.subject', path: 'form.subject', ...extra };
}

function xfaNode(name: string, extra: Partial<XfaNode> = {}): XfaNode {
  return {
    name,
    type: 'field',
    value: null,
    rawValue: null,
    presence: 'visible',
    access: 'open',
    mandatory: 'optional',
    relevant: '',
    boundNode: null,
    children: [],
    parent: null,
    ...extra,
  };
}

function engineFor(
  nodes: ScriptableNode[] = [],
  data: Record<string, unknown> = DATA,
  config: ConstructorParameters<typeof JavaScriptEngine>[1] = {}
): JavaScriptEngine {
  const map = new Map(nodes.map((node) => [node.key ?? node.path ?? node.name ?? '', node]));
  const engine = new JavaScriptEngine(createFieldAccessor(map, data), config);
  engine.setNodeMap(map);
  engine.setFormData(data);
  return engine;
}

function run(
  engine: JavaScriptEngine,
  script: string,
  current: XfaNode | null = null,
  event = 'initialize',
  key?: string
) {
  return engine.execute(script, current, event, DATA, key);
}

describe('JavaScriptEngine — execution lifecycle', () => {
  it('names its errors and wraps script exceptions', () => {
    expect(new JavaScriptEngineError('bad').message).toBe('JavaScript Engine Error: bad');
    const engine = engineFor();
    expect(() => run(engine, 'throw new Error("boom");')).toThrow(JavaScriptEngineError);
    expect(() => run(engine, 'throw new Error("boom");')).toThrow(/boom/);
    expect(() => run(engine, 'throw "plain";')).toThrow(/plain/);
  });

  it('maps host errors mentioning a timeout to the timeout error', () => {
    const accessor: FieldAccessor = {
      getField: () => {
        throw new Error('Script execution timed out');
      },
      setField: () => {},
      getCurrentNode: () => null,
      getFormData: () => ({}),
    };
    const engine = new JavaScriptEngine(accessor, { maxExecutionTime: 20 });
    engine.setNodeMap(new Map());
    expect(() => run(engine, 'xfa.resolveNode("anything");')).toThrow(
      /Script timed out after 20ms/
    );
  });

  it('captures console output only when enabled', () => {
    const script = 'console.log("a", 1); console.warn("w"); console.error("e");';
    expect(run(engineFor([], DATA, { enableConsole: false }), script).logs).toEqual([]);
    expect(run(engineFor([], DATA, { enableConsole: true }), script).logs).toEqual([
      'a 1',
      '[WARN] w',
      '[ERROR] e',
    ]);
  });

  it('returns the last returnValue and a copy of modified fields', () => {
    const node = scriptable();
    const engine = engineFor([node]);
    const result = run(engine, 'returnValue = 9;', xfaNode('subject'), 'initialize', node.key);
    expect(result.value).toBe(9);
    expect(result.modifiedFields).toEqual([]);
  });

  it('uses a safe null proxy when no current node is available', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [$.isNull(), $.isHidden(), $.isVisible(), $.value, $.presence, $.children.length, $.resolveNode("x"), String($), Object.prototype.toString.call($)];',
      null
    );
    expect(result.value).toEqual([
      true,
      true,
      false,
      null,
      'hidden',
      0,
      null,
      '',
      '[object NullXfaNode]',
    ]);
  });

  it('provides standard globals to scripts', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [parseInt("12px"), parseFloat("3.5"), isNaN("x"), isFinite(2), Math.max(1,2), new Date(0).getTime(), String(4), Number("5"), Boolean(1), [1,2].length, Object.keys({a:1}).length, /a/.test("a"), JSON.parse("1"), encodeURIComponent(" "), decodeURIComponent("%20"), encodeURI(" "), decodeURI("%20"), escape(" "), unescape("%20")];'
    );
    expect(result.value).toEqual([
      12,
      3.5,
      true,
      true,
      2,
      0,
      '4',
      5,
      true,
      2,
      1,
      true,
      1,
      '%20',
      ' ',
      '%20',
      ' ',
      '%20',
      ' ',
    ]);
  });
});

describe('JavaScriptEngine — node proxies and event objects', () => {
  it('reads and writes node properties through $', () => {
    const node = xfaNode('subject', {
      value: 'v',
      rawValue: 'v',
      presence: 'hidden',
      access: 'protected',
      mandatory: 'required',
      relevant: 'expr',
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      index: 2,
      repeating: true,
      boundNode: 'bound',
    });
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [$.name, $.type, $.value, $.rawValue, $.presence, $.access, $.mandatory, $.relevant, $.x, $.y, $.w, $.h, $.index, $.repeating, $.boundNode, $.isNull(), $.isHidden(), $.isVisible(), $.isRelevant()];',
      node
    );
    expect(result.value).toEqual([
      'subject',
      'field',
      'v',
      'v',
      'hidden',
      'protected',
      'required',
      'expr',
      1,
      2,
      3,
      4,
      2,
      true,
      'bound',
      false,
      true,
      false,
      true,
    ]);
    expect(run(engine, '$.value = "new";', node).modifiedFields).toEqual(['subject']);
    expect(node.value).toBe('new');
    expect(node.rawValue).toBe('new');
    expect(run(engine, '$.rawValue = "raw";', node).modifiedFields).toEqual(['subject']);
    expect(node.rawValue).toBe('raw');
    expect(run(engine, '$.presence = "visible"; $.access = "open";', node).modifiedFields).toEqual(
      []
    );
    expect(node.presence).toBe('visible');
    expect(node.access).toBe('protected');
    expect(run(engine, 'returnValue = ($.access = "open", $.access);', node).value).toBe('open');
  });

  it('supports node methods, attributes, children and equality', () => {
    const child = xfaNode('child', { value: 'c' });
    const node = xfaNode('subject', { value: 's', children: [child], parent: null });
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [$.getValue(), $.getRawValue(), $.getAttribute("mandatory"), $.getAttribute("missing"), $.children.length, $.equals($), $.equals({_value:"s"}), $.equals("s"), $.resolveNode("flag").value];',
      node
    );
    expect(result.value).toEqual(['s', null, 'optional', null, 1, true, true, true, 'yes']);
    run(engine, '$.setAttribute("label", "L"); $.setValue("v2"); $.setRawValue("r2");', node);
    expect((node as unknown as Record<string, unknown>).label).toBe('L');
    expect(node.value).toBe('r2');
    expect(node.rawValue).toBe('r2');
  });

  it('exposes the event object with mutable cancelAction', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [event.name, event.target.name, event.fullTrigger, event.type, event.changed, event.propagated, event.rejected, event.submitTrigger, event.prevText, event.newText, event.change, event.commitKey, event.modifier, event.keyDown, event.shift, event.cancelAction]; event.cancelAction = true; event.lock(); event.unlock(); returnValue.push(event.cancelAction);',
      xfaNode('subject', { rawValue: 'text' }),
      'change'
    );
    expect(result.value).toEqual([
      'change',
      'subject',
      true,
      'execute',
      false,
      false,
      false,
      null,
      'text',
      'text',
      '',
      0,
      false,
      0,
      false,
      false,
      true,
    ]);
  });

  it('exposes host state, messages and value formatting', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [host.name, host.appType, host.version, host.language, host.platform, host.pathSeparator, host.numPages, host.currentPage, host.title, host.calculationsEnabled, host.validationsEnabled, host.formatValue(null), host.formatValue(5), host.unformatValue("12")]; host.currentPage = 4; host.calculationsEnabled = false; host.validationsEnabled = false; host.alert(); host.messageBox("m"); host.resetData(); host.pageUp(); host.pageDown(); host.gotoURL("u"); host.importData("p"); host.exportData("p"); host.print(); host.response("q"); host.setFocus("f"); returnValue.push(host.currentPage, host.calculationsEnabled, host.validationsEnabled, host.getFocus());',
      null,
      'initialize'
    );
    expect(result.value).toEqual([
      'Adobe LiveCycle Designer',
      'Exchange',
      '11.0',
      'ENU',
      'Cross-platform',
      '.',
      1,
      1,
      '',
      true,
      true,
      '',
      '5',
      '12',
      4,
      false,
      false,
      null,
    ]);
  });

  it('formats and unformats values with picture clauses', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [host.formatValue(new Date(1996, 2, 15, 15, 30, 45), "YYYY-MM-DD HH:mm:ss"), host.formatValue(1234.5, "$#,##0.00"), host.formatValue(-1234.5, "#,##0.00"), host.formatValue(12, "0000"), host.formatValue("abc", "unknown"), host.unformatValue("1996-03-15", "YYYY-MM-DD"), host.unformatValue("$1,234.50", "$#,##0.00"), host.unformatValue("plain", "unknown"), host.unformatValue("", "999")];'
    );
    expect(result.value).toEqual([
      '1996-03-15 15:30:45',
      '$1,234.50',
      '-1,234.50',
      '12',
      'abc',
      expect.any(Date),
      1234.5,
      'plain',
      '',
    ]);
    const date = (result.value as unknown[])[5] as Date;
    expect(date.getFullYear()).toBe(1996);
  });

  it('formats numbers with localized separators', () => {
    const engine = engineFor([], DATA, { locale: 'de_DE' });
    const result = run(
      engine,
      'returnValue = [host.formatValue(1234.5, "$#,##0.00"), host.unformatValue("$1.234,50", "$#,##0.00")];'
    );
    expect(result.value).toEqual(['$1.234,50', 1234.5]);
  });

  it('formats localized meridiem text', () => {
    const engine = engineFor([], DATA, { locale: 'zh-CN' });
    const result = run(
      engine,
      'returnValue = host.formatValue(new Date(1996, 2, 15, 15, 30, 45), "YYYY-MM-DD AMPM");'
    );
    expect(result.value).toBe('1996-03-15 下午');
  });

  it('exposes app and util objects including printf, date and stream helpers', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'returnValue = [app.language, app.platform, app.version, app.getLock(), app.getMenuItem().enable, app.timer(), util.printf("%s-%s", "a", "b"), util.printd("YYYY-MM-DD", new Date(1996, 2, 15)), util.printd("x", "not-a-date"), util.scand("d", "1996-03-15").getFullYear(), util.dateToNumber(new Date(0)), util.numToDate(0).getTime(), util.stringFromStream(), util.streamFromString(), util.iconStreamFromFile(), util.fileFromIconStream(), util.byte2char(), util.char2byte(), typeof util.MemoryStream, typeof util.Report]; app.alert(); app.beeper(); app.cancelDoc(); app.closeDoc(); app.execEvent(); app.execMenuItem(); app.getFile(); app.getForm(); app.goToPage(); app.mailDoc(); app.newDoc(); app.openDoc(); app.openForm(); app.print(); app.respond(); app.saveAs(); app.submitForm();',
      null
    );
    expect(result.value).toEqual([
      'ENU',
      'Cross',
      '11.0',
      false,
      false,
      0,
      'a-b',
      '1996-03-15',
      '',
      1996,
      0,
      0,
      '',
      null,
      null,
      null,
      '',
      0,
      'function',
      'function',
    ]);
    expect(run(engine, 'returnValue = FormCalc.eval("1+1");').value).toBeUndefined();
  });
});

describe('JavaScriptEngine — xfa object', () => {
  it('resolves nodes, node lists and record data', () => {
    const node = scriptable({ type: 'subform', name: 'form', key: 'form', path: 'form' });
    const field = scriptable({ name: 'subject', key: 'form.subject', path: 'form.subject' });
    const engine = engineFor([node, field]);
    const result = run(
      engine,
      'returnValue = [xfa.resolveNode("form.subject").name, xfa.resolveNodes("subject").length, xfa.resolveNodes("subject[*]").length, xfa.record.nested.value, xfa.form.subject.rawValue];',
      xfaNode('subject'),
      'initialize',
      'form.subject'
    );
    expect(result.value).toEqual(['subject', 1, 1, '', null]);
  });

  it('resolves fields through the accessor when the node map has no match', () => {
    const engine = engineFor();
    const result = run(engine, 'returnValue = xfa.resolveNode("external") === null;');
    expect(result.value).toBe(true);
  });

  it('builds a template proxy with exact, suffix and resolveNode lookups', () => {
    const node = scriptable({ name: 'subject', key: 'form.subject', path: 'form.subject' });
    const engine = engineFor([node]);
    const result = run(
      engine,
      'returnValue = [xfa.template["form.subject"].name, xfa.template.subject.name, xfa.template.resolveNode("form.subject").name, String(xfa.template.missing)];'
    );
    expect(result.value).toEqual(['subject', 'subject', 'subject', 'undefined']);
  });

  it('reads and writes datasets and falls back when the node map is empty', () => {
    const engine = engineFor();
    const result = run(
      engine,
      'xfa.datasets.added = "value"; returnValue = [xfa.datasets.flag, xfa.datasets.added, xfa.form.name, xfa.form.type, xfa.form.rawValue, xfa.form.resolveNode("record.nested").value];'
    );
    expect(result.value).toEqual(['yes', 'value', 'form', 'form', null, '']);
  });

  it('reports layout state and resolves pages by key, symbol and layout node', () => {
    const layout = { type: 'field', name: 'subject' } as FieldNode;
    const node = scriptable({
      name: 'subject',
      key: 'form.subject',
      path: 'form.subject',
      layoutNode: layout,
    });
    const engine = engineFor([node]);
    engine.setLayoutInfo({
      pageCount: 3,
      pageOf: new Map<unknown, number>([
        ['form.subject', 2],
        ['other.key', 1],
        [layout, 3],
      ]),
      pageContent: new Map([[1, 7]]),
    });
    const result = run(
      engine,
      'returnValue = [xfa.layout.ready, xfa.layout.pageCount(), xfa.layout.absPageCount(), xfa.layout.page("form.subject"), xfa.layout.absPage("other.key"), xfa.layout.page(), xfa.layout.page({key:"other.key"}), xfa.layout.page({path:"other.key"}), xfa.layout.page({somExpression:"other.key"}), xfa.layout.pageContent(1), xfa.layout.pageContent(9), xfa.layout.relayout()];',
      xfaNode('subject'),
      'initialize',
      'form.subject'
    );
    expect(result.value).toEqual([true, 3, 3, 2, 1, 2, 1, 1, 1, 7, 0, true]);
    const byLayout = run(engine, 'returnValue = xfa.layout.page("form.subject");', null);
    expect(byLayout.value).toBe(2);
  });

  it('resolves page zero for unknown keys and proxies', () => {
    const engine = engineFor();
    expect(run(engine, 'returnValue = xfa.layout.page("unknown");').value).toBe(0);
    expect(run(engine, 'returnValue = xfa.layout.page({});').value).toBe(0);
    expect(run(engine, 'returnValue = xfa.layout.page();').value).toBe(0);
  });

  it('exposes the XFA node key symbol through form proxies', () => {
    const node = scriptable({ name: 'subject', key: 'form.subject', path: 'form.subject' });
    const engine = engineFor([node]);
    const result = run(
      engine,
      `returnValue = (function () { var proxy = xfa.form.subject; return proxy[Symbol.for('xfa.node.key')] === undefined && Object.getOwnPropertySymbols(proxy).length === 0; })();`,
      null
    );
    expect(result.value).toBe(true);
    expect(XFA_NODE_KEY.toString()).toBe('Symbol(xfa.node.key)');
  });
});

describe('JavaScriptEngine — instance manager hooks', () => {
  function instanceSetup(): {
    engine: JavaScriptEngine;
    parent: ScriptableNode;
    layout: LayoutNode & { children: LayoutNode[] };
  } {
    const template = {
      type: 'field',
      name: 'row',
      resolvedValue: 'template-value',
    } as unknown as LayoutNode;
    const layout = {
      type: 'subform',
      name: 'rows',
      children: [template],
    } as unknown as LayoutNode & {
      children: LayoutNode[];
    };
    const parent = scriptable({
      type: 'subform',
      name: 'rows',
      key: 'rows',
      path: 'rows',
      layoutNode: layout,
      children: [
        scriptable({ name: 'row', key: 'rows.row', path: 'rows.row', layoutNode: template }),
      ],
    });
    return { engine: engineFor([parent, ...parent.children!]), parent, layout };
  }

  it('adds, removes, moves and resizes instances', () => {
    const { engine, parent, layout } = instanceSetup();
    const script =
      'var m = $.instanceManager; m.addInstance(); m.setInstances(3); m.moveInstance(0, 2); returnValue = [m.count, xfa.resolveNodes("row[*]").length]; m.removeInstance(0); returnValue.push(m.count);';
    const result = run(engine, script, xfaNode('rows'), 'initialize', 'rows');
    expect((result.value as unknown[])[0]).toBe(3);
    expect(layout.children).toHaveLength(2);
    expect(parent.children).toHaveLength(2);
  });

  it('clones colors, registers nested subtrees and avoids path collisions', () => {
    const layoutChild = {
      type: 'subform',
      name: 'group',
      children: [{ type: 'field', name: 'cell', resolvedValue: 'x' }],
    } as unknown as LayoutNode;
    const layout = {
      type: 'subform',
      name: 'rows',
      children: [layoutChild],
    } as unknown as LayoutNode & {
      children: LayoutNode[];
    };
    const parent = scriptable({
      type: 'subform',
      name: 'rows',
      key: 'rows',
      path: 'rows',
      layoutNode: layout,
      children: [
        scriptable({
          name: 'group',
          key: 'rows.group',
          path: 'rows.group',
          layoutNode: layoutChild,
        }),
      ],
    });
    const engine = engineFor([parent, ...parent.children!]);
    const result = run(
      engine,
      '$.instanceManager.addInstance(); returnValue = [xfa.resolveNode("rows.group#2") !== null, xfa.resolveNode("rows.group#2.cell") !== null];',
      xfaNode('rows'),
      'initialize',
      'rows'
    );
    expect(result.value).toEqual([true, true]);
  });

  it('ignores invalid instance operations', () => {
    const { engine } = instanceSetup();
    const bare = scriptable({ name: 'bare', key: 'bare', path: 'bare' });
    const engine2 = engineFor([bare]);
    expect(() =>
      run(
        engine2,
        '$.instanceManager.addInstance(); $.instanceManager.removeInstance(0); $.instanceManager.setInstances(-1); $.instanceManager.moveInstance(0, 1);',
        xfaNode('bare'),
        'initialize',
        'bare'
      )
    ).not.toThrow();
    expect(() =>
      run(
        engine,
        '$.instanceManager.moveInstance(-1, 0); $.instanceManager.moveInstance(0, 9);',
        xfaNode('rows'),
        'initialize',
        'rows'
      )
    ).not.toThrow();
  });
});
