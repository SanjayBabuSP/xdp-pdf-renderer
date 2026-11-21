import {
  buildScriptIndex,
  dispatchInteractiveEvent,
  dispatchPostLayoutScripts,
  dispatchScripts,
  type ScriptDispatchConfig,
} from '../../../../src/domain/scripting/event-dispatcher';
import type {
  EventSpec,
  FieldNode,
  LayoutModel,
  LayoutNode,
  PaginatedLayout,
} from '../../../../src/types';

const MEDIUM = { stock: 'a4', short: 595.28, long: 841.89 };
const CONTENT = { x: 0, y: 0, w: 595.28, h: 841.89 };

function event(activity: string, script: string, extra: Partial<EventSpec> = {}): EventSpec {
  return {
    activity,
    script,
    contentType: 'application/x-javascript',
    ...extra,
  };
}

function field(name: string, events: EventSpec[] = [], extra: Partial<FieldNode> = {}): FieldNode {
  return { type: 'field', name, presence: 'visible', events, ...extra };
}

function layout(children: LayoutNode[], extra: Partial<LayoutModel> = {}): LayoutModel {
  return {
    rootSubformName: 'form',
    rootEvents: [],
    pages: [{ name: 'page1', medium: MEDIUM, contentArea: CONTENT, masterPageChildren: [] }],
    children,
    ...extra,
  };
}

function findField(nodes: LayoutNode[], name: string): FieldNode | undefined {
  for (const node of nodes) {
    if (node.type === 'field' && node.name === name) return node;
    if (node.type === 'subform' || node.type === 'exclGroup') {
      const found = findField(node.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

function scripted(name: string, activity: string, script: string): FieldNode {
  return field(name, [event(activity, script)]);
}

describe('event dispatcher — lifecycle phases', () => {
  it('skips all scripts when configured', () => {
    const model = layout([scripted('a', 'initialize', '$.rawValue = "ran";')]);
    const result = dispatchScripts(model, {}, { skipScripts: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        layout: model,
        scriptsExecuted: 0,
        scriptErrors: 0,
        errorMessages: [],
        propertyChanges: 0,
        layoutDirty: false,
      });
    }
    expect(findField(model.children, 'a')?.resolvedValue).toBeUndefined();
  });

  it('executes initialize, indexChange, docOpen, validate, overlay, ready and layout ready phases', () => {
    const model = layout([
      field('a', [
        event('initialize', '$.rawValue = "init";'),
        event('indexChange', '$.rawValue = "index";'),
        event('validate', '$.rawValue = "validate";'),
        event('overlay', '$.rawValue = "overlay";'),
        event('form:ready', '$.rawValue = "formReady";'),
        event('layout:ready', '$.rawValue = "layoutReady";'),
      ]),
      field('b', [], {
        events: [event('initialize', '$.rawValue = "docOpen";', { runAt: 'docOpen' })],
      }),
    ]);
    const result = dispatchScripts(model, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scriptsExecuted).toBe(7);
      expect(result.data.scriptErrors).toBe(0);
      expect(result.data.errorMessages).toEqual([]);
    }
    expect(findField(model.children, 'a')?.resolvedValue).toBe('layoutReady');
    expect(findField(model.children, 'b')?.resolvedValue).toBe('docOpen');
  });

  it('honours per-event skipping', () => {
    const model = layout([scripted('a', 'initialize', '$.rawValue = "init";')]);
    const config: ScriptDispatchConfig = { skipEvents: ['initialize'] };
    const result = dispatchScripts(model, {}, config);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(0);
    expect(findField(model.children, 'a')?.resolvedValue).toBeUndefined();
  });

  it('executes validate scripts declared on the field itself', () => {
    const target = field('a', [], {
      validate: {
        script: { content: '$.rawValue = "validated";', contentType: 'javascript' },
      },
    });
    const model = layout([target]);
    const result = dispatchScripts(model, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(1);
    expect(target.resolvedValue).toBe('validated');
  });

  it('counts script errors and includes their messages', () => {
    const model = layout([
      scripted('bad', 'validate', 'var = ;'),
      scripted('good', 'validate', '$.rawValue = "ok";'),
    ]);
    const result = dispatchScripts(model, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scriptErrors).toBe(1);
      expect(result.data.scriptsExecuted).toBe(1);
      expect(result.data.errorMessages).toHaveLength(1);
      expect(result.data.errorMessages[0]).toContain('[validate]');
    }
  });

  it('orders initialize handlers children before parents', () => {
    const child = scripted('child', 'initialize', '$.rawValue = "child";');
    const parent: LayoutNode = {
      type: 'subform',
      name: 'group',
      layout: 'tb',
      children: [child],
      events: [event('initialize', '$.rawValue = "parent";')],
    };
    const model = layout([parent]);
    dispatchScripts(model, {});
    expect(child.presence).toBe('visible');
    expect(findField(model.children, 'child')?.resolvedValue).toBe('child');
  });

  it('reports calculate dependency cycles and recalculates dependents', () => {
    const a = field('a', [
      event('calculate', 'xfa.form.form.b; $.rawValue = "a1"; returnValue = $.rawValue;'),
    ]);
    const b = field('b', [
      event('calculate', 'xfa.form.form.a; $.rawValue = "b1"; returnValue = $.rawValue;'),
    ]);
    const model = layout([a, b]);
    const result = dispatchScripts(model, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        result.data.errorMessages.some((message) => message.includes('Dependency cycle'))
      ).toBe(true);
      expect(result.data.scriptsExecuted).toBeGreaterThan(2);
    }
    expect(a.resolvedValue).toBe('a1');
    expect(b.resolvedValue).toBe('b1');
  });

  it('assigns calculated results from FormCalc scripts', () => {
    const target = field('sum', [
      event('calculate', '2 + 3', { contentType: 'application/x-formcalc' }),
    ]);
    const model = layout([target]);
    const result = dispatchScripts(model, {});
    expect(result.success).toBe(true);
    expect(target.resolvedValue).toBe(5);
  });

  it('returns a failure result when the lifecycle throws', () => {
    const broken = { ...layout([]), pages: undefined } as unknown as LayoutModel;
    const result = dispatchScripts(broken, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('Script execution failed');
  });
});

describe('event dispatcher — index building', () => {
  it('indexes variables, roots, nested nodes and duplicate paths', () => {
    const duplicate = field('same');
    const model = layout(
      [
        field('same'),
        duplicate,
        {
          type: 'subform',
          name: 'group',
          layout: 'tb',
          children: [field('nested', [], { uid: 'uid-1' })],
        },
      ],
      { variables: { counter: '1' } }
    );
    const index = buildScriptIndex(model);
    expect(index.root?.name).toBe('form');
    expect(index.allNodes.has('counter')).toBe(true);
    expect(index.allNodes.has('form.same#2')).toBe(true);
    expect(index.allNodes.has('form.group.nested')).toBe(true);
    expect(index.ordered).toHaveLength(6);
  });

  it('indexes master page children', () => {
    const model = layout([], {
      pages: [
        {
          name: 'page1',
          medium: MEDIUM,
          contentArea: CONTENT,
          masterPageChildren: [field('header')],
        },
      ],
    });
    expect(buildScriptIndex(model).allNodes.has('header')).toBe(true);
  });
});

describe('event dispatcher — interactive events', () => {
  it('skips interactive scripts when configured', () => {
    const target = scripted('a', 'click', '$.rawValue = "clicked";');
    const model = layout([target]);
    const result = dispatchInteractiveEvent(
      model,
      {},
      { activity: 'click', ref: 'a', config: { skipScripts: true } }
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(0);
    expect(target.resolvedValue).toBeUndefined();
  });

  it('applies a supplied value and resolves dollar-prefixed refs', () => {
    const target = scripted('a', 'change', '$.rawValue = event.name;');
    const model = layout([target]);
    const result = dispatchInteractiveEvent(
      model,
      {},
      {
        activity: 'change',
        ref: '$$a',
        value: 'typed',
      }
    );
    expect(result.success).toBe(true);
    expect(target.resolvedValue).toBe('change');
  });

  it('skips events listed in the config', () => {
    const target = scripted('a', 'click', '$.rawValue = "clicked";');
    const model = layout([target]);
    const result = dispatchInteractiveEvent(
      model,
      {},
      {
        activity: 'click',
        ref: 'a',
        config: { skipEvents: ['click'] },
      }
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(0);
  });

  it('normalises every supported activity name', () => {
    const cases: Array<[string, string]> = [
      ['initialize', 'initialize'],
      ['calculate', 'calculate'],
      ['validate', 'validate'],
      ['click', 'click'],
      ['change', 'change'],
      ['enter', 'enter'],
      ['exit', 'exit'],
      ['mouseenter', 'mouseEnter'],
      ['mouseexit', 'mouseExit'],
      ['mouseup', 'mouseUp'],
      ['mousedown', 'mouseDown'],
      ['ready', 'ready'],
      ['docready', 'docReady'],
      ['docclose', 'docClose'],
      ['presave', 'preSave'],
      ['postsave', 'postSave'],
      ['preprint', 'prePrint'],
      ['postprint', 'postPrint'],
      ['presubmit', 'preSubmit'],
      ['postsubmit', 'postSubmit'],
      ['preexecute', 'preExecute'],
      ['postexecute', 'postExecute'],
      ['presign', 'preSign'],
      ['postsign', 'postSign'],
      ['preopen', 'preOpen'],
      ['postopen', 'postOpen'],
      ['preclose', 'preClose'],
      ['postclose', 'postClose'],
      ['validationstate', 'validationState'],
      ['overlay', 'overlay'],
      ['full', 'full'],
      ['indexchange', 'indexChange'],
      ['custom', 'custom'],
      ['', 'unknown'],
    ];
    for (const [activity, expected] of cases) {
      const target = scripted('a', expected, '$.rawValue = event.name;');
      const model = layout([target]);
      const result = dispatchInteractiveEvent(model, {}, { activity, ref: 'a' });
      expect(result.success).toBe(true);
      expect(target.resolvedValue).toBe(expected);
    }
  });

  it('uses event names when no activity is supplied on the event', () => {
    const target = field('a', [
      {
        name: 'event__click',
        script: '$.rawValue = event.name;',
        contentType: 'application/x-javascript',
      },
    ]);
    const model = layout([target]);
    const result = dispatchInteractiveEvent(model, {}, { activity: 'click', ref: 'a' });
    expect(result.success).toBe(true);
    expect(target.resolvedValue).toBe('click');
  });

  it('returns a failure result when interactive dispatch throws', () => {
    const broken = { ...layout([]), pages: undefined } as unknown as LayoutModel;
    const result = dispatchInteractiveEvent(broken, {}, { activity: 'click', ref: 'a' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('Script execution failed');
  });
});

describe('event dispatcher — post-layout scripts', () => {
  function paginated(children: LayoutNode[], pageIndex = 0): PaginatedLayout {
    return {
      rootSubformName: 'form',
      rootEvents: [],
      pages: [
        {
          pageIndex,
          medium: MEDIUM,
          contentArea: CONTENT,
          masterPageChildren: [field('header')],
          children,
        },
      ],
    };
  }

  it('skips post-layout scripts when configured', () => {
    const model = paginated([scripted('a', 'docReady', '$.rawValue = "ran";')]);
    const result = dispatchPostLayoutScripts(model, {}, { skipScripts: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.layout).toBe(model);
  });

  it('runs docReady scripts declared by activity or runAt', () => {
    const model = paginated([
      scripted('a', 'docReady', '$.rawValue = "activity";'),
      field('b', [event('initialize', '$.rawValue = "runAt";', { runAt: 'docReady' })]),
    ]);
    const result = dispatchPostLayoutScripts(model, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(2);
    expect(findField(model.pages[0].children, 'a')?.resolvedValue).toBe('activity');
    expect(findField(model.pages[0].children, 'b')?.resolvedValue).toBe('runAt');
  });

  it('skips docReady when requested', () => {
    const model = paginated([scripted('a', 'docReady', '$.rawValue = "ran";')]);
    const result = dispatchPostLayoutScripts(model, {}, { skipEvents: ['docReady'] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(0);
  });

  it('builds layout info for nested nodes and negative page indexes', () => {
    const nested = field('a', [
      event(
        'docReady',
        '$.rawValue = xfa.layout.page(this) + ":" + xfa.layout.pageContent(1) + ":" + xfa.layout.pageCount();'
      ),
    ]);
    const model = paginated(
      [{ type: 'subform', name: 'group', layout: 'tb', children: [nested] }],
      -1
    );
    const result = dispatchPostLayoutScripts(model, {});
    expect(result.success).toBe(true);
    expect(nested.resolvedValue).toBe('1:3:1');
  });

  it('returns a failure result when post-layout dispatch throws', () => {
    const broken = { ...paginated([]), pages: [{}] } as unknown as PaginatedLayout;
    const result = dispatchPostLayoutScripts(broken, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toContain('Script execution failed');
  });
});
