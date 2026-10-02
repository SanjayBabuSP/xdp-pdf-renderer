import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFString,
} from 'pdf-lib';
import { FieldNode, LayoutNode, PaginatedLayout } from '../types';

/**
 * Interactive AcroForm generation from the XFA template (G8).
 *
 * The renderer normally produces flat vector pages. When
 * `RenderOptions.adobe.acroForm` is enabled, every visible bound input field is
 * also emitted as a real AcroForm field with a widget annotation, carrying the
 * current value, the `<assist>` tooltip (`/TU`) and the access state (`/Ff`).
 *
 * Field type mapping follows the XFA UI to PDF `/FT` correspondence:
 *   textEdit / numericEdit / dateTimeEdit → `/Tx`
 *   checkButton                           → `/Btn` (checkbox)
 *   choiceList                            → `/Ch` (combo or list)
 *   signature                             → `/Sig`
 *
 * Known limitation: appearance streams are not generated; `/NeedAppearances`
 * is set so viewers synthesise them from `/DA` + `/V`.
 */

const F_READONLY = 1 << 0;
const F_MULTILINE = 1 << 12;
const F_COMBO = 1 << 17;

export interface AcroFormOptions {
  /** Order fields using the authored `<traversal>` lists. Default true. */
  tabOrderFromTraversal?: boolean;
}

/** A collected XFA field ready to be turned into an AcroForm widget. */
interface AcroFieldSpec {
  path: string;
  ft: 'Tx' | 'Btn' | 'Ch' | 'Sig';
  value: string;
  rect: [number, number, number, number];
  page: PDFPage;
  flags: number;
  tooltip?: string;
  checked?: boolean;
  options?: string[];
}

export function createAcroFormFields(
  doc: PDFDocument,
  layout: PaginatedLayout,
  options: AcroFormOptions = {},
): void {
  const honourTraversal = options.tabOrderFromTraversal !== false;
  const specs = collectFields(doc, layout, honourTraversal);
  if (specs.length === 0) return;

  const context = doc.context;
  const fieldArray = PDFArray.withContext(context);

  const helv = PDFDict.withContext(context);
  helv.set(PDFName.of('Type'), PDFName.of('Font'));
  helv.set(PDFName.of('Subtype'), PDFName.of('Type1'));
  helv.set(PDFName.of('BaseFont'), PDFName.of('Helvetica'));
  const fonts = PDFDict.withContext(context);
  fonts.set(PDFName.of('Helv'), context.register(helv));
  const dr = PDFDict.withContext(context);
  dr.set(PDFName.of('Font'), fonts);

  const acroForm = PDFDict.withContext(context);
  acroForm.set(PDFName.of('Fields'), fieldArray);
  acroForm.set(PDFName.of('NeedAppearances'), PDFBool.True);
  acroForm.set(PDFName.of('DA'), PDFString.of('/Helv 0 Tf 0 g'));
  acroForm.set(PDFName.of('DR'), dr);
  doc.catalog.set(PDFName.of('AcroForm'), context.register(acroForm));

  for (const spec of specs) {
    const ref = context.register(buildFieldDict(doc, spec));
    fieldArray.push(ref);

    const annots = spec.page.node.Annots();
    if (annots) annots.push(ref);
    else spec.page.node.set(PDFName.of('Annots'), context.obj([ref]));
  }
}

function buildFieldDict(doc: PDFDocument, spec: AcroFieldSpec): PDFDict {
  const context = doc.context;
  const dict = PDFDict.withContext(context);
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Widget'));
  dict.set(PDFName.of('FT'), PDFName.of(spec.ft));
  dict.set(PDFName.of('T'), safeString(spec.path));
  if (spec.tooltip) dict.set(PDFName.of('TU'), safeString(spec.tooltip));
  dict.set(PDFName.of('F'), PDFNumber.of(4)); // print
  dict.set(PDFName.of('P'), spec.page.ref);
  dict.set(PDFName.of('Rect'), context.obj(spec.rect));
  if (spec.flags) dict.set(PDFName.of('Ff'), PDFNumber.of(spec.flags));

  if (spec.ft === 'Btn') {
    const state = spec.checked ? 'Yes' : 'Off';
    dict.set(PDFName.of('V'), PDFName.of(state));
    dict.set(PDFName.of('AS'), PDFName.of(state));
  } else if (spec.ft !== 'Sig') {
    dict.set(PDFName.of('V'), safeString(spec.value));
  }

  if (spec.ft === 'Ch' && spec.options) {
    const opt = PDFArray.withContext(context);
    for (const item of spec.options) opt.push(safeString(item));
    dict.set(PDFName.of('Opt'), opt);
  }
  return dict;
}

/** PDFString cannot hold characters outside PDFDocEncoding; use hex otherwise. */
function safeString(value: string): PDFString | PDFHexString {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\xff]*$/.test(value) ? PDFString.of(value) : PDFHexString.fromText(value);
}

// ─── Field collection ────────────────────────────────────────────────────────

function collectFields(
  doc: PDFDocument,
  layout: PaginatedLayout,
  honourTraversal: boolean,
): AcroFieldSpec[] {
  const out: AcroFieldSpec[] = [];
  layout.pages.forEach((page, index) => {
    let pdfPage: PDFPage;
    try {
      pdfPage = doc.getPage(index);
    } catch {
      return;
    }
    const roots = orderedChildren(page.children, undefined, honourTraversal);
    for (const node of roots) {
      collectNode(node, '', pdfPage, page.medium.long, out, honourTraversal);
    }
  });
  return out;
}

function collectNode(
  node: LayoutNode,
  prefix: string,
  page: PDFPage,
  pageHeight: number,
  out: AcroFieldSpec[],
  honourTraversal: boolean,
): void {
  const path = prefix ? `${prefix}.${node.name ?? ''}` : node.name ?? '';

  if (node.type === 'field') {
    if (node.presence === 'hidden' || node.presence === 'inactive') return;
    const spec = toAcroField(node, path, page, pageHeight);
    if (spec) out.push(spec);
    return;
  }
  if (node.type === 'subform' || node.type === 'exclGroup') {
    const children = orderedChildren(node.children, node.traversal?.fields, honourTraversal);
    for (const child of children) {
      collectNode(child, path, page, pageHeight, out, honourTraversal);
    }
  }
}

function toAcroField(
  node: FieldNode,
  path: string,
  page: PDFPage,
  pageHeight: number,
): AcroFieldSpec | null {
  const ui = node.ui;
  if (!ui || ui.type === 'imageEdit' || ui.type === 'unknown') return null;
  const pos = node.position;
  if (!pos || pos.x == null || pos.y == null) return null;
  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  if (w <= 0 || h <= 0) return null;

  // `position` is top-left, y-down in template points; convert to PDF y-up.
  const rect: [number, number, number, number] = [
    pos.x,
    pageHeight - (pos.y + h),
    pos.x + w,
    pageHeight - pos.y,
  ];

  const restricted = node.access === 'readOnly' || node.access === 'protected';
  const base = restricted ? F_READONLY : 0;
  const tooltip = node.assist?.toolTip;

  if (ui.type === 'checkButton') {
    const checked =
      String(node.resolvedValue) === (ui.checkedValue ?? '1') || node.resolvedValue === true;
    return { path, ft: 'Btn', value: '', rect, page, flags: base, tooltip, checked };
  }
  if (ui.type === 'signature') {
    return { path, ft: 'Sig', value: '', rect, page, flags: base, tooltip };
  }
  if (ui.type === 'choiceList') {
    return {
      path,
      ft: 'Ch',
      value: node.resolvedValue == null ? '' : String(node.resolvedValue),
      rect,
      page,
      flags: base | (ui.open === 'always' ? 0 : F_COMBO),
      tooltip,
      options: ui.items?.map((i) => String(i.value ?? i.text)),
    };
  }

  return {
    path,
    ft: 'Tx',
    value: node.resolvedValue == null ? '' : String(node.resolvedValue),
    rect,
    page,
    flags: base | (ui.multiLine ? F_MULTILINE : 0),
    tooltip,
  };
}

/**
 * Document order, except when the container authors a `<traversal><field
 * name=…/></traversal>` list — then listed names lead, in that order.
 */
function orderedChildren(
  nodes: LayoutNode[],
  traversalFields: string[] | undefined,
  honourTraversal: boolean,
): LayoutNode[] {
  if (!honourTraversal || !traversalFields || traversalFields.length === 0) return nodes;
  const rank = new Map(traversalFields.map((name, i) => [name, i]));
  return [...nodes].sort((a, b) => {
    const ra = a.name != null && rank.has(a.name) ? rank.get(a.name)! : Number.MAX_SAFE_INTEGER;
    const rb = b.name != null && rank.has(b.name) ? rank.get(b.name)! : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}
