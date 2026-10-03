import {
  layoutLines,
  paraMetrics,
} from '../../../src/rendering/text/line-metrics';
import { breakLinesInfo } from '../../../src/rendering/text/line-breaker';

const measure = (s: string): number => s.length;

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
    // blockTop = 100 − 5; first baseline = blockTop − ascent(0.8×10)
    expect(baselines[0]).toBeCloseTo(95 - 8, 10);
    expect(baselines[1]).toBeCloseTo(baselines[0] - 20, 10);
  });

  it('line breaker applies first-line indent to each paragraph', () => {
    const lines = breakLinesInfo('aaaa bbbb', 10, measure, { firstLineIndent: 5 });
    expect(lines.map((l) => l.text)).toEqual(['aaaa', 'bbbb']);
  });

  it('first-line indent does not affect continuation lines', () => {
    const lines = breakLinesInfo('aa bb cc', 6, measure, { firstLineIndent: 3 });
    // first line limit 3 → 'aa'; continuation limit 6 → 'bb cc'
    expect(lines.map((l) => l.text)).toEqual(['aa', 'bb cc']);
  });
});
