import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { XMLBuilder } from 'fast-xml-parser';
import { parseXml } from '../lib/xml-utils';

export interface XfaPacket {
  name: string;
  xml: string;
}

export function extractXfaPackets(xdpXml: string): XfaPacket[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xdpXml);
  } catch {
    return [{ name: 'xdp', xml: xdpXml }];
  }

  const root = (parsed['xdp:xdp'] ?? parsed['xdp'] ?? parsed) as Record<string, unknown>;
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    commentPropName: '__comment',
    format: false,
    suppressEmptyNode: true,
  });

  const packets: XfaPacket[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (key.startsWith('@_') || key === '__comment' || key === '#text') continue;
    const name = key.includes(':') ? key.split(':').pop()! : key;
    for (const entry of Array.isArray(value) ? value : [value]) {
      packets.push({ name, xml: builder.build({ [key]: entry }) });
    }
  }
  return packets.length ? packets : [{ name: 'xdp', xml: xdpXml }];
}

export function embedXfaPackage(doc: PDFDocument, xdpXml: string): void {
  const context = doc.context;

  const existing = doc.catalog.get(PDFName.of('AcroForm'));
  let acroForm: PDFDict;
  if (existing) {
    acroForm = context.lookup(existing) as PDFDict;
  } else {
    acroForm = PDFDict.withContext(context);
    acroForm.set(PDFName.of('Fields'), context.obj([]));
    doc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));
  }

  const xfa = PDFArray.withContext(context);
  for (const packet of extractXfaPackets(xdpXml)) {
    xfa.push(PDFString.of(packet.name));
    xfa.push(context.register(context.flateStream(packet.xml)));
  }
  acroForm.set(PDFName.of('XFA'), xfa);
}
