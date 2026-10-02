import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { XMLBuilder } from 'fast-xml-parser';
import { parseXml } from '../lib/xml-utils';

/**
 * `/XFA` package embedding (G12).
 *
 * The `/XFA` entry of the AcroForm dictionary carries the original XDP packets
 * so Acrobat can reconstruct the live (dynamic) form. It is a flat array that
 * alternates packet name and stream, e.g.:
 *
 *   /XFA [ (template) 12 0 R (datasets) 13 0 R (config) 14 0 R ]
 *
 * See PDF 2.0 §12.7.8 / Adobe PDF XFA supplement.
 */

export interface XfaPacket {
  name: string;
  xml: string;
}

/**
 * Split the XDP into its top-level packets. Re-serialised from the parsed tree
 * so namespace prefixes and attributes survive.
 */
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
  return packets.length > 0 ? packets : [{ name: 'xdp', xml: xdpXml }];
}

/** Embed the XDP packets into the document's AcroForm `/XFA` entry. */
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
