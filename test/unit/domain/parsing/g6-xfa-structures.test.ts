import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';
import { buildScriptIndex } from '../../../../src/domain/scripting/event-dispatcher';
import { createFieldAccessor } from '../../../../src/domain/scripting/xfa-object-model';
import { createXfaFormProxy } from '../../../../src/domain/scripting/js-engine/xfa-form-proxy';
import { FormCalcParser } from '../../../../src/domain/scripting/formcalc/parser';
import { FormCalcEvaluator } from '../../../../src/domain/scripting/formcalc/evaluator';
import { formatValue } from '../../../../src/lib/value-format';
import { LayoutModel, LayoutNode, FieldNode, SubformNode, DrawNode, ExclGroupNode } from '../../../../src/types';

/**
 * G6 — XFA structures that were parsed-or-dropped but never used:
 * `<assist>`, `<extras>`, `<traversal>`, `<subformSet>`, `<area>`,
 * value/format `<picture>`, and nested non-field children of `<exclGroup>`.
 */

const PAGE = `
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>`;

function parseTemplate(inner: string): LayoutModel {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      ${PAGE}
      ${inner}
    </subform>
  </template>
</xdp:xdp>`;
  const result = parseXdp(xml);
  if (!result.success) throw new Error(`parse failed: ${result.error.message}`);
  return result.data;
}

function byName(nodes: LayoutNode[], name: string): LayoutNode | undefined {
  return nodes.find((n) => n.name === name);
}

function field(name: string, inner = ''): FieldNode {
  const node = byName(parseTemplate(`<field name="${name}">${inner}</field>`).children, name);
  return node as FieldNode;
}

function subform(name: string, inner = ''): SubformNode {
  const node = byName(parseTemplate(`<subform name="${name}">${inner}</subform>`).children, name);
  return node as SubformNode;
}

// ─── <assist> ────────────────────────────────────────────────────────────────

describe('G6 — <assist>', () => {
  it('parses toolTip / description / name / usage on a field', () => {
    const f = field(
      'n',
      `<assist>
         <toolTip>Hover me</toolTip>
         <description>Serial number</description>
         <name>Serial</name>
         <usage>readOnly</usage>
       </assist>`
    );
    expect(f.assist).toEqual({
      toolTip: 'Hover me',
      description: 'Serial number',
      name: 'Serial',
      usage: 'readOnly',
    });
  });

  it('parses onto subform, draw and exclGroup too', () => {
    expect(subform('s', '<assist><toolTip>T</toolTip></assist>').assist).toEqual({
      toolTip: 'T',
    });
    const draw = byName(
      parseTemplate('<draw name="d"><assist><toolTip>DT</toolTip></assist></draw>').children,
      'd'
    ) as DrawNode;
    expect(draw.assist).toEqual({ toolTip: 'DT' });
    const eg = byName(
      parseTemplate('<exclGroup name="g"><assist><toolTip>GT</toolTip></assist></exclGroup>')
        .children,
      'g'
    ) as ExclGroupNode;
    expect(eg.assist).toEqual({ toolTip: 'GT' });
  });

  it('is reachable from FormCalc as $.assist.toolTip', () => {
    const layout = parseTemplate(
      `<field name="n">
         <assist><toolTip>Hover me</toolTip></assist>
         <event activity="formReady"><script contentType="formcalc">if $.assist.toolTip == "Hover me" then $.rawValue = "ok" else $.rawValue = "bad" end if</script></event>
       </field>`
    );
    const index = buildScriptIndex(layout);
    const self = index.allNodes.get('value.n');
    expect(self).toBeDefined();
    const acc = createFieldAccessor(index.allNodes, {});
    acc.setCurrentKey?.(self!.key ?? null);
    new FormCalcEvaluator(acc).evaluate(
      new FormCalcParser(
        `if $.assist.toolTip == "Hover me" then $.rawValue = "ok" else $.rawValue = "bad" end if`
      ).parse()
    );
    expect(self!.resolvedValue).toBe('ok');
  });

  it('supports writing $.assist.toolTip back onto the layout node', () => {
    const layout = parseTemplate(
      `<field name="n"><assist><toolTip>old</toolTip></assist></field>`
    );
    const index = buildScriptIndex(layout);
    const self = index.allNodes.get('value.n')!;
    const acc = createFieldAccessor(index.allNodes, {});
    acc.setCurrentKey?.(self.key ?? null);
    new FormCalcEvaluator(acc).evaluate(
      new FormCalcParser(`$.assist.toolTip = "new"`).parse()
    );
    expect((self.layoutNode as FieldNode).assist?.toolTip).toBe('new');
  });

  it('is readable and writable through the JavaScript $ proxy', () => {
    const layout = parseTemplate(
      `<field name="n"><assist><toolTip>js tip</toolTip></assist></field>`
    );
    const index = buildScriptIndex(layout);
    const proxy = createXfaFormProxy(index.allNodes, 'value.n', []);
    expect((proxy as unknown as { assist: { toolTip: string } }).assist.toolTip).toBe('js tip');
    (proxy as unknown as { assist: { toolTip: string } }).assist.toolTip = 'changed';
    expect((layout.children[0] as FieldNode).assist?.toolTip).toBe('changed');
  });
});

// ─── <extras> ────────────────────────────────────────────────────────────────

describe('G6 — <extras>', () => {
  it('parses @value and element-text entries', () => {
    const f = field('n', '<extras><owner value="QA"/><revision>3</revision></extras>');
    expect(f.extras).toEqual({ owner: 'QA', revision: '3' });
  });

  it('is readable as $.extras.<key> from FormCalc', () => {
    const layout = parseTemplate(
      `<field name="n"><extras><owner value="QA"/></extras></field>`
    );
    const index = buildScriptIndex(layout);
    const self = index.allNodes.get('value.n')!;
    const acc = createFieldAccessor(index.allNodes, {});
    acc.setCurrentKey?.(self.key ?? null);
    new FormCalcEvaluator(acc).evaluate(
      new FormCalcParser(`if $.extras.owner == "QA" then $.rawValue = "ok" end if`).parse()
    );
    expect(self.resolvedValue).toBe('ok');
  });

  it('is readable through the JavaScript $ proxy', () => {
    const layout = parseTemplate(`<field name="n"><extras><owner value="QA"/></extras></field>`);
    const index = buildScriptIndex(layout);
    const proxy = createXfaFormProxy(index.allNodes, 'value.n', []) as unknown as {
      extras: Record<string, string>;
    };
    expect(proxy.extras.owner).toBe('QA');
  });
});

// ─── <traversal> ─────────────────────────────────────────────────────────────

describe('G6 — <traversal>', () => {
  it('parses the authored focus order onto the container', () => {
    const s = subform(
      's',
      `<traversal order="tab"><field name="a"/><field name="b"/></traversal>`
    );
    expect(s.traversal).toEqual({ order: 'tab', fields: ['a', 'b'] });
  });

  it('parses onto a field as well', () => {
    const f = field('n', '<traversal order="tab"/>');
    expect(f.traversal).toEqual({ order: 'tab' });
  });
});

// ─── <subformSet> / <area> ───────────────────────────────────────────────────

describe('G6 — <subformSet> and <area>', () => {
  it('instantiates the @initial alternative instead of dropping the whole set', () => {
    const layout = parseTemplate(
      `<subformSet name="set" initial="1">
         <subform name="alt0"><field name="zero"/></subform>
         <subform name="alt1"><field name="one"/></subform>
       </subformSet>`
    );
    const set = byName(layout.children, 'set') as SubformNode;
    expect(set).toBeDefined();
    expect(set.children).toHaveLength(1);
    const alt = set.children[0] as SubformNode;
    expect(alt.name).toBe('alt1');
    expect(alt.children.map((c) => c.name)).toEqual(['one']);
  });

  it('defaults to the first alternative when @initial is absent', () => {
    const layout = parseTemplate(
      `<subformSet name="set">
         <subform name="alt0"><field name="zero"/></subform>
         <subform name="alt1"><field name="one"/></subform>
       </subformSet>`
    );
    const set = byName(layout.children, 'set') as SubformNode;
    expect(set.children[0].name).toBe('alt0');
  });

  it('renders <area> as a subform-shaped container', () => {
    const layout = parseTemplate(`<area name="A"><field name="f"/></area>`);
    const area = byName(layout.children, 'A') as SubformNode;
    expect(area).toBeDefined();
    expect(area.type).toBe('subform');
    expect(area.children.map((c) => c.name)).toEqual(['f']);
  });
});

// ─── <exclGroup> non-field children ──────────────────────────────────────────

describe('G6 — nested subforms/draws inside <exclGroup>', () => {
  it('keeps field, draw and subform children (previously field-only)', () => {
    const layout = parseTemplate(
      `<exclGroup name="g">
         <field name="f"/>
         <draw name="d"/>
         <subform name="s"><field name="inner"/></subform>
       </exclGroup>`
    );
    const g = byName(layout.children, 'g') as ExclGroupNode;
    // parseChildren groups by element type (fast-xml-parser object keys), so
    // assert membership rather than interleaved document order.
    expect(g.children.map((c) => `${c.type}:${c.name}`).sort()).toEqual([
      'draw:d',
      'field:f',
      'subform:s',
    ]);
    const nested = g.children.find((c) => c.type === 'subform') as SubformNode;
    expect(nested.children.map((c) => c.name)).toEqual(['inner']);
  });
});

// ─── <picture> / <format> ────────────────────────────────────────────────────

describe('G6 — display picture resolution', () => {
  it('prefers <format><picture> over <bind><picture>', () => {
    const f = field(
      'n',
      `<bind match="dataRef" ref="$.n"><picture>###,###.##</picture></bind>
       <format><picture>($###,###.##)</picture></format>`
    );
    expect(f.formatPicture).toBe('($###,###.##)');
    expect(formatValue(1234.5, f.formatPicture)).toBe('($1,234.50)');
  });

  it('falls back to <value><picture>', () => {
    const f = field(
      'n',
      `<bind match="dataRef" ref="$.n"/>
       <value><picture>##.##</picture><float value="1"/></value>`
    );
    expect(f.formatPicture).toBe('##.##');
  });

  it('falls back to <bind><picture> when no display picture exists', () => {
    const f = field(
      'n',
      `<bind match="dataRef" ref="$.n"><picture>###.##</picture></bind>`
    );
    expect(f.formatPicture).toBe('###.##');
  });
});
