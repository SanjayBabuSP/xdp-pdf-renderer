import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/**
 * Minimal content-stream inspection helpers.
 *
 * The environment has no PDF rasterizer, so parity checks are made against the
 * operators pdf-lib emits: decoded text runs, fill colours, and text matrices
 * (which carry rotation).
 */

function decodeStream(doc: PDFDocument, obj: unknown): Buffer {
  if (obj instanceof PDFRawStream) {
    return Buffer.from(decodePDFRawStream(obj).decode());
  }
  if (obj instanceof PDFArray) {
    const parts: Buffer[] = [];
    for (let i = 0; i < obj.size(); i++) {
      const el = doc.context.lookup(obj.get(i));
      if (el instanceof PDFRawStream) {
        parts.push(Buffer.from(decodePDFRawStream(el).decode()));
      }
    }
    return Buffer.concat(parts);
  }
  return Buffer.alloc(0);
}

/** Decoded content stream of one page, as a latin1 string. */
export async function contentStream(pdfBytes: Buffer, pageIndex = 0): Promise<string> {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPage(pageIndex);
  return decodeStream(doc, page.node.Contents()).toString('latin1');
}

/** Extract every shown text string from a content stream, in draw order. */
export function extractText(content: string): string[] {
  const out: string[] = [];
  const re = /<([0-9A-Fa-f]+)>\s*Tj|\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push(m[1] !== undefined ? hexToString(m[1]) : literalToString(m[2] ?? ''));
  }
  return out;
}

function hexToString(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString('latin1');
}

function literalToString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') {
      out += raw[i];
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      let oct = next;
      while (
        oct.length < 3 &&
        raw[i + 1] !== undefined &&
        raw[i + 1]! >= '0' &&
        raw[i + 1]! <= '7'
      ) {
        oct += raw[++i];
      }
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
    out += map[next] ?? next;
  }
  return out;
}

/** All text shown on a page, one run per line. */
export async function pageText(pdfBytes: Buffer, pageIndex = 0): Promise<string> {
  return extractText(await contentStream(pdfBytes, pageIndex)).join('\n');
}

/**
 * Text matrices (`a b c d e f Tm`) whose linear part matches a rotation of
 * roughly `degrees`, in either direction.
 */
export function rotatedTextMatrices(content: string, degrees: number): string[] {
  const rad = (Math.abs(degrees) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const re = /([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm/g;
  const hits: string[] = [];
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const [a, b, c, d] = m.slice(1, 5).map(Number);
    if (
      (close(a, cos) && close(b, sin) && close(c, -sin) && close(d, cos)) ||
      (close(a, cos) && close(b, -sin) && close(c, sin) && close(d, cos))
    ) {
      hits.push(m[0]);
    }
  }
  return hits;
}

/** True when a `N g` (grey fill) operator with that exact value is present. */
export function hasGreyFill(content: string, grey: number): boolean {
  return new RegExp(`(^|\\n)${grey} g(\\n|$)`).test(content);
}

/**
 * Number of closed path regions (`closepath` operator `h`) in the stream.
 *
 * pdf-lib emits filled rectangles as `m/l/h/f` path segments rather than the
 * `re` shorthand, so barcode bars must be counted with `h`.
 */
export function pathRectCount(content: string): number {
  return content.split('\n').filter((l) => l.trim() === 'h').length;
}
