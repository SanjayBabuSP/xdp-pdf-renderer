import type { PDFFont } from 'pdf-lib';
import {
  layoutRunBaselines,
  layoutRunLines,
  runBlockHeight,
  type StyledRun,
} from '../../../src/rendering/text/run-flow';
import { parseRichText } from '../../../src/rendering/rich-text-parser';
import { defaultLineAdvance } from '../../../src/rendering/text/line-metrics';

/** No metrics → ascent falls back to 0.8 × size. */
const fakeFont = {} as PDFFont;

/** width = character count (1 unit per char), per run index. */
const measure = (text: string): number => text.length;

function styled(text: string, size = 10): StyledRun[] {
  return [{ text, size, font: fakeFont }];
}

/**
 * Rebuild a line's visible text: segments are drawn separately, so the
 * spaces between them survive only as x gaps (measure is 1 unit/char here).
 */
function lineText(line: { segments: { text: string; x: number }[] }): string {
  let out = '';
  let x = 0;
  for (const segment of line.segments) {
    if (segment.x > x) out += ' '.repeat(Math.round(segment.x - x));
    out += segment.text;
    x = segment.x + segment.text.length;
  }
  return out;
}

describe('run-flow — wrapping', () => {
  it('wraps on word boundaries and positions each word', () => {
    const lines = layoutRunLines(styled('aaaa bbbb cccc'), {
      maxWidth: 8,
      baseSize: 10,
      measure,
    });
    expect(lines.map(lineText)).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(lines[0].segments.map((s) => s.x)).toEqual([0]);
    expect(lines[1].segments.map((s) => s.x)).toEqual([0]);
  });

  it('keeps a word that straddles two runs together on one line', () => {
    const runs: StyledRun[] = [
      { text: 'hel', size: 10, font: fakeFont },
      { text: 'lo', size: 10, font: fakeFont },
      { text: ' world', size: 10, font: fakeFont },
    ];
    const lines = layoutRunLines(runs, { maxWidth: 100, baseSize: 10, measure });
    expect(lines).toHaveLength(1);
    expect(lines[0].segments.map((s) => [s.text, s.x, s.run])).toEqual([
      ['hel', 0, 0],
      ['lo', 3, 1],
      ['world', 6, 2],
    ]);
    expect(lines[0].width).toBe(11);
  });

  it('measures per run so a large run widens the line', () => {
    const runs: StyledRun[] = [
      { text: 'aa', size: 10, font: fakeFont },
      { text: 'bb', size: 30, font: fakeFont },
    ];
    const wide = (text: string, run: number): number => text.length * (runs[run].size / 10);
    const lines = layoutRunLines(runs, { maxWidth: 100, baseSize: 10, measure: wide });
    expect(lines).toHaveLength(1);
    expect(lines[0].width).toBe(2 + 6);
  });

  it('drops leading whitespace and splits an over-wide word by characters', () => {
    const lines = layoutRunLines(styled('   abcdefghijkl'), {
      maxWidth: 6,
      baseSize: 10,
      measure,
    });
    expect(lines.map(lineText)).toEqual(['abcdef', 'ghijkl']);
    expect(lines[0].segments[0].x).toBe(0);
  });

  it('honours hard line breaks and flags the paragraph end', () => {
    const lines = layoutRunLines(styled('one two\nthree'), {
      maxWidth: 1000,
      baseSize: 10,
      measure,
    });
    expect(lines.map(lineText)).toEqual(['one two', 'three']);
    expect(lines.map((l) => l.paragraphEnd)).toEqual([true, true]);
    expect(lines[1].segments[0].x).toBe(0);
  });

  it('emits an empty line for consecutive breaks', () => {
    const lines = layoutRunLines(styled('a\n\nb'), {
      maxWidth: 1000,
      baseSize: 10,
      measure,
    });
    expect(lines.map(lineText)).toEqual(['a', '', 'b']);
    expect(lines[1].segments).toHaveLength(0);
    expect(lines[1].advance).toBe(defaultLineAdvance(10));
  });
});

describe('run-flow — line box metrics', () => {
  it('advances 1.2 × the largest run size on the line (font:10517)', () => {
    const lines = layoutRunLines(
      [
        { text: 'small', size: 8, font: fakeFont },
        { text: 'BIG', size: 16, font: fakeFont },
      ],
      { maxWidth: 1000, baseSize: 8, measure }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].advance).toBe(defaultLineAdvance(16));
    expect(lines[0].ascent).toBeCloseTo(0.8 * 16, 6);
  });

  it('uses the base size for blank lines', () => {
    const lines = layoutRunLines(styled('\n'), { maxWidth: 100, baseSize: 12, measure });
    expect(lines[0].advance).toBe(defaultLineAdvance(12));
  });
});

describe('run-flow — vertical stacking', () => {
  const lines = layoutRunLines(styled('aa\nbbbb'), {
    maxWidth: 1000,
    baseSize: 10,
    measure,
  });

  it('top-aligns the first baseline one ascent below the box top', () => {
    const baselines = layoutRunBaselines(lines, { top: 100, bottom: 0 }, 'top');
    expect(baselines[0]).toBeCloseTo(100 - 8, 6);
    // each line steps by the previous line's advance
    expect(baselines[1]).toBeCloseTo(baselines[0] - defaultLineAdvance(10), 6);
  });

  it('bottom- and middle-aligns the block inside the box', () => {
    const blockH = runBlockHeight(lines);
    const bottom = layoutRunBaselines(lines, { top: 100, bottom: 0 }, 'bottom');
    expect(bottom[0]).toBeCloseTo(blockH - 8, 6);
    const middle = layoutRunBaselines(lines, { top: 100, bottom: 0 }, 'middle');
    expect(middle[0]).toBeCloseTo((100 + blockH) / 2 - 8, 6);
  });

  it('sums per-line advances for the overflow-clip test', () => {
    expect(runBlockHeight(lines)).toBeCloseTo(defaultLineAdvance(10) * 2, 6);
  });
});

describe('run-flow — rich text round trip', () => {
  it('lays out parser output with per-tag sizes', () => {
    const runs = parseRichText('Hello <b>bold</b> and <span style="font-size:16pt">big</span>');
    expect(runs.length).toBeGreaterThan(1);
    const styledRuns: StyledRun[] = runs.map((run) => ({
      text: run.text,
      size: run.fontSize ?? 10,
      font: fakeFont,
    }));
    const lines = layoutRunLines(styledRuns, { maxWidth: 1000, baseSize: 10, measure });
    expect(lines).toHaveLength(1);
    expect(lineText(lines[0])).toBe('Hello bold and big');
    const bigRun = styledRuns.findIndex((r) => r.text === 'big');
    expect(bigRun).toBeGreaterThan(-1);
    expect(lines[0].advance).toBe(defaultLineAdvance(16));
  });

  it('breaks at <br> runs', () => {
    const runs = parseRichText('first<br/>second');
    const styledRuns: StyledRun[] = runs.map((run) => ({
      text: run.text,
      size: 10,
      font: fakeFont,
    }));
    const lines = layoutRunLines(styledRuns, { maxWidth: 1000, baseSize: 10, measure });
    expect(lines.map(lineText)).toEqual(['first', 'second']);
  });
});
