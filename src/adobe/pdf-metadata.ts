import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { DocumentMetadata } from '../types';

/**
 * PDF document metadata — Adobe parity (G18).
 *
 * What Adobe's PDF driver writes into a generated PDF
 * (evidence: pdfldriver_disasm.c:70670-70760 XMPWrapper block, pdfldriver:63510,
 * pdfdocument_disasm.c:154831, pdfldriver:1723-1729 createAcroFormDict):
 *
 *   • XMP packet (`/Metadata` stream):
 *       xmp:MetadataDate  — now
 *       xmp:CreatorTool   — from the template
 *       pdf:Producer      — the generating driver
 *       xmpMM:DocumentID  — `uuid:<16 random bytes>`
 *       dc:title          — rdf:Alt localized text
 *       dc:creator        — rdf:Seq
 *       dc:description    — rdf:Alt localized text
 *   • Info dict (Title/Author/Producer/CreatorTool mirrors of the XMP values)
 *   • `/ViewerPreferences << /DisplayDocTitle true >>`
 *   • `/NeedsRendering true` on the catalog for dynamic XFA forms
 */

const PRODUCER = 'xdp-pdf-renderer (Adobe LiveCycle Designer compatible)';

export interface MetadataOptions {
  producer?: string;
  creatorTool?: string;
}

function xmpEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function uuid(): string {
  // RFC 4122 v4-shaped identifier (Adobe prefixes xmpMM:DocumentID with "uuid:").
  const hex = (): string =>
    [...Array(4)]
      .map(() => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0'))
      .join('');
  return `${hex()}${hex().slice(0, 4)}-4${hex().slice(1, 4)}-8${hex().slice(1, 4)}-${hex()}-${hex()}${hex()}`;
}

function buildXmpPacket(meta: DocumentMetadata, options: MetadataOptions, now: Date): string {
  const creatorTool = options.creatorTool ?? 'Adobe LiveCycle Designer 11.0';
  const producer = options.producer ?? PRODUCER;
  const title = meta.title ?? '';
  const description = meta.description ?? '';
  const author = meta.author ?? '';
  const date = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${xmpEscape(producer)}">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${xmpEscape(title)}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${xmpEscape(description)}</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:creator>
    <rdf:Seq>
     <rdf:li>${xmpEscape(author)}</rdf:li>
    </rdf:Seq>
   </dc:creator>
   <xmp:CreatorTool>${xmpEscape(creatorTool)}</xmp:CreatorTool>
   <xmp:MetadataDate>${date}</xmp:MetadataDate>
   <xmp:ModifyDate>${date}</xmp:ModifyDate>
   <pdf:Producer>${xmpEscape(producer)}</pdf:Producer>
   <xmpMM:DocumentID>uuid:${uuid()}</xmpMM:DocumentID>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Write the metadata block Adobe's driver emits. Call once per document,
 * before security is applied (the XMP stream participates in encryption).
 */
export function applyDocumentMetadata(
  doc: PDFDocument,
  meta: DocumentMetadata | undefined,
  options: MetadataOptions = {},
): void {
  const now = new Date();
  const title = meta?.title ?? '';
  const author = meta?.author ?? '';
  const producer = options.producer ?? PRODUCER;
  const creatorTool = options.creatorTool ?? 'Adobe LiveCycle Designer 11.0';

  // Info dict — pdf-lib writes /Title /Author /Producer /Creator /CreationDate.
  if (title) doc.setTitle(title);
  if (author) doc.setAuthor(author);
  doc.setProducer(producer);
  doc.setCreator(creatorTool);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  // XMP /Metadata stream.
  const xml = buildXmpPacket(meta ?? {}, options, now);
  const stream = doc.context.flateStream(xml);
  const dict = stream.dict;
  dict.set(PDFName.of('Type'), PDFName.of('Metadata'));
  dict.set(PDFName.of('Subtype'), PDFName.of('XML'));
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));

  // /ViewerPreferences << /DisplayDocTitle true >> — Adobe always writes true
  // when the title is present (pdfldriver_disasm.c:63510).
  if (title) {
    const prefs = PDFDict.withContext(doc.context);
    prefs.set(PDFName.of('DisplayDocTitle'), doc.context.obj(true));
    doc.catalog.set(PDFName.of('ViewerPreferences'), prefs);
  }
}

/**
 * pdf-lib's `save()` unconditionally restamps `/Producer` with its own string
 * (`PDFDocument.updateInfoDict`). Wrap it so the Adobe-parity values survive
 * serialization. Must be called before the first save.
 */
export function preserveInfoOverrides(doc: PDFDocument, options: MetadataOptions = {}): void {
  const producer = options.producer ?? PRODUCER;
  const creatorTool = options.creatorTool ?? 'Adobe LiveCycle Designer 11.0';
  const patchable = doc as unknown as {
    updateInfoDict?: () => void;
    setProducer(value: string): void;
    setCreator(value: string): void;
  };
  const original = patchable.updateInfoDict?.bind(doc);
  patchable.updateInfoDict = (): void => {
    original?.();
    patchable.setProducer(producer);
    patchable.setCreator(creatorTool);
  };
}

/**
 * `/NeedsRendering true` — the XFA dynamic-form switch Adobe's
 * createAcroFormDict writes for XFA forms (pdfldriver_disasm.c:1729).
 */
export function setNeedsRendering(doc: PDFDocument): void {
  doc.catalog.set(PDFName.of('NeedsRendering'), doc.context.obj(true));
}

export type { PDFRawStream };
