import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from 'pdf-lib';

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

export async function contentStream(pdfBytes: Buffer, pageIndex = 0): Promise<string> {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPage(pageIndex);
  return decodeStream(doc, page.node.Contents()).toString('latin1');
}

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

function resolvedObject(doc: PDFDocument, obj: unknown): unknown {
  let current = obj;
  while (current instanceof PDFRef) current = doc.context.lookup(current);
  return current;
}

function decodeUtf16Hex(raw: string): string {
  const hex = raw.length % 2 === 0 ? raw : `0${raw}`;
  const units: number[] = [];
  for (let i = 0; i + 3 < hex.length; i += 4) {
    units.push(parseInt(hex.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...units);
}

function parseToUnicode(text: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(entry[1], 16), decodeUtf16Hex(entry[2]));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const entry of block[1].matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g
    )) {
      const start = parseInt(entry[1], 16);
      const end = parseInt(entry[2], 16);
      if (entry[3] !== undefined) {
        const base = parseInt(entry[3], 16);
        for (let code = start; code <= end; code++) {
          map.set(code, decodeUtf16Hex((base + code - start).toString(16).padStart(4, '0')));
        }
        continue;
      }
      const values = [...(entry[4] ?? '').matchAll(/<([0-9A-Fa-f]+)>/g)].map((v) =>
        decodeUtf16Hex(v[1])
      );
      for (let i = 0; i < values.length && start + i <= end; i++) map.set(start + i, values[i]);
    }
  }
  return map;
}

function fontMaps(
  doc: PDFDocument,
  page: ReturnType<PDFDocument['getPage']>
): Map<string, Map<number, string>> {
  const maps = new Map<string, Map<number, string>>();
  const resources = resolvedObject(doc, page.node.Resources());
  if (!(resources instanceof PDFDict)) return maps;
  const fonts = resolvedObject(doc, resources.lookup(PDFName.of('Font')));
  if (!(fonts instanceof PDFDict)) return maps;

  for (const name of fonts.keys()) {
    const descriptor = resolvedObject(doc, fonts.lookup(name));
    if (!(descriptor instanceof PDFDict)) continue;
    const toUnicode = resolvedObject(doc, descriptor.get(PDFName.of('ToUnicode')));
    if (!(toUnicode instanceof PDFRawStream)) continue;
    maps.set(name.asString(), parseToUnicode(decodeStream(doc, toUnicode).toString('latin1')));
  }
  return maps;
}

function decodeCidHex(hex: string, map: Map<number, string> | undefined): string {
  if (!map) return hexToString(hex);
  let out = '';
  for (let i = 0; i + 3 < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    out += map.get(code) ?? '';
  }
  return out;
}

export async function pageText(pdfBytes: Buffer, pageIndex = 0): Promise<string> {
  const doc = await PDFDocument.load(pdfBytes);
  const page = doc.getPage(pageIndex);
  const maps = fontMaps(doc, page);
  const content = decodeStream(doc, page.node.Contents()).toString('latin1');
  const out: string[] = [];
  let current: Map<number, string> | undefined;
  const re = /\/([^\s/<>]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|(\((?:\\.|[^\\()])*\))\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match[1] !== undefined) {
      current = maps.get(`/${match[1]}`);
      continue;
    }
    if (match[2] !== undefined) out.push(decodeCidHex(match[2], current));
    else out.push(literalToString(match[3] ?? ''));
  }
  return out.join('\n');
}

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

export function hasGreyFill(content: string, grey: number): boolean {
  return new RegExp(`(^|\\n)${grey} g(\\n|$)`).test(content);
}

export function pathRectCount(content: string): number {
  return content.split('\n').filter((l) => l.trim() === 'h').length;
}
