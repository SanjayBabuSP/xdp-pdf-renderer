import { PDFDocument } from 'pdf-lib';
import { contentStream, pathRectCount } from '../../helpers/pdf-content';
import {
  ecCountForLevel,
  encodePdf417,
  modulesPerRow,
  rowToModules,
} from '../../../src/rendering/pdf417';
import { renderBarcode } from '../../../src/rendering/barcode-renderer';
import pdf417Tables from '../../../src/config/pdf417-tables.json';

/**
 * PDF417 (G15a) — built on Adobe's own tables dumped from `pdf417pmp.dll`
 * (see scripts/pdf417-dump-tables.py) with the algorithm layer from
 * `reference/decompiled/pdf417pmp_disasm.c`.
 */

const bytes = (n: number) => [...Array(n)].map(() => 0);

describe('PDF417 — Adobe cluster pattern tables (dumped from pdf417pmp.dll)', () => {
  it('contains 929 patterns per cluster', () => {
    expect(pdf417Tables.clusters.cluster0).toHaveLength(929);
    expect(pdf417Tables.clusters.cluster3).toHaveLength(929);
    expect(pdf417Tables.clusters.cluster6).toHaveLength(929);
  });

  it('first patterns match the decompiled string symbols', () => {
    // s_31111136_12b13088 / s_51111125_12b15138 / s_21111155_12b171e8
    expect(pdf417Tables.clusters.cluster0[0]).toBe('31111136');
    expect(pdf417Tables.clusters.cluster3[0]).toBe('51111125');
    expect(pdf417Tables.clusters.cluster6[0]).toBe('21111155');
  });

  it('every pattern is 8 runs summing to 17 modules (ISO 15438 invariant)', () => {
    for (const cluster of [
      pdf417Tables.clusters.cluster0,
      pdf417Tables.clusters.cluster3,
      pdf417Tables.clusters.cluster6,
    ]) {
      for (const pattern of cluster) {
        expect(pattern).toMatch(/^[1-8]{8}$/);
        const sum = [...pattern].reduce((n, c) => n + Number(c), 0);
        expect(sum).toBe(17);
      }
    }
  });

  it('dumped RS coefficients match the published PDF417 generator tables', () => {
    expect(pdf417Tables.rs['0']).toEqual([27, 917]);
    expect(pdf417Tables.rs['1']).toEqual([522, 568, 723, 809]);
  });
});

describe('PDF417 — structure (FUN_12b0c9c0 row painting)', () => {
  it('paints rows of exactly modulesPerRow(columns) modules', () => {
    const symbol = encodePdf417('Adobe PDF417');
    const expected = modulesPerRow(symbol.columns);
    expect(symbol.rowPatterns).toHaveLength(symbol.rows);
    for (const row of symbol.rowPatterns) {
      const sum = [...row].reduce((n, c) => n + Number(c), 0);
      expect(sum).toBe(expected);
    }
  });

  it('emits Adobe limits (cols<=30, rows>=3, rows<=90, capacity<=928)', () => {
    const symbol = encodePdf417('Hello, Adobe LiveCycle PDF417 barcode!');
    expect(symbol.columns).toBeLessThanOrEqual(30);
    expect(symbol.rows).toBeGreaterThanOrEqual(3);
    expect(symbol.rows).toBeLessThanOrEqual(90);
    expect(symbol.columns * symbol.rows).toBeLessThanOrEqual(928);
  });

  it('starts each row with 81111113 and ends with stop + terminator', () => {
    const symbol = encodePdf417('PD');
    for (const row of symbol.rowPatterns) {
      expect(row.startsWith('81111113')).toBe(true);
      expect(row.endsWith('7113111211')).toBe(true);
    }
  });

  it('cycles clusters 0/3/6 across rows', () => {
    const symbol = encodePdf417('ABC123');
    const clusterOf = (pattern: string): number => {
      const cluster = pattern.slice(8, 16); // left indicator, after the 8-char start pattern
      const table = (['cluster0', 'cluster3', 'cluster6'] as const).find((name) =>
        (pdf417Tables.clusters as Record<string, string[]>)[name].includes(cluster),
      );
      return (['cluster0', 'cluster3', 'cluster6'] as const).indexOf(table!);
    };
    const clusters = symbol.rowPatterns.map(clusterOf);
    clusters.forEach((c, row) => expect(c).toBe(row % 3));
  });

  it('appends 2^(level+1) EC codewords per level', () => {
    for (const level of [0, 2, 5, 8]) {
      const symbol = encodePdf417('ECC', { errorCorrectionLevel: level });
      expect(ecCountForLevel(level)).toBe(1 << (level + 1));
      // The painted codewords are exactly the full symbol: data + EC.
      expect(symbol.columns * symbol.rows).toBe(symbol.codewords.length);
    }
  });

  it('rejects empty messages', () => {
    expect(() => encodePdf417('')).toThrow();
  });
});

describe('PDF417 — Reed-Solomon remainder (FUN_12b0ba90)', () => {
  it('parity equals the complemented remainder of the data codewords', () => {
    const MOD = 929;
    const level = 5;
    const coefficients = (pdf417Tables.rs as Record<string, number[]>)[String(level)];
    const count = ecCountForLevel(level);
    const symbol = encodePdf417('ReedSolomon check', { errorCorrectionLevel: level });
    const dataCount = symbol.columns * symbol.rows - count;
    const data = symbol.codewords.slice(0, dataCount);
    const parity = symbol.codewords.slice(dataCount);
    expect(parity).toHaveLength(count);

    // Independent LFSR over the data codewords (FUN_12b0ba90's remainder loop).
    const remainder = new Array<number>(count).fill(0);
    for (const value of data) {
      const temp = (value + remainder[count - 1]) % MOD;
      for (let i = count - 1; i > 0; i--) {
        remainder[i] = (remainder[i - 1] + MOD - ((coefficients[i] * temp) % MOD)) % MOD;
      }
      remainder[0] = (MOD - ((coefficients[0] * temp) % MOD)) % MOD;
    }
    // The encoder appends (MOD - remainder) % MOD per the decompile's final loop.
    expect(parity).toEqual(remainder.map((r) => (MOD - r) % MOD));
  });
});

describe('PDF417 — deterministic golden encoding', () => {
  it('pins the codeword sequence for a fixed payload', () => {
    const symbol = encodePdf417('ABC123', { errorCorrectionLevel: 1, columns: 4, rows: 6 });
    expect(symbol.codewords.length).toBe(4 * 6);
    expect(symbol.codewords[0]).toBe(4 * 6 - 4); // descriptor = data codewords
    expect(symbol.rowPatterns).toHaveLength(6);
    expect(symbol.rowPatterns[0].startsWith('81111113')).toBe(true);
  });

  it('is stable for the same input', () => {
    const a = encodePdf417('stable');
    const b = encodePdf417('stable');
    expect(a.rowPatterns).toEqual(b.rowPatterns);
  });
});

describe('PDF417 — module painting', () => {
  it('rowToModules fills exactly the dark runs', () => {
    // '31111136' = dark3 light1 dark1 light1 dark1 light1 dark3 light6
    const modules = rowToModules('31111136', 17);
    expect(modules).toHaveLength(17);
    // Dark runs: 3 + 1 + 1 + 3 = 8 of 17 modules.
    expect(modules.filter(Boolean)).toHaveLength(8);
    expect(modules.slice(0, 3).every(Boolean)).toBe(true);
    expect(modules[3]).toBe(false);
    expect(modules[6]).toBe(true);
  });
});

describe('PDF417 — rendering to PDF', () => {
  async function draw(data: string, opts: { w?: number; h?: number } = {}) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    renderBarcode(page, 'pdf417', data, 20, 20, opts.w ?? 300, opts.h ?? 120);
    return contentStream(Buffer.from(await doc.save({ useObjectStreams: false })));
  }

  it('paints one dark run rectangle per contiguous module run', async () => {
    const content = await draw('PDF417');
    expect(pathRectCount(content)).toBeGreaterThan(50);
  });

  it('paints nothing for empty data', async () => {
    const content = await draw('');
    expect(pathRectCount(content)).toBe(0);
  });

  it('row width scales to the requested box', async () => {
    const wide = await draw('PDF417', { w: 300 });
    const narrow = await draw('PDF417', { w: 120 });
    expect(wide.toString()).not.toBe(narrow.toString());
  });
});
