import {
  DEFAULT_LINE_ADVANCE_FACTOR,
  defaultAscent,
  defaultLineAdvance,
  fontAscent,
  layoutLines,
} from '../../../src/rendering/text/line-metrics';

describe('line-metrics', () => {
  it('default line advance is 1.2 × fontSize (font:10517)', () => {
    expect(DEFAULT_LINE_ADVANCE_FACTOR).toBe(1.2);
    expect(defaultLineAdvance(10)).toBeCloseTo(12, 10);
    expect(defaultLineAdvance(8)).toBeCloseTo(9.6, 10);
    expect(defaultLineAdvance(0)).toBe(0);
  });

  it('default ascent is 0.8 × fontSize without font metrics', () => {
    expect(defaultAscent(10)).toBeCloseTo(8, 10);
  });

  it('fontAscent applies the Adobe max(A, 1-D) clamp (font:0x14f0fb07 [asm])', () => {
    const fakeFont = { embedder: { font: { Ascender: 718 } } } as never;
    expect(fontAscent(fakeFont, 10)).toBeCloseTo(8.0, 10);
    expect(fontAscent(undefined, 10)).toBeCloseTo(8, 10);
  });

  describe('layoutLines', () => {
    const box = { top: 100, bottom: 40 };

    it('top: first line is topmost, baselines step down by advance', () => {
      const { baselines, blockHeight } = layoutLines(3, 10, box, 'top');
      expect(blockHeight).toBeCloseTo(36, 10);
      expect(baselines[0]).toBeCloseTo(100 - 8, 10);
      expect(baselines[1]).toBeCloseTo(baselines[0] - 12, 10);
      expect(baselines[2]).toBeCloseTo(baselines[1] - 12, 10);
    });

    it('bottom: last baseline sits one descent above the box bottom', () => {
      const { baselines, blockHeight } = layoutLines(3, 10, box, 'bottom');
      expect(blockHeight).toBeCloseTo(36, 10);
      expect(baselines[2]).toBeCloseTo(40 + 4, 10);
      expect(baselines[0]).toBeCloseTo(baselines[2] + 24, 10);
    });

    it('middle: block is vertically centered in the box', () => {
      const { baselines, blockHeight } = layoutLines(2, 10, box, 'middle');
      expect(blockHeight).toBeCloseTo(24, 10);
      const blockTop = baselines[0] + 8;
      const blockBottom = blockTop - blockHeight;
      expect(box.top - blockTop).toBeCloseTo(blockBottom - box.bottom, 10);
    });

    it('uses clamped font ascent when provided', () => {
      const fakeFont = { embedder: { font: { Ascender: 718 } } } as never;
      const { baselines } = layoutLines(1, 10, box, 'top', fakeFont);
      expect(baselines[0]).toBeCloseTo(100 - 8.0, 10);
    });

    it('zero lines yields an empty block', () => {
      const { baselines, blockHeight } = layoutLines(0, 10, box, 'top');
      expect(blockHeight).toBe(0);
      expect(baselines).toEqual([]);
    });
  });
});
