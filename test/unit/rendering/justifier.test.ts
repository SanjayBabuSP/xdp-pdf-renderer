import {
  alignClassOf,
  combPlacement,
  horizontalOffsetX,
  JUST_H,
  JUST_V,
  justifyLine,
  mapJustH,
  mapJustV,
} from '../../../src/rendering/text/justifier';
import { breakLines, breakLinesInfo } from '../../../src/rendering/text/line-breaker';

/** width = character count (1 unit per char) */
const measure = (s: string): number => s.length;

describe('justifier — string → code', () => {
  it('maps XFA/markup hAlign strings to JustH codes (jftext:96435-96443)', () => {
    expect(mapJustH('left')).toBe(JUST_H.left);
    expect(mapJustH('center')).toBe(JUST_H.center);
    expect(mapJustH('right')).toBe(JUST_H.right);
    expect(mapJustH('justify')).toBe(JUST_H.justify);
    expect(mapJustH('justifyAll')).toBe(JUST_H.justifyAll);
    expect(mapJustH('justify-all')).toBe(JUST_H.justifyAll);
    expect(mapJustH('radix')).toBe(JUST_H.radix);
    expect(mapJustH('comb-left')).toBe(JUST_H.combLeft);
    expect(mapJustH('comb-center')).toBe(JUST_H.combCenter);
    expect(mapJustH('comb-right')).toBe(JUST_H.combRight);
    // RTF spellings map to the same codes (jftext:90311-90317, :90512-90518)
    expect(mapJustH('ql')).toBe(JUST_H.left);
    expect(mapJustH('qc')).toBe(JUST_H.center);
    expect(mapJustH('qr')).toBe(JUST_H.right);
    expect(mapJustH('qj')).toBe(JUST_H.justify);
    // RTL pair resolves to the LTR ends (LTR-only scope)
    expect(mapJustH('start')).toBe(JUST_H.left);
    expect(mapJustH('end')).toBe(JUST_H.right);
    expect(mapJustH(undefined)).toBe(0);
    expect(mapJustH('nonsense')).toBe(0);
  });

  it('maps vAlign strings to JustV codes', () => {
    expect(mapJustV('top')).toBe(JUST_V.top);
    expect(mapJustV('middle')).toBe(JUST_V.middle);
    expect(mapJustV('bottom')).toBe(JUST_V.bottom);
    expect(mapJustV(undefined)).toBe(0);
  });

  it('collapses a code to the anchor alignment used by the rotated path', () => {
    expect(alignClassOf(JUST_H.left)).toBe('left');
    expect(alignClassOf(JUST_H.center)).toBe('center');
    expect(alignClassOf(JUST_H.right)).toBe('right');
    expect(alignClassOf(JUST_H.radix)).toBe('right');
    expect(alignClassOf(JUST_H.justify)).toBe('left');
    expect(alignClassOf(JUST_H.unset)).toBe('left');
  });
});

describe('justifier — line offset', () => {
  it('places left/justify/comb at the origin', () => {
    expect(horizontalOffsetX(JUST_H.left, 100, 40)).toBe(0);
    expect(horizontalOffsetX(JUST_H.justify, 100, 40)).toBe(0);
    expect(horizontalOffsetX(JUST_H.combLeft, 100, 40)).toBe(0);
    expect(horizontalOffsetX(JUST_H.unset, 100, 40)).toBe(0);
  });

  it('splits the slack for center and gives it all to right/radix', () => {
    expect(horizontalOffsetX(JUST_H.center, 100, 40)).toBe(30);
    expect(horizontalOffsetX(JUST_H.right, 100, 40)).toBe(60);
    // code 6 remaps to 3 before the offset switch (jftext:73314)
    expect(horizontalOffsetX(JUST_H.radix, 100, 40)).toBe(60);
  });

  it('never pulls a line back when it already fills the frame', () => {
    expect(horizontalOffsetX(JUST_H.right, 100, 100)).toBe(0);
    expect(horizontalOffsetX(JUST_H.right, 100, 140)).toBe(0);
  });
});

describe('justifier — justify distribution', () => {
  const avail = 30;

  it('ignores codes other than justify/justifyAll', () => {
    expect(justifyLine('aa bb', avail, 5, measure, { code: JUST_H.left })).toBeNull();
    expect(justifyLine('aa bb', avail, 5, measure, { code: JUST_H.center })).toBeNull();
    expect(justifyLine('aa bb', avail, 5, measure, { code: JUST_H.unset })).toBeNull();
  });

  it('leaves the last line of a paragraph left-aligned for code 4', () => {
    expect(
      justifyLine('aa bb', avail, 5, measure, { code: JUST_H.justify, paragraphLast: true })
    ).toBeNull();
    // …but code 5 distributes it (jftext:73394)
    expect(
      justifyLine('aa bb', avail, 5, measure, { code: JUST_H.justifyAll, paragraphLast: true })
    ).not.toBeNull();
  });

  it('does nothing when there is no slack or no gap', () => {
    expect(
      justifyLine('aa bb', avail, 35, measure, { code: JUST_H.justify, paragraphLast: false })
    ).toBeNull();
    expect(
      justifyLine('aa bb', avail, 30, measure, { code: JUST_H.justify, paragraphLast: false })
    ).toBeNull();
    expect(
      justifyLine('aabb', avail, 4, measure, { code: JUST_H.justify, paragraphLast: false })
    ).toBeNull();
  });

  it('distributes slack as slack / gapCount across the words', () => {
    // "aa bb cc" = 8 chars, slack = 22 over 2 gaps → 11 per gap
    const segments = justifyLine('aa bb cc', avail, 8, measure, {
      code: JUST_H.justify,
      paragraphLast: false,
    });
    expect(segments).not.toBeNull();
    expect(segments!.map((s) => s.text)).toEqual(['aa', 'bb', 'cc']);
    expect(segments!.map((s) => s.x)).toEqual([0, 3 + 11, 6 + 22]);
    // last word ends exactly at the frame edge
    const last = segments![2];
    expect(last.x + 2).toBe(avail);
  });

  it('widens only the gaps, keeping the natural word offsets intact', () => {
    const segments = justifyLine('hello world', 40, 11, measure, {
      code: JUST_H.justifyAll,
      paragraphLast: true,
    });
    expect(segments).not.toBeNull();
    const [first, second] = segments!;
    expect(first.text).toBe('hello');
    expect(first.x).toBe(0);
    expect(second.text).toBe('world');
    // natural start (6) + slack (29)
    expect(second.x).toBe(6 + 29);
    expect(second.x + 5).toBe(40);
  });

  it('counts every space-class char, so multi-space gaps widen more', () => {
    // "aa    bb" = 8 chars, slack = 16 - 8 = 8 over 4 spaces → 2 each
    const segments = justifyLine('aa    bb', 16, 8, measure, {
      code: JUST_H.justify,
      paragraphLast: false,
    });
    expect(segments).not.toBeNull();
    expect(segments![0].x).toBe(0);
    expect(segments![1].x).toBe(6 + 4 * 2);
    expect(segments![1].x + 2).toBe(16);
  });
});

describe('justifier — comb cells', () => {
  it('is gated off without a cell count (jftext:73501-73503)', () => {
    expect(combPlacement(JUST_H.combLeft, 100, 0, 4)).toBeNull();
    expect(combPlacement(JUST_H.combLeft, 100, -1, 4)).toBeNull();
  });

  it('centres each cluster in its cell', () => {
    const left = combPlacement(JUST_H.combLeft, 100, 5, 5);
    expect(left).not.toBeNull();
    expect(left!.cell).toBe(20);
    expect(left!.offset).toBe(0);
    expect([0, 1, 2, 3, 4].map((i) => left!.centre(i))).toEqual([10, 30, 50, 70, 90]);
  });

  it('leaves leading cells for center and right', () => {
    const center = combPlacement(JUST_H.combCenter, 100, 5, 3)!;
    expect(center.offset).toBe(1); // (5 - 3) >> 1
    expect([0, 1, 2].map((i) => center.centre(i))).toEqual([30, 50, 70]);

    const right = combPlacement(JUST_H.combRight, 100, 5, 3)!;
    expect(right.offset).toBe(2); // 5 - 3
    expect([0, 1, 2].map((i) => right.centre(i))).toEqual([50, 70, 90]);
  });

  it('never pushes a cluster past the frame edge', () => {
    const right = combPlacement(JUST_H.combRight, 100, 3, 1)!;
    expect(right.offset).toBe(2);
    // centre of the last cell = avail − cell/2 (jftext:73586-73593 caps it)
    expect(right.centre(0)).toBeCloseTo(100 - 100 / 3 / 2, 6);
    expect(right.centre(0)).toBeLessThanOrEqual(100);
  });
});

describe('line-breaker — paragraph ends', () => {
  it('flags the last line of every hard-break paragraph', () => {
    const lines = breakLinesInfo('one two\nthree four\nfive', 1000, measure);
    expect(lines).toEqual([
      { text: 'one two', paragraphEnd: true },
      { text: 'three four', paragraphEnd: true },
      { text: 'five', paragraphEnd: true },
    ]);
  });

  it('flags only the final wrapped line of a long paragraph', () => {
    const lines = breakLinesInfo('aaaa bbbb cccc', 8, measure);
    expect(lines).toEqual([
      { text: 'aaaa', paragraphEnd: false },
      { text: 'bbbb', paragraphEnd: false },
      { text: 'cccc', paragraphEnd: true },
    ]);
  });

  it('keeps breakLines output identical', () => {
    const text = 'aaaa bbbb cccc\nnext paragraph here';
    expect(breakLines(text, 8, measure)).toEqual(
      breakLinesInfo(text, 8, measure).map((l) => l.text)
    );
  });
});
