import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';
import { parseXsd } from '../../../../src/domain/parsing/parse-xsd';
import { parseXmlData } from '../../../../src/domain/parsing/parse-xml-data';
import { resolveBindings } from '../../../../src/domain/mapping/resolve-bindings';
import { evaluateConditions } from '../../../../src/domain/mapping/evaluate-conditions';
import { collectRelevantNodes, splitTopLevel } from '../../../../src/domain/mapping/relevance';
import { LayoutModel, LayoutNode, FieldNode, SubformNode } from '../../../../src/types';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element type="xs:string" name="flag" minOccurs="0"/>
        <xs:element type="xs:string" name="extra" minOccurs="0"/>
        <xs:element type="xs:string" name="other" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const FLAG_FIELD = `        <field name="flag" x="0" y="0" w="50pt" h="12pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.flag"/>
        </field>`;

const EXTRA_FIELD = (attrs: string): string => `        <field name="extra" x="0" y="20pt" w="50pt" h="12pt" ${attrs}>
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.extra"/>
        </field>`;

const OTHER_FIELD = `        <field name="other" x="0" y="40pt" w="50pt" h="12pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.other"/>
        </field>`;

const OTHER_DRAW = `        <draw name="other" x="0" y="40pt" w="50pt" h="12pt" relevant='flag.rawValue == "no"'>
          <value><text>draw</text></value>
        </draw>`;

function xdp(body: string, contentAttrs = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
        <medium stock="a4" short="210mm" long="297mm"/>
      </pageArea></pageSet>
      <subform name="content" layout="tb" ${contentAttrs}>
${body}
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

const DATA = `<?xml version="1.0" encoding="UTF-8"?>
<value><flag>yes</flag><extra>EXTRA</extra><other>OTHER</other></value>`;

function prepare(xdpXml: string, dataXml = DATA): { layout: LayoutModel; data: Record<string, unknown> } {
  const parsed = parseXdp(xdpXml);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('parseXdp failed');
  const schema = parseXsd(XSD);
  expect(schema.success).toBe(true);
  if (!schema.success) throw new Error('parseXsd failed');
  const data = parseXmlData(dataXml, schema.data);
  expect(data.success).toBe(true);
  if (!data.success) throw new Error('parseXmlData failed');
  const bound = resolveBindings(parsed.data, data.data);
  expect(bound.success).toBe(true);
  if (!bound.success) throw new Error('resolveBindings failed');
  return { layout: bound.data, data: data.data as Record<string, unknown> };
}

function walk(layout: LayoutModel, fn: (n: LayoutNode) => void): void {
  const visit = (nodes: LayoutNode[]): void => {
    for (const n of nodes) {
      fn(n);
      if (n.type === 'subform' || n.type === 'exclGroup') visit(n.children);
    }
  };
  visit(layout.children);
}

function findField(layout: LayoutModel, name: string): FieldNode | undefined {
  let found: FieldNode | undefined;
  walk(layout, (n) => {
    if (n.type === 'field' && n.name === name) found = n as FieldNode;
  });
  return found;
}

function findSubform(layout: LayoutModel, name: string): SubformNode | undefined {
  let found: SubformNode | undefined;
  walk(layout, (n) => {
    if (n.type === 'subform' && n.name === name) found = n as SubformNode;
  });
  return found;
}

function names(layout: LayoutModel): string[] {
  const out: string[] = [];
  walk(layout, (n) => out.push(`${n.type}:${n.name}`));
  return out;
}

describe('G2 — @relevant conditional visibility', () => {
  describe('splitTopLevel', () => {
    it('splits on a bare separator', () => {
      expect(splitTopLevel('a|b', '|')).toEqual(['a', 'b']);
    });

    it('ignores separators inside string literals', () => {
      expect(splitTopLevel('"a|b" | c', '|')).toEqual(['"a|b"', 'c']);
    });

    it('ignores separators inside brackets', () => {
      expect(splitTopLevel('f(a|b) | c', '|')).toEqual(['f(a|b)', 'c']);
    });

    it('returns a single part when there is nothing to split', () => {
      expect(splitTopLevel('x == 1', '|')).toEqual(['x == 1']);
    });
  });

  describe('collectRelevantNodes', () => {
    it('finds fields and subforms carrying @relevant, with resolved keys', () => {
      const { layout } = prepare(
        xdp(`${FLAG_FIELD}\n${EXTRA_FIELD(`relevant='flag.rawValue == "yes"'`)}`, `relevant='flag.rawValue == "yes"'`)
      );
      const nodes = collectRelevantNodes(layout);
      expect(nodes.map((n) => n.node.name).sort()).toEqual(['content', 'extra']);
      expect(nodes.every((n) => n.key !== '')).toBe(true);
    });

    it('returns nothing when no node is annotated', () => {
      const { layout } = prepare(xdp(`${FLAG_FIELD}\n${EXTRA_FIELD('')}`));
      expect(collectRelevantNodes(layout)).toEqual([]);
    });
  });

  describe('evaluateConditions — presence from @relevant', () => {
    const base = (extra: string, contentAttrs = ''): string =>
      xdp(`${FLAG_FIELD}\n${EXTRA_FIELD(extra)}\n${OTHER_FIELD}`, contentAttrs);

    it('keeps the node when the expression is true', () => {
      const { layout, data } = prepare(base(`relevant='flag.rawValue == "yes"'`));
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeDefined();
    });

    it('removes the node when the expression is false', () => {
      const { layout, data } = prepare(base(`relevant='flag.rawValue == "no"'`));
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeUndefined();
      expect(findField(result.data, 'flag')).toBeDefined();
      expect(findField(result.data, 'other')).toBeDefined();
    });

    it('resolves $ against the annotated node itself', () => {
      const { layout, data } = prepare(base(`relevant='$ == "EXTRA"'`));
      const kept = evaluateConditions(layout, data);
      expect(kept.success).toBe(true);
      if (kept.success) expect(findField(kept.data, 'extra')).toBeDefined();

      const { layout: l2, data: d2 } = prepare(base(`relevant='$ == "WRONG"'`));
      const dropped = evaluateConditions(l2, d2);
      expect(dropped.success).toBe(true);
      if (dropped.success) expect(findField(dropped.data, 'extra')).toBeUndefined();
    });

    it('hides a whole subform, taking its children with it', () => {
      const { layout, data } = prepare(base(``, `relevant='flag.rawValue == "no"'`));
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findSubform(result.data, 'content')).toBeUndefined();
      expect(findField(result.data, 'extra')).toBeUndefined();
    });

    it('supports an OR list of alternative tests', () => {
      const { layout, data } = prepare(
        base(`relevant='flag.rawValue == "no" | flag.rawValue == "yes"'`)
      );
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeDefined();
    });

    it('fails open when the expression cannot be parsed', () => {
      const { layout, data } = prepare(base(`relevant='(('`));
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeDefined();
    });

    it('fails open when an OR branch cannot be parsed', () => {
      const { layout, data } = prepare(base(`relevant='flag.rawValue == "no" | ((('`));
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeDefined();
    });

    it('ignores @relevant when no data is supplied', () => {
      const { layout } = prepare(base(`relevant='flag.rawValue == "no"'`));
      const result = evaluateConditions(layout);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeDefined();
    });

    it('does not resurrect a node already hidden by a script', () => {
      const { layout, data } = prepare(base(`relevant='flag.rawValue == "yes"'`));
      const hidden = JSON.parse(JSON.stringify(layout)) as LayoutModel;
      findField(hidden, 'extra')!.presence = 'hidden';
      const result = evaluateConditions(hidden, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(findField(result.data, 'extra')).toBeUndefined();
    });

    it('applies @relevant to <draw> nodes too', () => {
      const { layout, data } = prepare(
        xdp(`${FLAG_FIELD}\n${EXTRA_FIELD('')}\n${OTHER_DRAW}`)
      );
      expect(names(layout)).toContain('draw:other');
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(names(result.data)).not.toContain('draw:other');
      expect(names(result.data)).toContain('field:extra');
    });

    it('is a no-op when nothing carries @relevant', () => {
      const { layout, data } = prepare(xdp(`${FLAG_FIELD}\n${EXTRA_FIELD('')}\n${OTHER_FIELD}`));
      const result = evaluateConditions(layout, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(names(result.data).sort()).toEqual(names(layout).sort());
    });
  });
});
