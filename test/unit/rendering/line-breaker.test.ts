import {
  breakLines,
  LINE_BREAK_TOLERANCE,
} from '../../../src/rendering/text/line-breaker';

/** width = character count (1 unit per char) */
const measure = (s: string): number => s.length;

describe('line-breaker', () => {
  it('exposes the 0.5pt break tolerance (jftext:65339)', () => {
    expect(LINE_BREAK_TOLERANCE).toBe(0.5);
  });

  it('splits on hard line breaks first', () => {
    expect(breakLines('LINE1\nLINE2\nLINE3', 1000, measure)).toEqual([
      'LINE1',
      'LINE2',
      'LINE3',
    ]);
    expect(breakLines('A\r\nB', 1000, measure)).toEqual(['A', 'B']);
  });

  it('wraps at whitespace when the limit is exceeded', () => {
    expect(breakLines('aaaa bbbb cccc', 8, measure)).toEqual([
      'aaaa',
      'bbbb',
      'cccc',
    ]);
    expect(breakLines('aaaa bbbb', 20, measure)).toEqual(['aaaa bbbb']);
  });

  it('allows tolerance overshoot before breaking', () => {
    // 7 chars > maxWidth 6.5 but ≤ 6.5 + 0.5 tolerance → single line
    expect(breakLines('abcdefg', 6.5, measure)).toEqual(['abcdefg']);
    // 8 chars > 7 → splits
    expect(breakLines('abcdefgh', 6.5, measure)).toEqual(['abcdefg', 'h']);
  });

  it('splits a single token that exceeds the limit', () => {
    expect(breakLines('abcdefghijklmnop', 6, measure)).toEqual([
      'abcdef',
      'ghijkl',
      'mnop',
    ]);
  });

  it('does not start a line with closing punctuation (break prohibition)', () => {
    // naive break would put ',' at the start of line 2
    expect(breakLines('aa.,bb', 4, measure)).toEqual(['aa.,', 'bb']);
  });

  it('does not end a line with opening punctuation', () => {
    // naive break would end line 1 with '('
    expect(breakLines('ab(cd', 3, measure)).toEqual(['ab(c', 'd']);
  });

  it('preserves multiple hard-broken paragraphs', () => {
    expect(breakLines('one two\n\nthree', 5, measure)).toEqual([
      'one',
      'two',
      '',
      'three',
    ]);
  });

  it('keeps text as one line when maxWidth <= 0', () => {
    expect(breakLines('a\nb', 0, measure)).toEqual(['a', 'b']);
  });

  it('returns at least one line for empty input', () => {
    expect(breakLines('', 10, measure)).toEqual(['']);
  });
});
