import {
  parseXml,
  firstChild,
  extractRichTextContent,
  decodeXmlEntities,
  stripProcessingInstructions,
  serializeHtmlFragment,
  textContent,
  getChild,
  toArray,
  attr,
} from '../../../src/lib/xml-utils';

describe('xml-utils robustness (ADS parity)', () => {
  it('firstChild unwraps duplicated singular children (Example-1 draw)', () => {
    const doc = parseXml(`<draw><value><text>A</text></value><value><text>B</text></value></draw>`);
    const draw = (doc as Record<string, unknown>).draw;
    expect(firstChild(draw, 'value')).toEqual({ text: 'A' });
  });

  it('extracts caption text from rich-text exData', () => {
    const doc = parseXml(
      `<caption><value><exData contentType="text/html">` +
        `<body xmlns="http://www.w3.org/1999/xhtml"><p>AKJSZ MGYAWXDT:` +
        `<span style="xfa-spacerun:yes">x</span>` +
        `<span>+</span></p></body></exData></value></caption>`
    );
    const cap = (doc as Record<string, unknown>).caption as Record<string, unknown>;
    const exData = (cap.value as Record<string, unknown>).exData;
    expect(extractRichTextContent(exData)).toBe('AKJSZ MGYAWXDT:x+');
  });
});

describe('xml-utils helpers', () => {
  it('strips non-XML processing instructions but keeps the XML declaration', () => {
    const source = '<?xml version="1.0"?><?custom target?>body';
    expect(stripProcessingInstructions(source)).toBe('<?xml version="1.0"?>body');
  });

  it('rejects input larger than the configured maximum', () => {
    expect(() => parseXml('<a/>', 2)).toThrow('XML input exceeds maximum size of 2 bytes');
  });

  it('decodes every named XML entity', () => {
    expect(decodeXmlEntities('plain')).toBe('plain');
    expect(decodeXmlEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
  });

  it('decodes decimal and hexadecimal character references', () => {
    expect(decodeXmlEntities('&#65;&#x42;&#x1F600;')).toBe('AB😀');
  });

  it('leaves out-of-range character references untouched', () => {
    expect(decodeXmlEntities('&#1114112;')).toBe('&#1114112;');
    expect(decodeXmlEntities('&#-5;')).toBe('&#-5;');
  });

  it('reads children, arrays and attributes', () => {
    expect(getChild(null, 'x')).toBeUndefined();
    expect(getChild(5, 'x')).toBeUndefined();
    expect(getChild({ x: 1 }, 'x')).toBe(1);
    expect(toArray<number>(null)).toEqual([]);
    expect(toArray<number>([1, 2])).toEqual([1, 2]);
    expect(toArray<number>(3)).toEqual([3]);
    expect(attr({ '@_id': 'a', id: 'b' }, 'id')).toBe('a');
    expect(attr({}, 'id')).toBeUndefined();
  });

  it('extracts rich text with and without a body wrapper', () => {
    expect(extractRichTextContent(null)).toBeUndefined();
    expect(extractRichTextContent({})).toBeUndefined();
    expect(extractRichTextContent({ body: { '#text': 'plain' } })).toBe('plain');
    expect(extractRichTextContent({ p: ['first', 'second'] })).toBe('first\nsecond');
  });

  it('serializes fragments including text, cdata, comments and attributes', () => {
    expect(serializeHtmlFragment(null)).toBe('');
    expect(serializeHtmlFragment('text')).toBe('text');
    expect(serializeHtmlFragment(42)).toBe('42');
    expect(serializeHtmlFragment([{ b: 'x' }, 'y'])).toBe('<b>x</b>y');
    expect(serializeHtmlFragment({ '#text': 'a', __cdata: 'b', '@_id': 'x', __comment: 'c' })).toBe(
      'ab'
    );
    expect(serializeHtmlFragment({ p: { '@_class': 'c', '#text': 'hi' } })).toBe(
      '<p class="c">hi</p>'
    );
    expect(serializeHtmlFragment({ p: { '@_title': 'a"b&c&amp;' } })).toBe(
      '<p title="a&quot;b&amp;c&amp;"></p>'
    );
  });

  it('serializes null, numeric and non-object element values', () => {
    expect(serializeHtmlFragment({ a: null, b: 7, c: true })).toBe('<a></a><b>7</b><c></c>');
  });

  it('reads text and cdata content in every combination', () => {
    expect(textContent(null)).toBeUndefined();
    expect(textContent('hi')).toBe('hi');
    expect(textContent(7)).toBe('7');
    expect(textContent({ '#text': 'a', __cdata: 'b' })).toBe('ba');
    expect(textContent({ '#text': 'a' })).toBe('a');
    expect(textContent({ __cdata: 'b' })).toBe('b');
    expect(textContent({})).toBeUndefined();
  });
});
