import {
  PDFArray,
  PDFBool,
  PDFContentStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRef,
} from 'pdf-lib';
import {
  drawGradientFill,
  grayLevel,
  isGradientFill,
  isGray,
} from '../../../src/rendering/fill-paint';
import { RgbColor } from '../../../src/types';

const BLACK: RgbColor = { r: 0, g: 0, b: 0 };
const WHITE: RgbColor = { r: 255, g: 255, b: 255 };

function pageContent(doc: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  if (contents == null) return '';
  if (!(contents instanceof PDFArray)) throw new Error('expected PDFArray contents');
  return contents
    .asArray()
    .map((ref) => {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFContentStream)) throw new Error('expected PDFContentStream');
      return stream.getContentsString();
    })
    .join('\n')
    .trimEnd();
}

function shadingDictFor(doc: PDFDocument, page: PDFPage, name: string): PDFDict {
  const resources = page.node.Resources();
  if (!resources) throw new Error('expected Resources');
  const shadings = resources.lookupMaybe(PDFName.of('Shading'), PDFDict);
  if (!shadings) throw new Error('expected Shading dictionary');
  const ref = shadings.lookup(PDFName.of(name));
  const dict = doc.context.lookup(ref, PDFDict);
  if (!dict) throw new Error('expected shading dictionary');
  return dict;
}

function shadingNames(page: PDFPage): string[] {
  const resources = page.node.Resources();
  if (!resources) throw new Error('expected Resources');
  const shadings = resources.lookupMaybe(PDFName.of('Shading'), PDFDict);
  if (!shadings) return [];
  return shadings.entries().map(([name]) => name.decodeText());
}

function number(dict: PDFDict, key: string): number {
  const value = dict.get(PDFName.of(key));
  if (!(value instanceof PDFNumber)) throw new Error('expected PDFNumber');
  return value.asNumber();
}

function numbers(dict: PDFDict, key: string): number[] {
  const value = dict.get(PDFName.of(key));
  if (!(value instanceof PDFArray)) throw new Error('expected PDFArray');
  return value.asArray().map((item) => {
    if (!(item instanceof PDFNumber)) throw new Error('expected PDFNumber');
    return item.asNumber();
  });
}

function booleans(dict: PDFDict, key: string): boolean[] {
  const value = dict.get(PDFName.of(key));
  if (!(value instanceof PDFArray)) throw new Error('expected PDFArray');
  return value.asArray().map((item) => {
    if (!(item instanceof PDFBool)) throw new Error('expected PDFBool');
    return item.asBoolean();
  });
}

describe('fill-paint colour helpers', () => {
  it('detects gray colours', () => {
    expect(isGray({ r: 128, g: 128, b: 128 })).toBe(true);
    expect(isGray({ r: 0, g: 0, b: 0 })).toBe(true);
    expect(isGray({ r: 128, g: 128, b: 127 })).toBe(false);
    expect(isGray({ r: 1, g: 2, b: 3 })).toBe(false);
  });

  it('normalises a gray colour to a 0..1 level', () => {
    expect(grayLevel({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(grayLevel({ r: 255, g: 255, b: 255 })).toBe(1);
    expect(grayLevel({ r: 51, g: 51, b: 51 })).toBeCloseTo(0.2, 10);
  });

  it('recognises exactly the supported gradient fill types', () => {
    for (const type of ['toRight', 'toLeft', 'toTop', 'toBottom', 'radial']) {
      expect(isGradientFill(type)).toBe(true);
    }
    expect(isGradientFill('none')).toBe(false);
    expect(isGradientFill('solid')).toBe(false);
    expect(isGradientFill('')).toBe(false);
    expect(isGradientFill(undefined)).toBe(false);
  });
});

describe('drawGradientFill', () => {
  it('emits clip + unit-square CTM + shading operators', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawGradientFill(page, 'toRight', BLACK, WHITE, 10, 20, 30, 40);
    expect(pageContent(doc, page)).toBe('q\n10 20 30 40 re\nW\nn\n30 0 0 40 10 20 cm\n/Sh0 sh\nQ');
  });

  it('ignores non-positive rectangles', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawGradientFill(page, 'toRight', BLACK, WHITE, 0, 0, 0, 40);
    drawGradientFill(page, 'toRight', BLACK, WHITE, 0, 0, 40, 0);
    drawGradientFill(page, 'toRight', BLACK, WHITE, 0, 0, 40, -5);
    expect(pageContent(doc, page)).toBe('');
    expect(shadingNames(page)).toEqual([]);
  });

  it('reuses one shading per document for identical fill/color keys', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawGradientFill(page, 'toRight', BLACK, WHITE, 10, 20, 30, 40);
    drawGradientFill(page, 'toRight', BLACK, WHITE, 50, 60, 70, 80);
    drawGradientFill(page, 'radial', BLACK, WHITE, 0, 0, 10, 10);
    expect(shadingNames(page)).toEqual(['Sh0', 'Sh1']);
    expect(pageContent(doc, page).match(/\/Sh0 sh/g)).toHaveLength(2);
    expect(pageContent(doc, page).match(/\/Sh1 sh/g)).toHaveLength(1);
  });

  it('registers a normalised shading dictionary with a type-2 colour function', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawGradientFill(
      page,
      'toRight',
      { r: 10, g: 20, b: 30 },
      { r: 40, g: 50, b: 60 },
      0,
      0,
      10,
      10
    );
    const shading = shadingDictFor(doc, page, 'Sh0');
    expect(numbers(shading, 'Coords')).toEqual([0, 0.5, 1, 0.5]);
    expect(booleans(shading, 'Extend')).toEqual([true, true]);
    const colorSpace = shading.get(PDFName.of('ColorSpace'));
    if (!(colorSpace instanceof PDFName)) throw new Error('expected PDFName');
    expect(colorSpace.decodeText()).toBe('DeviceRGB');

    const fnRef = shading.get(PDFName.of('Function'));
    if (!(fnRef instanceof PDFRef)) throw new Error('expected PDFRef');
    const fn = doc.context.lookup(fnRef, PDFDict);
    if (!fn) throw new Error('expected function dictionary');
    expect(numbers(fn, 'C0')).toEqual([10 / 255, 20 / 255, 30 / 255]);
    expect(numbers(fn, 'C1')).toEqual([40 / 255, 50 / 255, 60 / 255]);
    expect(number(fn, 'FunctionType')).toBe(2);
    expect(numbers(fn, 'Domain')).toEqual([0, 1]);
    expect(number(fn, 'N')).toBe(1);
  });

  it.each([
    { fillType: 'toRight', type: 2, coords: [0, 0.5, 1, 0.5] },
    { fillType: 'toLeft', type: 2, coords: [1, 0.5, 0, 0.5] },
    { fillType: 'toTop', type: 2, coords: [0.5, 0, 0.5, 1] },
    { fillType: 'toBottom', type: 2, coords: [0.5, 1, 0.5, 0] },
    { fillType: 'unsupported', type: 2, coords: [0.5, 1, 0.5, 0] },
    { fillType: 'radial', type: 3, coords: [0.5, 0.5, 0, 0.5, 0.5, 0.5] },
  ])('maps $fillType to shading type $type', async ({ fillType, type, coords }) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawGradientFill(page, fillType, BLACK, WHITE, 0, 0, 10, 10);
    const shading = shadingDictFor(doc, page, 'Sh0');
    const shadingType = shading.get(PDFName.of('ShadingType'));
    if (!(shadingType instanceof PDFNumber)) throw new Error('expected PDFNumber');
    expect(shadingType.asNumber()).toBe(type);
    expect(numbers(shading, 'Coords')).toEqual(coords);
  });
});
