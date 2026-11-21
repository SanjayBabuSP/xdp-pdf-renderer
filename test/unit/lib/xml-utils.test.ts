import { parseXml, firstChild, extractRichTextContent } from '../../../src/lib/xml-utils';

describe('xml-utils robustness (ADS parity)', () => {
  it('firstChild unwraps duplicated singular children (Example-1 draw)', () => {
    const doc = parseXml(
      `<draw><value><text>A</text></value><value><text>B</text></value></draw>`
    );
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
