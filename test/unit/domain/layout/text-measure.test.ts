import { measureLayoutText } from '../../../../src/domain/layout/text-measure';
import { FontSpec } from '../../../../src/types';
import { APPROX_CHAR_WIDTH_FACTOR } from '../../../../src/rendering/text/measure';
import { NARROW_SCALE } from '../../../../src/rendering/standard-fonts';

describe('measureLayoutText', () => {
  it('returns zero for empty text', () => {
    expect(measureLayoutText('', 12)).toBe(0);
  });

  it('measures with the default Helvetica embedder', () => {
    expect(measureLayoutText('Hello', 12)).toBeCloseTo(27.336, 6);
    expect(measureLayoutText('W', 12)).toBeCloseTo(11.328, 6);
    expect(measureLayoutText('Hi', 10)).toBeCloseTo(9.44, 6);
  });

  it('honours weight and posture when selecting a standard font', () => {
    const bold: FontSpec = { family: 'Helvetica', weight: 'bold' };
    expect(measureLayoutText('Hello', 10, bold)).toBeCloseTo(24.45, 6);
    const italic: FontSpec = { family: 'Courier', posture: 'italic' };
    expect(measureLayoutText('Hi', 10, italic)).toBeCloseTo(12, 6);
  });

  it('scales condensed families', () => {
    const narrow: FontSpec = { family: 'Arial Narrow' };
    const plain: FontSpec = { family: 'Arial' };
    expect(measureLayoutText('Hello', 12, narrow)).toBeCloseTo(
      measureLayoutText('Hello', 12, plain) * NARROW_SCALE,
      6
    );
  });

  it('falls back to an approximate width for non-standard families', () => {
    const unknown: FontSpec = { family: 'NotARealFont' };
    expect(measureLayoutText('Hello', 12, unknown)).toBe(5 * 12 * APPROX_CHAR_WIDTH_FACTOR);
  });
});
