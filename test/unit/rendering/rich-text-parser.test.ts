import { parseRichText, textRunsToPlainText } from '../../../src/rendering/rich-text-parser';

describe('RichTextParser', () => {
  describe('parseRichText', () => {
    it('returns empty array for empty string', () => {
      expect(parseRichText('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(parseRichText('   ')).toEqual([]);
    });

    it('returns single run for plain text', () => {
      const runs = parseRichText('Hello World');
      expect(runs).toHaveLength(1);
      expect(runs[0].text).toBe('Hello World');
    });

    it('parses bold tags', () => {
      const runs = parseRichText('Hello <b>bold</b> world');
      expect(runs.length).toBeGreaterThanOrEqual(2);
      const boldRun = runs.find((r) => r.bold);
      expect(boldRun).toBeDefined();
      expect(boldRun!.text).toContain('bold');
    });

    it('parses strong tags as bold', () => {
      const runs = parseRichText('<strong>important</strong>');
      const boldRun = runs.find((r) => r.bold);
      expect(boldRun).toBeDefined();
    });

    it('parses italic tags', () => {
      const runs = parseRichText('Hello <i>italic</i> world');
      const italicRun = runs.find((r) => r.italic);
      expect(italicRun).toBeDefined();
      expect(italicRun!.text).toContain('italic');
    });

    it('parses em tags as italic', () => {
      const runs = parseRichText('<em>emphasis</em>');
      const italicRun = runs.find((r) => r.italic);
      expect(italicRun).toBeDefined();
    });

    it('handles br tags as newlines', () => {
      const runs = parseRichText('Line1<br/>Line2');
      const plainText = textRunsToPlainText(runs);
      expect(plainText).toContain('\n');
    });

    it('handles p tags as paragraph breaks', () => {
      const runs = parseRichText('<p>Para1</p><p>Para2</p>');
      const plainText = textRunsToPlainText(runs);
      expect(plainText).toContain('Para1');
      expect(plainText).toContain('Para2');
    });

    it('parses span with font-size style', () => {
      const runs = parseRichText('<span style="font-size:12pt">Big text</span>');
      const sizedRun = runs.find((r) => r.fontSize === 12);
      expect(sizedRun).toBeDefined();
      expect(sizedRun!.text).toContain('Big text');
    });

    it('parses span with color style (rgb)', () => {
      const runs = parseRichText('<span style="color:rgb(255, 0, 0)">Red text</span>');
      const colorRun = runs.find((r) => r.color?.r === 255);
      expect(colorRun).toBeDefined();
      expect(colorRun!.color).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('parses span with color style (hex)', () => {
      const runs = parseRichText('<span style="color:#FF0000">Red text</span>');
      const colorRun = runs.find((r) => r.color?.r === 255);
      expect(colorRun).toBeDefined();
    });

    it('parses span with 3-char hex color', () => {
      const runs = parseRichText('<span style="color:#F00">Red text</span>');
      const colorRun = runs.find((r) => r.color?.r === 255);
      expect(colorRun).toBeDefined();
    });

    it('handles nested formatting', () => {
      const runs = parseRichText('<b><i>bold italic</i></b>');
      const bAndI = runs.find((r) => r.bold && r.italic);
      expect(bAndI).toBeDefined();
    });

    it('decodes HTML entities', () => {
      const runs = parseRichText('A &amp; B &lt; C');
      const plainText = textRunsToPlainText(runs);
      expect(plainText).toContain('A & B < C');
    });

    it('handles pixel font-size (converts to pt)', () => {
      const runs = parseRichText('<span style="font-size:16px">Pixel text</span>');
      const sizedRun = runs.find((r) => r.fontSize != null);
      expect(sizedRun).toBeDefined();
      expect(sizedRun!.fontSize).toBe(12); // 16px * 0.75 = 12pt
    });
  });

  describe('textRunsToPlainText', () => {
    it('concatenates all run texts', () => {
      const result = textRunsToPlainText([
        { text: 'Hello ' },
        { text: 'World', bold: true },
      ]);
      expect(result).toBe('Hello World');
    });

    it('returns empty string for no runs', () => {
      expect(textRunsToPlainText([])).toBe('');
    });
  });
});
