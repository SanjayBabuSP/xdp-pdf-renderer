import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { render } from '../../../src';
import { parseXdp } from '../../../src/domain/parsing/parse-xdp';
import { parseXsd } from '../../../src/domain/parsing/parse-xsd';
import { parseXmlData } from '../../../src/domain/parsing/parse-xml-data';
import { resolveBindings } from '../../../src/domain/mapping/resolve-bindings';
import { expandRepeats } from '../../../src/domain/mapping/expand-repeats';
import { evaluateConditions } from '../../../src/domain/mapping/evaluate-conditions';
import { resolveXfaEmbeds } from '../../../src/domain/mapping/resolve-embeds';
import { applyTableLayouts } from '../../../src/domain/layout/calculate-table-layout';
import { calculatePositions } from '../../../src/domain/layout/calculate-positions';
import { applyPagination } from '../../../src/domain/layout/apply-pagination';
import { dispatchScripts, dispatchPostLayoutScripts } from '../../../src/domain/scripting';
import { LayoutNode, PaginatedLayout, Result } from '../../../src/types';
import { contentStream, extractText } from '../../helpers/pdf-content';

interface SampleForm {
  name: string;
  xdp: string;
  xsd: string;
  data: string;
  expectedPages: number;
  minDataValuesShown: number;
  knownIssue?: string;
}

const ROOT = path.join(__dirname, '..', '..', 'fixtures', 'sample-forms');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'forms.json'), 'utf8')) as {
  forms: SampleForm[];
  schemasOnly: string[];
};
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const A4 = { width: 595.28, height: 841.89 };

async function renderForm(form: SampleForm): Promise<Buffer> {
  const result = await render({ xdp: read(form.xdp), xsd: read(form.xsd), data: read(form.data) });
  if (!result.success) throw new Error(`[${result.error.code}] ${result.error.message}`);
  return result.data;
}

function imageCount(doc: PDFDocument): number {
  let count = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj;
    if (dict instanceof PDFDict && dict.get(PDFName.of('Subtype'))?.toString() === '/Image') count++;
  }
  return count;
}

function dataValues(form: SampleForm): string[] {
  const values = [...read(form.data).matchAll(/>([^<>]{4,})</g)].map((m) => m[1]!.trim());
  return [...new Set(values.filter((v) => /\p{L}/u.test(v) && !/^(true|false)$/.test(v)))];
}

describe.each(manifest.forms.filter((form) => !form.knownIssue))('sample form $name', (form) => {
  let pdf: Buffer;
  let doc: PDFDocument;

  beforeAll(async () => {
    pdf = await renderForm(form);
    doc = await PDFDocument.load(pdf);
  });

  it('renders the expected number of pages', () => {
    expect(doc.getPageCount()).toBe(form.expectedPages);
  });

  it('uses A4 pages', () => {
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(A4.width, 0);
      expect(page.getHeight()).toBeCloseTo(A4.height, 0);
    }
  });

  it('draws text on every page', async () => {
    for (let i = 0; i < doc.getPageCount(); i++) {
      expect(await contentStream(pdf, i)).toMatch(/\bT[jJ]\b/);
    }
  });

  it('embeds the placeholder images', () => {
    expect(imageCount(doc)).toBeGreaterThan(0);
  });

  it('shows bound data values', async () => {
    const pages: string[] = [];
    for (let i = 0; i < doc.getPageCount(); i++) pages.push(...extractText(await contentStream(pdf, i)));
    const text = pages.join('\n');
    const shown = dataValues(form).filter((v) => text.includes(v));
    expect(shown.length).toBeGreaterThanOrEqual(form.minDataValuesShown);
  });
});

describe('sample schemas', () => {
  const schemas = manifest.schemasOnly;
  (schemas.length ? it.each(schemas) : it.skip.each(['(none)']))('%s parses', (rel) => {
    expect(parseXsd(read(rel)).success).toBe(true);
  });
});

function unwrap<T>(res: Result<T>, what: string): T {
  if (!res.success) throw new Error(`${what} failed: ${JSON.stringify(res.error)}`);
  return res.data;
}

function paginatedLayout(form: SampleForm): PaginatedLayout {
  const layout = unwrap(parseXdp(read(form.xdp), { strict: true }), 'parseXdp');
  const schema = unwrap(parseXsd(read(form.xsd)), 'parseXsd');
  const data = unwrap(parseXmlData(read(form.data), schema), 'parseXmlData');
  let tree = unwrap(resolveBindings(layout, data), 'resolveBindings');
  tree = unwrap(expandRepeats(tree, data), 'expandRepeats');
  const scripted = unwrap(
    dispatchScripts(tree, data, { skipScripts: false, strictMode: true }),
    'dispatchScripts'
  );
  resolveXfaEmbeds(scripted.layout);
  let computed = unwrap(evaluateConditions(scripted.layout, data), 'evaluateConditions');
  computed = unwrap(
    applyTableLayouts(computed, computed.pages[0]?.contentArea.w ?? 487),
    'applyTableLayouts'
  );
  computed = unwrap(calculatePositions(computed), 'calculatePositions');
  const paginated = unwrap(applyPagination(computed, undefined), 'applyPagination');
  return unwrap(
    dispatchPostLayoutScripts(paginated, data, { skipScripts: false, strictMode: true }),
    'dispatchPostLayoutScripts'
  ).layout;
}

function leaves(nodes: LayoutNode[], out: LayoutNode[] = []): LayoutNode[] {
  for (const n of nodes) {
    if (n.type === 'subform' || n.type === 'exclGroup') leaves(n.children, out);
    else out.push(n);
  }
  return out;
}

function overlapArea(a: LayoutNode, b: LayoutNode): number {
  const pa = a.position;
  const pb = b.position;
  if (!pa || !pb) return 0;
  const { x: ax = 0, y: ay = 0, w: aw = 0, h: ah = 0 } = pa;
  const { x: bx = 0, y: by = 0, w: bw = 0, h: bh = 0 } = pb;
  const ix = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const iy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  return Math.max(ix, 0) * Math.max(iy, 0);
}

describe.each(manifest.forms)('sample form geometry $name', (form) => {
  it('has no overlapping field boxes on any page', () => {
    const layout = paginatedLayout(form);
    for (const page of layout.pages) {
      const fields = leaves(page.children).filter((n) => n.type === 'field');
      const collisions: string[] = [];
      for (let i = 0; i < fields.length; i++) {
        for (let j = i + 1; j < fields.length; j++) {
          if (overlapArea(fields[i], fields[j]) > 1) {
            collisions.push(`${fields[i].name} ↔ ${fields[j].name}`);
          }
        }
      }
      expect({ page: page.pageIndex, collisions }).toEqual({ page: page.pageIndex, collisions: [] });
    }
  });
});
