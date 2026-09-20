// ────────────────────────────────────────────────────────────────────────────
// PDF Annotations — Widget, text, stamp, and markup annotations
// ────────────────────────────────────────────────────────────────────────────

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFString,
  rgb,
  RGB,
  AnnotationFlags,
  PDFAnnotation,
} from 'pdf-lib';

export type AnnotationType = 'widget' | 'text' | 'stamp' | 'highlight' | 'link' | 'freeText' | 'line';

export interface AnnotationOptions {
  type: AnnotationType;
  /** Bounding rectangle [x1, y1, x2, y2] */
  rect: [number, number, number, number];
  /** Page index (0-based) */
  pageIndex: number;
  /** Content/text for the annotation */
  contents?: string;
  /** Subject line */
  subject?: string;
  /** Author name */
  author?: string;
  /** Creation date */
  creationDate?: Date;
  /** Annotation flags */
  flags?: AnnotationFlag[];
  /** Border color */
  borderColor?: RGB;
  /** Background color */
  backgroundColor?: RGB;
  /** Opacity (0-1) */
  opacity?: number;
  /** For link annotations: URL or page destination */
  linkTarget?: string;
  /** For stamp annotations: stamp name */
  stampName?: string;
  /** For freeText: font size */
  fontSize?: number;
  /** For freeText: text color */
  textColor?: RGB;
  /** For widget: associated field name */
  fieldName?: string;
  /** For widget: field value */
  fieldValue?: string;
}

export type AnnotationFlag =
  | 'invisible'
  | 'hidden'
  | 'print'
  | 'noZoom'
  | 'noRotate'
  | 'noView'
  | 'readOnly'
  | 'locked'
  | 'toggleNoView'
  | 'lockedContents';

const FLAG_MAP: Record<AnnotationFlag, number> = {
  invisible: AnnotationFlags.Invisible,
  hidden: AnnotationFlags.Hidden,
  print: AnnotationFlags.Print,
  noZoom: AnnotationFlags.NoZoom,
  noRotate: AnnotationFlags.NoRotate,
  noView: AnnotationFlags.NoView,
  readOnly: AnnotationFlags.ReadOnly,
  locked: AnnotationFlags.Locked,
  toggleNoView: AnnotationFlags.ToggleNoView,
  lockedContents: AnnotationFlags.LockedContents,
};

/**
 * Add an annotation to a PDF page.
 */
export function addAnnotation(doc: PDFDocument, options: AnnotationOptions): PDFAnnotation | null {
  const context = doc.context;
  const pages = doc.getPages();

  if (options.pageIndex < 0 || options.pageIndex >= pages.length) return null;
  const page = pages[options.pageIndex];

  // Create annotation dictionary
  const annotDict = context.obj({}) as PDFDict;

  // Type
  const typeMap: Record<AnnotationType, string> = {
    widget: 'Widget',
    text: 'Text',
    stamp: 'Stamp',
    highlight: 'Highlight',
    link: 'Link',
    freeText: 'FreeText',
    line: 'Line',
  };
  annotDict.set(PDFName.of('Type'), PDFName.of('Annot'));
  annotDict.set(PDFName.of('Subtype'), PDFName.of(typeMap[options.type]));

  // Rectangle
  const rect = context.obj([]) as PDFArray;
  rect.push(PDFNumber.of(options.rect[0]));
  rect.push(PDFNumber.of(options.rect[1]));
  rect.push(PDFNumber.of(options.rect[2]));
  rect.push(PDFNumber.of(options.rect[3]));
  annotDict.set(PDFName.of('Rect'), rect);

  // Contents
  if (options.contents) {
    annotDict.set(PDFName.of('Contents'), PDFString.of(options.contents));
  }

  // Subject
  if (options.subject) {
    annotDict.set(PDFName.of('Subj'), PDFString.of(options.subject));
  }

  // Author
  if (options.author) {
    annotDict.set(PDFName.of('T'), PDFString.of(options.author));
  }

  // Flags
  if (options.flags && options.flags.length > 0) {
    let flags = 0;
    for (const flag of options.flags) {
      flags |= FLAG_MAP[flag] ?? 0;
    }
    annotDict.set(PDFName.of('F'), PDFNumber.of(flags));
  }

  // Border color
  if (options.borderColor) {
    const color = context.obj([]) as PDFArray;
    color.push(PDFNumber.of(options.borderColor.red));
    color.push(PDFNumber.of(options.borderColor.green));
    color.push(PDFNumber.of(options.borderColor.blue));
    annotDict.set(PDFName.of('C'), color);
  }

  // Background color (for stamp, highlight)
  if (options.backgroundColor) {
    const color = context.obj([]) as PDFArray;
    color.push(PDFNumber.of(options.backgroundColor.red));
    color.push(PDFNumber.of(options.backgroundColor.green));
    color.push(PDFNumber.of(options.backgroundColor.blue));
    annotDict.set(PDFName.of('IC'), color);
  }

  // Opacity
  if (options.opacity !== undefined) {
    annotDict.set(PDFName.of('CA'), PDFNumber.of(options.opacity));
  }

  // Stamp name
  if (options.type === 'stamp' && options.stampName) {
    annotDict.set(PDFName.of('Name'), PDFName.of(options.stampName));
  }

  // Link target
  if (options.type === 'link' && options.linkTarget) {
    const action = context.obj({}) as PDFDict;
    action.set(PDFName.of('S'), PDFName.of('URI'));
    action.set(PDFName.of('URI'), PDFString.of(options.linkTarget));
    annotDict.set(PDFName.of('A'), action);
  }

  // FreeText appearance
  if (options.type === 'freeText') {
    const da = context.obj({}) as PDFDict;
    da.set(PDFName.of('Font'), PDFName.of('Helv'));

    const tc = options.textColor ?? rgb(0, 0, 0);
    const defaultAppearance = `/Helv ${(options.fontSize ?? 12).toFixed(1)} Tf ${tc.red.toFixed(3)} ${tc.green.toFixed(3)} ${tc.blue.toFixed(3)} rg`;
    annotDict.set(PDFName.of('DA'), PDFString.of(defaultAppearance));
  }

  // Register and add to page
  const annotRef = context.register(annotDict);
  const pageAnnots = page.node.lookup(PDFName.of('Annots')) as PDFArray;
  if (pageAnnots) {
    pageAnnots.push(annotRef);
  } else {
    const annots = context.obj([]) as PDFArray;
    annots.push(annotRef);
    page.node.set(PDFName.of('Annots'), annots);
  }

  return annotDict as unknown as PDFAnnotation;
}

/**
 * Add multiple annotations in batch.
 */
export function addAnnotations(doc: PDFDocument, options: AnnotationOptions[]): void {
  for (const opt of options) {
    addAnnotation(doc, opt);
  }
}

/**
 * Create widget annotations for all form fields on a page.
 * This makes form fields visible and interactive in PDF viewers.
 */
export function createFieldWidgets(
  doc: PDFDocument,
  fieldName: string,
  pageIndex: number,
  rect: [number, number, number, number],
  options: {
    value?: string;
    tooltip?: string;
    readOnly?: boolean;
    required?: boolean;
    visible?: boolean;
  } = {}
): void {
  const flags: AnnotationFlag[] = ['print'];
  if (!options.visible) flags.push('hidden');
  if (options.readOnly) flags.push('readOnly');

  addAnnotation(doc, {
    type: 'widget',
    rect,
    pageIndex,
    contents: options.tooltip,
    fieldName,
    fieldValue: options.value,
    flags,
    borderColor: rgb(0, 0, 0),
  });
}
