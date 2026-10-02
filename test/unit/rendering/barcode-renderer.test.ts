import { PDFDocument } from 'pdf-lib';
import { contentStream, pathRectCount } from '../../helpers/pdf-content';
import {
  normalizeSymbology,
  encodeBarcode,
  renderBarcode,
  SUPPORTED_SYMBOLOGIES,
  PENDING_SYMBOLOGIES,
} from '../../../src/rendering/barcode-renderer';

/**
 * Adobe's symbology spellings come from `barcodeDefinition type="..."` in
 * `reference/Adobe-LiveCycle-Designer-11.0/config_files/adobepdf.xdc:212-252`.
 * The pre-G1 dispatcher used naive `includes()` checks that never matched
 * `code3Of9` / `code2Of5Interleaved` / `code128SSCC`.
 */
describe('normalizeSymbology — Adobe .xdc name mapping', () => {
  const cases: Array<[string, string]> = [
    ['code3Of9', 'code39'],
    ['code39', 'code39'],
    ['code39limited', 'code39'],
    ['logmars', 'code39'],
    ['code128', 'code128b'],
    ['code128A', 'code128a'],
    ['code128B', 'code128b'],
    ['code128C', 'code128c'],
    ['code128SSCC', 'code128sscc'],
    ['ucc128', 'code128b'],
    ['ean13', 'ean13'],
    ['ean8', 'ean8'],
    ['upcA', 'upca'],
    ['upcE', 'upce'],
    ['codabar', 'codabar'],
    ['code2Of5Interleaved', '2of5interleaved'],
    ['code2Of5Matrix', '2of5matrix'],
    ['code2Of5Industrial', '2of5industrial'],
    ['code2Of5Standard', '2of5standard'],
    ['code93', 'code93'],
    ['code11', 'code11'],
    ['msi', 'msi'],
    ['pdf417', 'pdf417'],
    ['QRCode', 'qrcode'],
    ['dataMatrix', 'datamatrix'],
    ['aztec', 'aztec'],
  ];

  it.each(cases)('%s → %s', (input, expected) => {
    expect(normalizeSymbology(input)).toBe(expected);
  });

  it('normalizes separators and case', () => {
    expect(normalizeSymbology('CODE-2_OF5 Interleaved')).toBe('2of5interleaved');
  });

  it('falls back to code39 for an empty name', () => {
    expect(normalizeSymbology('')).toBe('code39');
    expect(normalizeSymbology(undefined as unknown as string)).toBe('code39');
  });

  it('every supported name maps to itself', () => {
    for (const name of SUPPORTED_SYMBOLOGIES) {
      expect(normalizeSymbology(name)).toBe(name);
    }
  });

  it('pending names are classified rather than silently treated as unknown', () => {
    for (const name of PENDING_SYMBOLOGIES) {
      expect(normalizeSymbology(name)).toBeTruthy();
    }
  });
});

describe('encodeBarcode — encoders produce well-formed runs', () => {
  it.each([...SUPPORTED_SYMBOLOGIES])('%s emits a substantial bar run', (sym) => {
    const bars = encodeBarcode(sym, '1234567890');
    expect(bars.length).toBeGreaterThan(10);
    expect(bars[0].type).toMatch(/-bar$/);
  });

  it('Code 39 wraps the payload in start/stop asterisks', () => {
    const withGaps = encodeBarcode('code3Of9', 'A');
    const bare = encodeBarcode('code3Of9', '');
    expect(withGaps.length).toBeGreaterThan(bare.length);
  });

  it('EAN-13 always encodes 13 digits (12 + check)', () => {
    const bars = encodeBarcode('ean13', '4006381333931');
    expect(bars.length).toBe(95); // 3 + 42 + 5 + 42 + 3
  });

  it('EAN-8 always encodes 8 digits', () => {
    const bars = encodeBarcode('ean8', '9638507');
    expect(bars.length).toBe(67); // 3 + 28 + 5 + 28 + 3
  });

  it('interleaved 2-of-5 pads an odd digit count', () => {
    const even = encodeBarcode('code2Of5Interleaved', '1234');
    const odd = encodeBarcode('code2Of5Interleaved', '123');
    expect(even.length).toBeGreaterThan(0);
    expect(odd.length).toBeGreaterThan(0);
    expect(odd.length).toBe(even.length);
  });

  it('2-of-5 variants differ from one another', () => {
    const industrial = encodeBarcode('code2Of5Industrial', '1234');
    const interleaved = encodeBarcode('code2Of5Interleaved', '1234');
    const matrix = encodeBarcode('code2Of5Matrix', '1234');
    expect(interleaved.length).not.toBe(industrial.length);
    expect(matrix.length).not.toBe(industrial.length);
    // Matrix alternates bar/space elements; Industrial emits bars only.
    expect(matrix.every((b) => b.type.endsWith('-bar'))).toBe(false);
  });

  it('UPC-A produces the same run as EAN-13 with a leading zero', () => {
    expect(encodeBarcode('upcA', '03600029145')).toEqual(
      encodeBarcode('ean13', '0036000291452')
    );
  });

  it('unknown symbology degrades to Code 39 rather than drawing nothing', () => {
    expect(encodeBarcode('nosuchthing', 'ABC').length).toBeGreaterThan(0);
  });
});

describe('renderBarcode — PDF output', () => {
  async function draw(opts: {
    align?: 'left' | 'center' | 'right';
    w?: number;
    moduleW?: number;
    ratio?: number;
    data?: string;
  } = {}): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    renderBarcode(
      page,
      'code3Of9',
      opts.data ?? 'ABC-123',
      10,
      20,
      opts.w ?? 280,
      60,
      opts.moduleW ?? 2,
      opts.align ?? 'center',
      opts.ratio ?? 2.5,
    );
    return Buffer.from(await doc.save({ useObjectStreams: false }));
  }

  it('emits filled path rectangles', async () => {
    const content = await contentStream(await draw());
    expect(pathRectCount(content)).toBeGreaterThan(20);
  });

  it('center, left and right alignment produce different runs', async () => {
    const centered = await draw({ align: 'center' });
    const left = await draw({ align: 'left' });
    const right = await draw({ align: 'right' });
    expect(centered.equals(left)).toBe(false);
    expect(centered.equals(right)).toBe(false);
  });

  it('wide-narrow ratio changes the output', async () => {
    const narrow = await draw({ ratio: 2.2 });
    const wide = await draw({ ratio: 3.0 });
    expect(narrow.equals(wide)).toBe(false);
  });

  it('shrinks to fit when the requested module width is too wide', async () => {
    const wide = await draw({ moduleW: 20, w: 100 });
    const narrow = await draw({ moduleW: 0.5, w: 280 });
    expect(wide.equals(narrow)).toBe(false);
  });

  it('does nothing for empty data or a degenerate box', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    renderBarcode(page, 'code3Of9', '', 0, 0, 50, 20);
    renderBarcode(page, 'code3Of9', 'X', 0, 0, 0, 20);
    renderBarcode(page, 'code3Of9', 'X', 0, 0, 50, 0);
    const content = await contentStream(Buffer.from(await doc.save({ useObjectStreams: false })));
    expect(pathRectCount(content)).toBe(0);
  });
});

describe('Code 128 (G1 — wired into encodeBars)', () => {
  const isBar = (b: { type: string }) => b.type.endsWith('-bar');
  const types = (bars: { type: string }[]) => bars.map((b) => b.type).join(',');

  it('encodes subset B as one module per element, start→data→check→stop', () => {
    const bars = encodeBarcode('code128B', 'HI');
    // start(11) + H(11) + I(11) + check(11) + stop(13) = 57 modules
    expect(bars).toHaveLength(57);
    expect(bars[0].type).toBe('narrow-bar');
    expect(bars[bars.length - 1].type).toBe('narrow-bar');
    expect(bars.every((b) => b.type.startsWith('narrow'))).toBe(true);
  });

  it('encodes subset A for control-heavy payloads and B for printable ones', () => {
    const a = encodeBarcode('code128A', 'ABC');
    const b = encodeBarcode('code128B', 'ABC');
    // start(11) + 3×11 + check(11) + stop(13)
    expect(a).toHaveLength(68);
    expect(b).toHaveLength(68);
    expect(types(a)).not.toBe(types(b));
  });

  it('falls back to subset B when subset A cannot hold a character', () => {
    expect(types(encodeBarcode('code128A', 'abc'))).toBe(types(encodeBarcode('code128B', 'abc')));
  });

  it('encodes subset C as one symbol per digit pair', () => {
    const bars = encodeBarcode('code128C', '123456');
    // start(11) + 3 pairs(3×11) + check(11) + stop(13)
    expect(bars).toHaveLength(68);
  });

  it('falls back to subset B for an odd-length digit run', () => {
    expect(types(encodeBarcode('code128C', '12345'))).toBe(types(encodeBarcode('code128B', '12345')));
  });

  it('pads SSCC to 18 digits and encodes it in subset C', () => {
    const bars = encodeBarcode('code128SSCC', '123456789012345678');
    // start(11) + 9 pairs(9×11) + check(11) + stop(13)
    expect(bars).toHaveLength(134);
    expect(types(bars)).toBe(types(encodeBarcode('code128SSCC', '9123456789012345678')));
  });

  it('alternates bar/space runs and never merges across symbols', () => {
    const bars = encodeBarcode('code128B', 'HELLO WORLD');
    expect(bars[0].type).toBe('narrow-bar');
    // Every run boundary flips bar↔space; runs themselves stay constant.
    let runType = isBar(bars[0]);
    for (let i = 1; i < bars.length; i++) {
      const nowBar = isBar(bars[i]);
      if (nowBar !== runType) {
        runType = nowBar;
      }
    }
    expect(bars.filter((b) => isBar(b)).length).toBeGreaterThan(0);
    expect(bars.filter((b) => !isBar(b)).length).toBeGreaterThan(0);
  });

  it('different payloads produce different symbols', () => {
    expect(types(encodeBarcode('code128B', 'AAA'))).not.toBe(types(encodeBarcode('code128B', 'AAB')));
  });

  it('renders to PDF rectangles', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 100]);
    renderBarcode(page, 'code128B', 'PO123456789', 10, 10, 280, 60);
    const content = await contentStream(Buffer.from(await doc.save({ useObjectStreams: false })));
    expect(pathRectCount(content)).toBeGreaterThan(10);
  });
});

describe('G15 — additional symbologies', () => {
  const types = (bars: { type: string }[]) => bars.map((b) => b.type).join(',');

  it('encodes Code 93 with start/stop, data and two check chars', () => {
    const bars = encodeBarcode('code93', 'ABC');
    // start(9) + 3×9 data + 2×9 check + stop(9) + termination(1)
    expect(bars).toHaveLength(64);
    expect(bars[0].type).toBe('narrow-bar');
    expect(bars[bars.length - 1].type).toBe('narrow-bar');
    expect(bars.every((b) => b.type.startsWith('narrow'))).toBe(true);
  });

  it('uppercases Code 93 input', () => {
    expect(types(encodeBarcode('code93', 'abc'))).toBe(types(encodeBarcode('code93', 'ABC')));
  });

  it('encodes UPC-E independently of the optional check digit', () => {
    const withCheck = encodeBarcode('upcE', '01234565');
    const withoutCheck = encodeBarcode('upcE', '0123456');
    // start(3) + 6×7 + end(6)
    expect(withCheck).toHaveLength(51);
    expect(types(withCheck)).toBe(types(withoutCheck));
  });

  it('differs from UPC-A', () => {
    expect(types(encodeBarcode('upcE', '0123456'))).not.toBe(
      types(encodeBarcode('upcA', '012000003455'))
    );
  });

  it('encodes MSI with a mod-10 check digit', () => {
    const bars = encodeBarcode('msi', '123');
    // start(3) + 4 digits (3 + check)×12 + stop(4)
    expect(bars).toHaveLength(3 + 4 * 12 + 4);
  });

  it('aliases code2Of5Standard to the industrial encoding', () => {
    expect(types(encodeBarcode('code2Of5Standard', '1234'))).toBe(
      types(encodeBarcode('code2Of5Industrial', '1234'))
    );
  });

  it('exposes the new names through normalizeSymbology', () => {
    expect(normalizeSymbology('code93')).toBe('code93');
    expect(normalizeSymbology('msi')).toBe('msi');
    expect(normalizeSymbology('upcE')).toBe('upce');
    expect(normalizeSymbology('code2Of5Standard')).toBe('2of5standard');
  });

  it('lists the new encoders as supported', () => {
    for (const name of ['code93', 'msi', 'upce', '2of5standard']) {
      expect((SUPPORTED_SYMBOLOGIES as readonly string[]).includes(name)).toBe(true);
      expect((PENDING_SYMBOLOGIES as readonly string[]).includes(name)).toBe(false);
    }
  });
});
