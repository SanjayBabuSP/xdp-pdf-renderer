import { parseRichText, textRunsToPlainText } from '../../../src/rendering/rich-text-parser';
import { resolveXfaEmbedsInHtml } from '../../../src/domain/mapping/resolve-embeds';

const embedLookup = (id: string) =>
  id === 'unit' ? { raw: 'kg/m3', formatted: 'KG/M3' } : undefined;

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

    it('carries a body-level CSS font-size onto every run when XDP has no size', () => {
      const runs = parseRichText('<body style="font-size:12pt"><p>First</p><p>Second</p></body>');
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.every((r) => r.fontSize === 12)).toBe(true);
    });

    it('leaves fontSize unset when no CSS font-size is declared', () => {
      const runs = parseRichText('<p>Plain</p>');
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.every((r) => r.fontSize === undefined)).toBe(true);
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

    it('parses escaped exData markup (XDP stores tags as &lt;…)', () => {
      const runs = parseRichText(
        'Hello &lt;b&gt;bold&lt;/b&gt; and &lt;span style="font-size:16pt"&gt;big&lt;/span&gt;'
      );
      expect(textRunsToPlainText(runs)).toBe('Hello bold and big');
      expect(runs.some((r) => r.bold && r.text === 'bold')).toBe(true);
      expect(runs.find((r) => r.text === 'big')?.fontSize).toBe(16);
    });

    it('handles pixel font-size (converts to pt)', () => {
      const runs = parseRichText('<span style="font-size:16px">Pixel text</span>');
      const sizedRun = runs.find((r) => r.fontSize != null);
      expect(sizedRun).toBeDefined();
      expect(sizedRun!.fontSize).toBe(12);
    });

    it('applies paragraph CSS and restores state after the closing p', () => {
      const runs = parseRichText(
        '<p style="font-weight:bold;text-decoration:underline;font-size:12pt;font-family:\'Arial Narrow\'">Title</p><p>Normal</p>'
      );
      const title = runs.find((r) => r.text === 'Title');
      expect(title?.bold).toBe(true);
      expect(title?.underline).toBe(true);
      expect(title?.fontSize).toBe(12);
      expect(title?.fontFamily).toBe('Arial Narrow');
      const normal = runs.find((r) => r.text === 'Normal');
      expect(normal?.bold).toBeUndefined();
      expect(normal?.underline).toBeUndefined();
      expect(normal?.fontFamily).toBeUndefined();
    });

    it('lets a nested span override paragraph font-weight', () => {
      const runs = parseRichText(
        '<p style="font-weight:bold">A<span style="font-weight:normal">B</span>C</p>'
      );
      expect(runs.find((r) => r.text === 'A')?.bold).toBe(true);
      expect(runs.find((r) => r.text === 'B')?.bold).toBeUndefined();
      expect(runs.find((r) => r.text === 'C')?.bold).toBe(true);
    });

    it('does not leak embed-wrapper bold into the following paragraph', () => {
      const html =
        '<p style="font-weight:bold">Footnote:<span style="font-weight:normal">' +
        '<span xfa:embedMode="raw" xfa:embed="#unit"/></span></p>' +
        '<p style="letter-spacing:0in">Next paragraph</p>';
      const runs = parseRichText(resolveXfaEmbedsInHtml(html, embedLookup));
      expect(runs.find((r) => r.text === 'kg/m3')?.bold).toBeUndefined();
      expect(runs.find((r) => r.text === 'Next paragraph')?.bold).toBeUndefined();
    });

    it('pops unclosed nested spans when the matching block closes', () => {
      const runs = parseRichText(
        '<p style="font-weight:bold">A<span style="font-weight:normal">B</p><p>C</p>'
      );
      expect(runs.find((r) => r.text === 'B')?.bold).toBeUndefined();
      expect(runs.find((r) => r.text === 'C')?.bold).toBeUndefined();
    });

    it('does not pop span state for an unmatched closing p', () => {
      const runs = parseRichText(
        '<span style="color:rgb(255,0,0)"><span style="font-weight:bold">A</p>B</span>C</span>'
      );
      expect(runs.find((r) => r.text === 'B')?.color).toBeUndefined();
      expect(runs.find((r) => r.text === 'B')?.bold).toBeUndefined();
      expect(runs.find((r) => r.text === 'C')?.color).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('ignores closing tags with no matching open', () => {
      const runs = parseRichText(
        '<span style="font-size:12pt">A</b><span style="font-weight:bold">B</span>C</span>'
      );
      expect(runs.find((r) => r.text === 'C')?.fontSize).toBe(12);
    });
  });

  describe('textRunsToPlainText', () => {
    it('concatenates all run texts', () => {
      const result = textRunsToPlainText([{ text: 'Hello ' }, { text: 'World', bold: true }]);
      expect(result).toBe('Hello World');
    });

    it('returns empty string for no runs', () => {
      expect(textRunsToPlainText([])).toBe('');
    });
  });
});
