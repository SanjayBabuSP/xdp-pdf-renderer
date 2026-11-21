import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { DocumentMetadata } from '../types';

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

  if (title) doc.setTitle(title);
  if (author) doc.setAuthor(author);
  doc.setProducer(producer);
  doc.setCreator(creatorTool);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  const xml = buildXmpPacket(meta ?? {}, options, now);
  const stream = doc.context.flateStream(xml);
  const dict = stream.dict;
  dict.set(PDFName.of('Type'), PDFName.of('Metadata'));
  dict.set(PDFName.of('Subtype'), PDFName.of('XML'));
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));

  if (title) {
    const prefs = PDFDict.withContext(doc.context);
    prefs.set(PDFName.of('DisplayDocTitle'), doc.context.obj(true));
    doc.catalog.set(PDFName.of('ViewerPreferences'), prefs);
  }
}

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

export function setNeedsRendering(doc: PDFDocument): void {
  doc.catalog.set(PDFName.of('NeedsRendering'), doc.context.obj(true));
}

export type { PDFRawStream };
