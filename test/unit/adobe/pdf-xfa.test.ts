import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFRef,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import { extractXfaPackets, embedXfaPackage } from '../../../src/adobe/pdf-xfa';

const decoded = (value: PDFObject | undefined): string => (value as PDFString).decodeText();
const packetText = (doc: PDFDocument, ref: PDFRef): string =>
  new TextDecoder().decode(
    decodePDFRawStream(doc.context.lookup(ref, PDFStream) as PDFRawStream).decode()
  );

describe('G16 — XFA packet handling', () => {
  it('extracts packets from a namespaced XDP root and strips attributes from names', () => {
    const xml =
      '<xdp:xdp xmlns:xdp="u"><template name="t"><subform>Hello</subform></template>' +
      '<datasets><data>42</data></datasets></xdp:xdp>';

    const packets = extractXfaPackets(xml);

    expect(packets).toEqual([
      { name: 'template', xml: '<template name="t"><subform>Hello</subform></template>' },
      { name: 'datasets', xml: '<datasets><data>42</data></datasets>' },
    ]);
  });

  it('emits one packet per repeated child element', () => {
    const packets = extractXfaPackets('<xdp><template>A</template><template>B</template></xdp>');

    expect(packets).toEqual([
      { name: 'template', xml: '<template>A</template>' },
      { name: 'template', xml: '<template>B</template>' },
    ]);
  });

  it('ignores comments and text nodes at the root', () => {
    const packets = extractXfaPackets(
      '<xdp><!-- note --><template>A</template>trailing text</xdp>'
    );

    expect(packets).toEqual([{ name: 'template', xml: '<template>A</template>' }]);
  });

  it('falls back to the whole document when parsing yields no packets', () => {
    expect(extractXfaPackets('')).toEqual([{ name: 'xdp', xml: '' }]);
  });

  it('embeds packets as alternating names and flate streams in a new AcroForm', async () => {
    const doc = await PDFDocument.create();
    const xml = '<xdp><template>A</template><template>B</template></xdp>';

    embedXfaPackage(doc, xml);

    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect(acroForm.lookup(PDFName.of('Fields'), PDFArray).size()).toBe(0);
    const xfa = acroForm.lookup(PDFName.of('XFA'), PDFArray);
    expect(xfa.size()).toBe(4);
    expect(decoded(xfa.get(0))).toBe('template');
    expect(decoded(xfa.get(2))).toBe('template');
    expect(packetText(doc, xfa.get(1) as PDFRef)).toBe('<template>A</template>');
    expect(packetText(doc, xfa.get(3) as PDFRef)).toBe('<template>B</template>');
    const stream = doc.context.lookup(xfa.get(1) as PDFRef, PDFStream) as PDFRawStream;
    expect(decoded(stream.dict.get(PDFName.of('Filter')))).toBe('FlateDecode');
  });

  it('preserves an existing AcroForm field list when embedding', async () => {
    const doc = await PDFDocument.create();
    const fieldRef = doc.context.register(doc.context.obj({ T: 'existing' }));
    const acroForm = PDFDict.withContext(doc.context);
    acroForm.set(PDFName.of('Fields'), doc.context.obj([fieldRef]));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(acroForm));

    embedXfaPackage(doc, '<xdp><datasets>D</datasets></xdp>');

    const fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
    expect(fields.size()).toBe(1);
    expect(decoded(fields.lookup(0, PDFDict).get(PDFName.of('T')))).toBe('existing');
    const xfa = acroForm.lookup(PDFName.of('XFA'), PDFArray);
    expect(xfa.size()).toBe(2);
    expect(decoded(xfa.get(0))).toBe('datasets');
  });
});
