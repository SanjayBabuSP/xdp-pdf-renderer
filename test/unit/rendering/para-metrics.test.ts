import type { PDFFont } from 'pdf-lib';
import { layoutLines, paraMetrics } from '../../../src/rendering/text/line-metrics';
import { breakLinesInfo } from '../../../src/rendering/text/line-breaker';
import {
  layoutRunBaselines,
  layoutRunLines,
  runBlockHeight,
  type StyledRun,
} from '../../../src/rendering/text/run-flow';

const measure = (s: string): number => s.length;
const fakeFont = {} as PDFFont;

describe('<para> metrics (jfTextAttr Spacing/SpaceBefore/SpaceAfter/MarginL/MarginR)', () => {
  it('resolves lineHeight override and point offsets', () => {
    const pm = paraMetrics(
      {
        lineHeight: 20,
        spaceAbove: 3,
        spaceBelow: 4,
        textIndent: 12,
        marginLeft: 5,
        marginRight: 6,
      },
      10
    );
    expect(pm).toEqual({
      lineAdvance: 20,
      spaceAbove: 3,
      spaceBelow: 4,
      textIndent: 12,
      marginLeft: 5,
      marginRight: 6,
    });
  });

  it('falls back to 1.2 × size when lineHeight is absent', () => {
    const pm = paraMetrics(undefined, 10);
    expect(pm.lineAdvance).toBeCloseTo(12, 10);
    expect(pm.spaceAbove).toBe(0);
    expect(pm.marginLeft).toBe(0);
  });

  it('falls back to 1.2 × inherited size when provided', () => {
    expect(paraMetrics(undefined, 12, 10).lineAdvance).toBeCloseTo(12, 10);
    expect(paraMetrics(undefined, 11, 12).lineAdvance).toBeCloseTo(13.2, 10);
  });

  it('caps the fallback at the own size when it is smaller', () => {
    expect(paraMetrics(undefined, 6.5, 10).lineAdvance).toBeCloseTo(7.8, 10);
  });

  it('prefers an explicit lineHeight over both sizes', () => {
    expect(paraMetrics({ lineHeight: 30 }, 12, 10).lineAdvance).toBe(30);
  });

  it('layoutLines honours lineAdvance and vertical padding', () => {
    const { blockHeight, baselines } = layoutLines(
      2,
      10,
      { top: 100, bottom: 0 },
      'top',
      undefined,
      { lineAdvance: 20, paddingTop: 5, paddingBottom: 7 }
    );
    expect(blockHeight).toBeCloseTo(40, 10);
    expect(baselines[0]).toBeCloseTo(95 - 8, 10);
    expect(baselines[1]).toBeCloseTo(baselines[0] - 20, 10);
  });

  it('line breaker applies first-line indent to each paragraph', () => {
    const lines = breakLinesInfo('aaaa bbbb', 10, measure, { firstLineIndent: 5 });
    expect(lines.map((l) => l.text)).toEqual(['aaaa', 'bbbb']);
  });

  it('first-line indent does not affect continuation lines', () => {
    const lines = breakLinesInfo('aa bb cc', 6, measure, { firstLineIndent: 3 });
    expect(lines.map((l) => l.text)).toEqual(['aa', 'bb cc']);
  });
});

describe('paragraph metrics applied to styled runs', () => {
  it('uses a per-run line advance instead of the single paragraph advance', () => {
    const runs: StyledRun[] = [{ text: 'aa', size: 10, font: fakeFont, lineAdvance: 22 }];
    const lines = layoutRunLines(runs, {
      maxWidth: 100,
      baseSize: 10,
      measure,
      paragraph: { lineAdvance: 12 },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].advance).toBe(22);
    expect(runBlockHeight(lines)).toBe(22);
    const baselines = layoutRunBaselines(lines, { top: 100, bottom: 0 });
    expect(baselines[0]).toBeCloseTo(100 - lines[0].ascent, 6);
  });

  it('adds authored line-height and margins to the run block height', () => {
    const runs: StyledRun[] = [
      {
        text: 'First',
        size: 10,
        font: fakeFont,
        lineAdvance: 18,
        marginTop: 3,
        marginBottom: 4,
      },
      { text: '\n', size: 10, font: fakeFont },
      { text: 'Second', size: 10, font: fakeFont, lineAdvance: 9 },
    ];
    const lines = layoutRunLines(runs, {
      maxWidth: 100,
      baseSize: 10,
      measure,
      paragraph: { lineAdvance: 12 },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].advance).toBe(25);
    expect(lines[1].advance).toBe(9);
    expect(runBlockHeight(lines)).toBe(34);
  });
});
