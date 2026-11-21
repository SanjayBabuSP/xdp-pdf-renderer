import { PNG } from 'pngjs';
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFArray } from 'pdf-lib';
import { renderPdf, renderPdfWithDoc } from '../../../src/rendering/pdf-renderer';
import { PAGE_NUMBER_TOKEN } from '../../../src/domain/mapping/resolve-embeds';
import { contentStream, pageText } from '../../helpers/pdf-content';
import type {
  BorderSpec,
  DrawNode,
  EdgeSpec,
  ExclGroupNode,
  FieldNode,
  LayoutNode,
  PaginatedLayout,
  PaginatedPage,
  Position,
  RenderOptions,
  RgbColor,
  SubformNode,
} from '../../../src/types';

const RED: RgbColor = { r: 255, g: 0, b: 0 };
const BLUE: RgbColor = { r: 0, g: 0, b: 255 };
const BLACK: RgbColor = { r: 0, g: 0, b: 0 };

function position(overrides: Partial<Position> = {}): Position {
  return { x: 50, y: 50, w: 120, h: 40, ...overrides };
}

function edge(overrides: Partial<EdgeSpec> = {}): EdgeSpec {
  return { thickness: 1, color: BLACK, ...overrides };
}

function textDraw(content: string, overrides: Partial<DrawNode> = {}): DrawNode {
  return {
    type: 'draw',
    value: { type: 'text', content },
    position: position(),
    font: { family: 'Helvetica', size: 10 },
    ...overrides,
  };
}

function field(overrides: Partial<FieldNode> = {}): FieldNode {
  return {
    type: 'field',
    position: position(),
    font: { family: 'Helvetica', size: 10 },
    ...overrides,
  };
}

function page(nodes: LayoutNode[], masterPageChildren: LayoutNode[] = []): PaginatedPage {
  return {
    pageIndex: 0,
    medium: { stock: 'a4', short: 595, long: 842 },
    contentArea: { x: 36, y: 36, w: 523, h: 770 },
    masterPageChildren,
    children: nodes,
  };
}

async function draw(
  nodes: LayoutNode[],
  options: RenderOptions = {},
  masterPageChildren: LayoutNode[] = []
): Promise<{ bytes: Buffer; doc: PDFDocument; stream: string }> {
  const layout: PaginatedLayout = { pages: [page(nodes, masterPageChildren)] };
  const { buffer, doc } = await renderPdfWithDoc(layout, options);
  return { bytes: buffer, doc, stream: await contentStream(buffer) };
}

function pngBase64(): string {
  const image = new PNG({ width: 1, height: 1 });
  image.data[0] = 255;
  image.data[1] = 0;
  image.data[2] = 0;
  image.data[3] = 255;
  return PNG.sync.write(image).toString('base64');
}

function dictNumbers(doc: PDFDocument, dict: PDFDict, key: string): number[] {
  const value = dict.get(PDFName.of(key));
  if (!(value instanceof PDFArray)) throw new Error('expected PDFArray');
  return value.asArray().map((item) => {
    if (!(item instanceof PDFNumber)) throw new Error('expected PDFNumber');
    return item.asNumber();
  });
}

describe('renderPdf public entry point', () => {
  it('renders master page and body content while skipping hidden nodes', async () => {
    const layout: PaginatedLayout = {
      pages: [
        page(
          [textDraw('hidden', { presence: 'hidden' }), textDraw('visible')],
          [textDraw('master')]
        ),
      ],
    };
    const bytes = await renderPdf(layout);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await pageText(bytes);
    expect(text).toContain('visible');
    expect(text).toContain('master');
    expect(text).not.toContain('hidden');
  });

  it('renders hidden nodes in preview mode', async () => {
    const { bytes } = await draw([textDraw('secret', { presence: 'invisible' })], {
      previewMode: true,
    });
    expect(await pageText(bytes)).toContain('secret');
  });

  it('renders an exclusion group with its border and children', async () => {
    const group: ExclGroupNode = {
      type: 'exclGroup',
      position: position(),
      border: { edges: [edge()], fill: { color: RED } },
      children: [textDraw('grouped')],
    };
    const { stream } = await draw([group]);
    expect(stream).toContain('1 0 0 rg');
    expect(await pageText(await renderPdf({ pages: [page([group])] }))).toContain('grouped');
  });
});

describe('pdf-renderer border and fill branches', () => {
  it('omits all border operators for a hidden border', async () => {
    const border: BorderSpec = { presence: 'hidden', edges: [edge()] };
    const { stream } = await draw([textDraw('plain', { border })]);
    expect(stream).not.toContain('1 0 0 rg');
    expect(stream).not.toContain(' re\nS');
  });

  it('rotates edges and corner radii for a rotated rounded border', async () => {
    const border: BorderSpec = {
      edges: [edge({ color: RED }), edge({ color: BLUE }), edge(), edge()],
      cornerRadii: [6, 4, 2, 8],
      fill: { color: RED },
    };
    const { stream } = await draw([
      textDraw('rotated', {
        border,
        position: position({ rotate: 90 }),
      }),
    ]);
    expect(stream).toContain('1 0 0 rg');
    expect(stream).toContain(' c');
  });

  it('draws a gradient fill for a gradient fillType', async () => {
    const border: BorderSpec = {
      edges: [],
      fill: { color: RED, color2: BLUE, fillType: 'toRight' },
    };
    const { doc, stream, bytes } = await draw([textDraw('gradient', { border })]);
    expect(stream).toContain('/Sh0 sh');
    const pdf = await PDFDocument.load(bytes);
    const resources = pdf.getPage(0).node.Resources();
    if (!resources) throw new Error('expected resources');
    const shadings = resources.lookupMaybe(PDFName.of('Shading'), PDFDict);
    if (!shadings) throw new Error('expected shading dictionary');
    const shadingRef = shadings.lookup(PDFName.of('Sh0'));
    const shading = pdf.context.lookup(shadingRef, PDFDict);
    if (!shading) throw new Error('expected shading');
    expect(dictNumbers(pdf, shading, 'Coords')).toEqual([0, 0.5, 1, 0.5]);
    void doc;
  });

  it('draws a rounded fill with per-corner bezier curves', async () => {
    const border: BorderSpec = {
      edges: [],
      cornerRadii: [5, 5, 5, 5],
      fill: { color: RED },
    };
    const { stream } = await draw([textDraw('rounded', { border })]);
    expect(stream).toContain('1 0 0 rg');
    expect(stream).toContain(' c');
  });

  it('strokes a rounded rectangle when a uniform edge is rounded', async () => {
    const border: BorderSpec = {
      edges: [edge({ color: BLUE })],
      cornerRadius: 5,
    };
    const { stream } = await draw([textDraw('rounded stroke', { border })]);
    expect(stream).toContain('0 0 1 RG');
    expect(stream).toContain(' c');
  });

  it('draws each distinct edge with a dash pattern', async () => {
    const border: BorderSpec = {
      edges: [
        edge({ color: RED, style: 'dashed' }),
        edge({ color: RED }),
        edge({ color: BLUE }),
        edge({ color: BLACK }),
      ],
    };
    const { stream } = await draw([textDraw('edges', { border })]);
    expect(stream).toMatch(/\[[^\]]+\] 0 d/);
  });

  it('draws an underline in the value area for caption reserves', async () => {
    const border: BorderSpec = { edges: [edge({ color: RED })] };
    const result = await draw([
      field({
        border,
        caption: { text: 'Label', reserve: 40, placement: 'left' },
        resolvedValue: 'value',
      }),
    ]);
    expect(result.stream).toContain('1 0 0 RG');
  });

  it('falls back to a full border box when the underline has no room', async () => {
    const border: BorderSpec = { edges: [edge({ color: RED })], fill: { color: BLUE } };
    const result = await draw([
      field({
        border,
        caption: { text: 'Label', reserve: 200, placement: 'left' },
        resolvedValue: 'value',
      }),
    ]);
    expect(result.stream).toContain('0 0 1 rg');
  });
});

describe('pdf-renderer field branches', () => {
  it('draws checked and unchecked check buttons with captions', async () => {
    const checked = await draw([
      field({
        ui: { type: 'checkButton', checkedValue: 'yes' },
        resolvedValue: 'yes',
        caption: { text: 'Accepted' },
      }),
    ]);
    expect(await pageText(checked.bytes)).toContain('Accepted');

    const unchecked = await draw([field({ ui: { type: 'checkButton' }, resolvedValue: 'no' })]);
    expect(checked.stream).not.toBe(unchecked.stream);
  });

  it('draws an image value carried by a field', async () => {
    const result = await draw([
      field({
        imageValue: { type: 'image', content: pngBase64() },
        border: { edges: [edge()] },
      }),
    ]);
    expect(result.stream).toContain(' Do');
  });

  it('draws a button label and skips signature fields', async () => {
    const button = await draw([
      field({ ui: { type: 'button', label: 'Submit' }, resolvedValue: 'ignored' }),
    ]);
    expect(await pageText(button.bytes)).toContain('Submit');

    const signature = await draw([field({ ui: { type: 'signature' }, resolvedValue: 'Sign' })]);
    expect(await pageText(signature.bytes)).not.toContain('Sign');
  });

  it('draws a caption trailing symbol with underline', async () => {
    const result = await draw([
      field({
        caption: {
          text: 'Total +',
          reserve: 60,
          placement: 'left',
          richHtml: '<span style="xfa-spacerun:yes;text-decoration:underline">Total</span>',
        },
        resolvedValue: '10',
      }),
    ]);
    expect(await pageText(result.bytes)).toContain('Total');
  });

  it('draws a right-placed caption', async () => {
    const result = await draw([
      field({
        caption: { text: 'Right', reserve: 40, placement: 'right' },
        resolvedValue: 'value',
      }),
    ]);
    expect(await pageText(result.bytes)).toContain('Right');
  });

  it('draws rotated captions and values', async () => {
    const result = await draw([
      field({
        caption: { text: 'Vertical', reserve: 30, placement: 'left' },
        resolvedValue: 'value',
        position: position({ rotate: 90 }),
      }),
    ]);
    expect(await pageText(result.bytes)).toContain('Vertical');
  });

  it('justifies multi-word value text', async () => {
    const result = await draw([
      field({
        resolvedValue: 'alpha beta gamma delta',
        para: { hAlign: 'justify' },
        position: position({ w: 80, h: 20 }),
      }),
    ]);
    expect(await pageText(result.bytes)).toContain('alpha');
  });

  it('justifies non-final lines of wrapped value text', async () => {
    const result = await draw([
      field({
        ui: { type: 'textEdit', multiLine: true },
        resolvedValue: 'alpha beta gamma delta epsilon zeta eta theta',
        para: { hAlign: 'justify' },
        position: position({ w: 70, h: 60 }),
      }),
    ]);
    expect((await pageText(result.bytes)).replace(/\n/g, ' ')).toContain('alpha');
  });

  it('lays out multiple lines of vertically rotated value text', async () => {
    const result = await draw([
      field({
        ui: { type: 'textEdit', multiLine: true },
        resolvedValue: 'first second third fourth fifth sixth',
        position: position({ rotate: 90, h: 25 }),
      }),
    ]);
    expect((await pageText(result.bytes)).replace(/\n/g, ' ')).toContain('first');
  });

  it('renders a barcode field with HRI text and scan options', async () => {
    const result = await draw([
      field({
        ui: {
          type: 'barcode',
          symbology: 'code39',
          textLocation: 'above',
          wideNarrowRatio: '2 to 3',
          errorCorrectionLevel: '4',
          moduleWidth: '0.25mm',
        },
        resolvedValue: 'ABC-1234',
      }),
    ]);
    expect(await pageText(result.bytes)).toContain('ABC-1234');
  });

  it('renders a choice list by resolving item text', async () => {
    const result = await draw([
      field({
        ui: {
          type: 'choiceList',
          items: [
            { text: 'First', value: '1' },
            { text: 'Second', value: '2' },
          ],
        },
        resolvedValue: '2',
      }),
    ]);
    expect(await pageText(result.bytes)).toContain('Second');
  });

  it('applies condensed text scaling', async () => {
    const result = await draw([textDraw('narrow', { font: { family: 'Arial Narrow', size: 10 } })]);
    expect(result.stream).toContain('93 Tz');
    expect(result.stream).toContain('100 Tz');
  });
});

describe('pdf-renderer draw branches', () => {
  it('renders a shape border for rectangle and line draws', async () => {
    const result = await draw([
      textDraw('', {
        value: { type: 'rectangle', shapeBorder: { edges: [edge({ color: RED })] } },
      }),
      textDraw('', {
        value: { type: 'line', shapeBorder: { edges: [edge({ color: BLUE })] } },
      }),
    ]);
    expect(result.stream).toContain('1 0 0 RG');
    expect(result.stream).toContain('0 0 1 RG');
  });

  it('renders a circle with fill, stroke and opacity', async () => {
    const result = await draw([
      textDraw('', {
        value: {
          type: 'circle',
          shapeBorder: {
            edges: [
              edge({ color: RED, style: 'dashed', cap: 'round', join: 'round', opacity: 0.5 }),
            ],
            fill: { color: BLUE, opacity: 0.4 },
          },
        },
      }),
    ]);
    expect(result.stream).toContain('0 0 1 rg');
    expect(result.stream).toContain('1 0 0 RG');
    expect(result.stream).toContain('/GS');
  });

  it('renders plain rich text without styled runs', async () => {
    const result = await draw([
      textDraw('', {
        value: { type: 'richText', content: 'plain text' },
        position: position({ w: 400 }),
      }),
    ]);
    expect((await pageText(result.bytes)).replace(/\n/g, ' ')).toContain('plain text');
  });

  it('renders styled rich text runs with underline and colour', async () => {
    const html =
      '<b>Bold</b> <span style="text-decoration:underline;color:#ff0000;font-size:12pt;font-family:Helvetica">Underlined</span>';
    const result = await draw([textDraw('', { value: { type: 'richText', content: html } })]);
    const text = await pageText(result.bytes);
    expect(text).toContain('Bold');
    expect(text).toContain('Underlined');
    expect(result.stream).toContain('1 0 0 rg');
  });

  it('substitutes the page number token in rich text', async () => {
    const result = await draw([
      textDraw('', {
        value: { type: 'richText', content: `Page ${PAGE_NUMBER_TOKEN}` },
        position: position({ w: 400 }),
      }),
    ]);
    expect((await pageText(result.bytes)).replace(/\n/g, ' ')).toContain('Page 1');
  });

  it('renders vertically rotated draw text', async () => {
    const result = await draw([
      textDraw('rotated text', { position: position({ rotate: 90 }), para: { hAlign: 'center' } }),
    ]);
    expect(await pageText(result.bytes)).toContain('rotated text');
  });

  it('strips HTML tags from draw text', async () => {
    const result = await draw([textDraw('<b>Stripped</b>')]);
    expect(await pageText(result.bytes)).toContain('Stripped');
    expect(await pageText(result.bytes)).not.toContain('<b>');
  });

  it('ignores embedded image content that cannot be decoded', async () => {
    const result = await draw([
      textDraw('', { value: { type: 'image', content: 'not-a-real-image' } }),
    ]);
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.stream).not.toContain(' Do');
  });

  it('reports the rendered page count for multiple pages', async () => {
    const layout: PaginatedLayout = {
      pages: [page([textDraw('a')]), { ...page([textDraw('b')]), pageIndex: 1 }],
    };
    const { doc } = await renderPdfWithDoc(layout);
    expect(doc.getPageCount()).toBe(2);
  });

  it('handles subform border collapse for incomplete and covering children', async () => {
    const border: BorderSpec = {
      edges: [edge(), edge(), edge(), edge()],
      fill: { color: RED },
    };
    const withoutPosition: SubformNode = {
      type: 'subform',
      position: {},
      border,
      children: [],
    };
    const childWithoutSize: SubformNode = {
      type: 'subform',
      position: position(),
      border,
      children: [textDraw('small', { position: { x: 50, y: 50 } })],
    };
    const coveringChild: SubformNode = {
      type: 'subform',
      position: position({ x: 0, y: 0, w: 100, h: 40 }),
      border,
      children: [textDraw('cover', { position: position({ x: 0, y: 0, w: 100, h: 40 }), border })],
    };

    const result = await draw([withoutPosition, childWithoutSize, coveringChild]);
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('wraps failures to create the underlying PDF document', async () => {
    const spy = jest.spyOn(PDFDocument, 'create').mockRejectedValueOnce(new Error('no document'));
    try {
      await expect(renderPdfWithDoc({ pages: [page([])] })).rejects.toThrow(
        'PDF generation failed: Error: no document'
      );
    } finally {
      spy.mockRestore();
    }
  });
});
