import type { PDFFont } from 'pdf-lib';
import { breakLines } from '../../../src/rendering/text/line-breaker';
import { layoutRunLines, type StyledRun } from '../../../src/rendering/text/run-flow';

const measure = (s: string): number => s.length;
const fakeFont = {} as PDFFont;

function lineStrings(lines: { segments: { text: string }[] }[]): string[] {
  return lines.map((line) => line.segments.map((segment) => segment.text).join(''));
}

describe('URL break opportunities', () => {
  it('breaks a URL that is alone on a line after a path slash', () => {
    expect(breakLines('www.example.com/abcdef', 16, measure)).toEqual([
      'www.example.com/',
      'abcdef',
    ]);
  });

  it('preserves the slashes of scheme:// when breaking a URL', () => {
    const original = 'https://example.com/path';
    const lines = breakLines(original, 20, measure);
    expect(lines).toEqual(['https://example.com/', 'path']);
    expect(lines.join('')).toBe(original);
    expect(lines.some((line) => line.startsWith('/'))).toBe(false);
  });

  it('does not emit a line ending inside the scheme separator', () => {
    const lines = breakLines('https://example.com', 9, measure);
    expect(lines.join('')).toBe('https://example.com');
    expect(lines.some((line) => line === 'https:/' || line.startsWith('//'))).toBe(false);
  });

  it('breaks at a zero-width space even when the current line is empty', () => {
    expect(breakLines('abcd\u200befgh', 5, measure)).toEqual(['abcd\u200b', 'efgh']);
  });

  it('breaks at a soft hyphen even when the current line is empty', () => {
    expect(breakLines('abcd\u00adefgh', 5, measure)).toEqual(['abcd\u00ad', 'efgh']);
  });
});

describe('URL break opportunities in run flow', () => {
  it('hard-splits a long URL at a path slash', () => {
    const runs: StyledRun[] = [{ text: 'www.example.com/abcdef', size: 10, font: fakeFont }];
    const lines = layoutRunLines(runs, { maxWidth: 16, baseSize: 10, measure });
    expect(lineStrings(lines)).toEqual(['www.example.com/', 'abcdef']);
  });

  it('hard-splits at a zero-width space', () => {
    const runs: StyledRun[] = [{ text: 'abcd\u200befgh', size: 10, font: fakeFont }];
    const lines = layoutRunLines(runs, { maxWidth: 5, baseSize: 10, measure });
    expect(lineStrings(lines)).toEqual(['abcd\u200b', 'efgh']);
  });

  it('hard-splits at a soft hyphen', () => {
    const runs: StyledRun[] = [{ text: 'abcd\u00adefgh', size: 10, font: fakeFont }];
    const lines = layoutRunLines(runs, { maxWidth: 5, baseSize: 10, measure });
    expect(lineStrings(lines)).toEqual(['abcd\u00ad', 'efgh']);
  });

  it('keeps the scheme separator together while hard-splitting a URL', () => {
    const runs: StyledRun[] = [{ text: 'https://example.com/path', size: 10, font: fakeFont }];
    const lines = layoutRunLines(runs, { maxWidth: 20, baseSize: 10, measure });
    expect(lineStrings(lines)).toEqual(['https://', 'example.com/path']);
    expect(lineStrings(lines).join('')).toBe('https://example.com/path');
  });
});
