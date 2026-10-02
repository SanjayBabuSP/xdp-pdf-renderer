import {
  resolveXfaEmbedsInHtml,
  buildEmbedIndex,
} from '../../../../src/domain/mapping/resolve-embeds';
import { LayoutModel, FieldNode, DrawNode } from '../../../../src/types';

const target = (raw: string, formatted = raw) => ({ raw, formatted });
const lookup = (id: string) => (id === 'unit' ? target('kg/m3', 'KG/M3') : undefined);

describe('xfa:embed resolution', () => {
  it('substitutes a self-closing span in real markup', () => {
    const html =
      '<body><p><span xfa:embedType="uri" xfa:embedMode="raw" xfa:embed="#unit"/></p></body>';
    expect(resolveXfaEmbedsInHtml(html, lookup)).toBe('<body><p>kg/m3</p></body>');
  });

  it('substitutes an entity-escaped span (how XDP stores exData)', () => {
    const html =
      '&lt;p&gt;&lt;span xfa:embedType="uri" xfa:embedMode="raw" xfa:embed="#unit"/&gt;&lt;/p&gt;';
    expect(resolveXfaEmbedsInHtml(html, lookup)).toBe('&lt;p&gt;kg/m3&lt;/p&gt;');
  });

  it('consumes an explicit closing tag after the span', () => {
    expect(resolveXfaEmbedsInHtml('<span xfa:embed="#unit"></span>', lookup)).toBe('KG/M3');
  });

  it('honours embedMode', () => {
    expect(resolveXfaEmbedsInHtml('<span xfa:embedMode="raw" xfa:embed="#unit"/>', lookup)).toBe(
      'kg/m3'
    );
    expect(
      resolveXfaEmbedsInHtml('<span xfa:embedMode="formatted" xfa:embed="#unit"/>', lookup)
    ).toBe('KG/M3');
    expect(resolveXfaEmbedsInHtml('<span xfa:embed="#unit"/>', lookup)).toBe('KG/M3');
  });

  it('drops a reference that resolves to nothing instead of throwing', () => {
    expect(resolveXfaEmbedsInHtml('<span xfa:embed="#nope"/>', lookup)).toBe('');
  });

  it('does not confuse xfa:embedType / xfa:embedMode with the reference', () => {
    const html = '<span xfa:embedType="uri" xfa:embedMode="raw">text</span>';
    expect(resolveXfaEmbedsInHtml(html, lookup)).toBe(html);
  });

  it('leaves content without any embed untouched', () => {
    const html = '<body><p>hello</p></body>';
    expect(resolveXfaEmbedsInHtml(html, lookup)).toBe(html);
  });

  it('does not swallow a neighbouring tag when searching backwards for the open angle', () => {
    const html =
      '<div><span xfa:embedType="uri" xfa:embedMode="raw" xfa:embed="#unit"/></div>';
    expect(resolveXfaEmbedsInHtml(html, lookup)).toBe('<div>kg/m3</div>');
  });
});

describe('buildEmbedIndex', () => {
  const field = (
    name: string,
    uid: string,
    value: unknown,
    formatPicture?: string
  ): FieldNode => ({
    type: 'field',
    name,
    uid,
    presence: 'hidden',
    resolvedValue: value,
    formatPicture,
  });

  const layout: LayoutModel = {
    rootSubformName: 'Form1',
    pages: [],
    children: [
      field('unitField', 'unit', 'kg/m3'),
      field('measuredField', 'measured', 12.345, '0.00'),
    ],
  };

  it('indexes hidden fields by uid and by name', () => {
    const index = buildEmbedIndex(layout);
    expect(index.get('unit')?.raw).toBe('kg/m3');
    expect(index.get('unitField')?.raw).toBe('kg/m3');
  });

  it('applies the format picture for the formatted variant', () => {
    const index = buildEmbedIndex(layout);
    expect(index.get('measured')?.raw).toBe('12.345');
    expect(index.get('measured')?.formatted).toBe('12.35');
  });

  it('substitutes through the whole draw', () => {
    const draw: DrawNode = {
      type: 'draw',
      name: 'host',
      value: {
        type: 'richText',
        contentType: 'text/html',
        content: '<p><span xfa:embedMode="raw" xfa:embed="#unit"/></p>',
      },
    };
    const model: LayoutModel = { ...layout, children: [...layout.children, draw] };
    const index = buildEmbedIndex(model);
    expect(resolveXfaEmbedsInHtml(draw.value!.content!, (id) => index.get(id))).toBe(
      '<p>kg/m3</p>'
    );
  });
});
