import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';

export interface TaggedOptions {
  language?: string;
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
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
  });

  documentElement.set(PDFName.of('P'), context.register(structTreeRoot));
  structTreeRoot.set(PDFName.of('K'), context.register(documentElement));
  doc.catalog.set(PDFName.of('StructTreeRoot'), context.register(structTreeRoot));
}
