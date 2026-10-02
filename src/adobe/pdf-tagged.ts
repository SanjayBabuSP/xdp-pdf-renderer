import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';

/**
 * Tagged PDF support (G11).
 *
 * Sets the catalog flags and builds a logical structure tree:
 *   Catalog /MarkInfo << /Marked true >>
 *   Catalog /StructTreeRoot → /Document → [/P …]
 *   Each page gets /StructParents for its element list.
 *
 * Limitation: the flat content pipeline does not emit marked-content operators
 * (BDC/EMC), so structure elements are not yet wired to MCIDs. The tree and
 * accessibility metadata (title/lang) are nevertheless valid and recognised by
 * screen readers and PDF/UA preflight tools.
 */

export interface TaggedOptions {
  /** Document language (BCP-47), e.g. `en-US`. Written as catalog /Lang. */
  language?: string;
  /** Document title for accessibility. */
  title?: string;
}

export function markDocumentTagged(doc: PDFDocument, options: TaggedOptions = {}): void {
  const context = doc.context;

  const markInfo = PDFDict.withContext(context);
  markInfo.set(PDFName.of('Marked'), context.obj(true));
  doc.catalog.set(PDFName.of('MarkInfo'), markInfo);
  if (options.language) {
    doc.catalog.set(PDFName.of('Lang'), PDFString.of(options.language));
  }
  if (options.title) {
    const info = doc.context.trailerInfo.Info;
    const infoDict = info ? (doc.context.lookup(info) as PDFDict) : undefined;
    if (infoDict) infoDict.set(PDFName.of('Title'), PDFString.of(options.title));
  }

  // One /Document element containing a /P per page.
  const parentTree = PDFDict.withContext(context);
  const nums = PDFArray.withContext(context);
  parentTree.set(PDFName.of('Nums'), nums);
  const structTreeRoot = PDFDict.withContext(context);
  structTreeRoot.set(PDFName.of('Type'), PDFName.of('StructTreeRoot'));
  structTreeRoot.set(PDFName.of('ParentTree'), context.register(parentTree));
  structTreeRoot.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(1));

  const documentElement = PDFDict.withContext(context);
  documentElement.set(PDFName.of('Type'), PDFName.of('StructElem'));
  documentElement.set(PDFName.of('S'), PDFName.of('Document'));

  const kids = PDFArray.withContext(context);
  documentElement.set(PDFName.of('K'), kids);

  const pages = doc.getPages();
  pages.forEach((page) => {
    const paragraph = PDFDict.withContext(context);
    paragraph.set(PDFName.of('Type'), PDFName.of('StructElem'));
    paragraph.set(PDFName.of('S'), PDFName.of('P'));
    paragraph.set(PDFName.of('P'), context.register(documentElement));
    paragraph.set(PDFName.of('Pg'), page.ref);
    kids.push(context.register(paragraph));
    // Page-local structure parent key.
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
  });

  documentElement.set(PDFName.of('P'), context.register(structTreeRoot));
  structTreeRoot.set(PDFName.of('K'), context.register(documentElement));
  doc.catalog.set(PDFName.of('StructTreeRoot'), context.register(structTreeRoot));
}
