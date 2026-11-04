import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import { render } from '../../../src';
import { parseXsd } from '../../../src/domain/parsing/parse-xsd';
import { contentStream, extractText } from '../../helpers/pdf-content';

/**
 * Renders the sanitized real-world forms in test/fixtures/sample-forms through
 * the public API, the way an npm consumer would. See that folder's README.
 */

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

/** Distinct data values (with a letter, 4+ chars) from the XML data file. */
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

describe.each(manifest.forms.filter((form) => form.knownIssue))('sample form $name', (form) => {
  // Passes while the known issue exists; starts failing once it is fixed, as a
  // reminder to drop `knownIssue` from forms.json.
  it.failing(`renders (known issue: ${form.knownIssue})`, async () => {
    expect(await PDFDocument.load(await renderForm(form))).toBeDefined();
  });
});

describe('sample schemas', () => {
  it.each(manifest.schemasOnly)('%s parses', (rel) => {
    expect(parseXsd(read(rel)).success).toBe(true);
  });
});
