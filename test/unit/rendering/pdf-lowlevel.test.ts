import { PDFDocument, PDFName } from 'pdf-lib';
import { inflateSync } from 'zlib';
import {
  applyPageTransparencyGroup,
  beginOpacityScope,
  endOpacityScope,
  pageUsesTransparency,
} from '../../../src/rendering/pdf-lowlevel';

function pageContent(page: Awaited<ReturnType<PDFDocument['addPage']>>, doc: PDFDocument): string {
  const contents: any = page.node.Contents();
  const refs: any[] = contents && typeof contents.asArray === 'function' ? contents.asArray() : [contents];
  return refs
    .map((ref: any) => {
      const stream: any = doc.context.lookup(ref);
      const raw: Buffer = Buffer.from(stream.getContents());
      try {
        return inflateSync(raw).toString('latin1');
      } catch {
        return raw.toString('latin1');
      }
    })
    .join('\n');
}

function extGStateEntries(page: any, doc: PDFDocument): Array<[string, string]> {
  const resources = page.node.Resources();
  const dict = resources?.get(PDFName.of('ExtGState'));
  if (!dict) return [];
  return ((dict as any).entries() as Array<[any, any]>).map(([name, value]) => [
    name.toString().replace(/^\//, ''),
    (doc.context.lookup(value) as any).toString(),
  ]);
}

describe('pdf-lowlevel — transparency', () => {
  it('pushes q + ExtGState + Q around an alpha draw', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    const started = beginOpacityScope(page, { fill: 0.5 });
    expect(started).toBe(true);
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    endOpacityScope(page, started);

    const content = pageContent(page, doc);
    expect(content).toMatch(/\bq\b[\s\S]*\/GS0 gs[\s\S]*\bQ\b/);
    expect((content.match(/\bq\b/g) ?? []).length).toBe((content.match(/\bQ\b/g) ?? []).length);
  });

  it('registers /ca for fill and /CA for stroke alpha', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    beginOpacityScope(page, { fill: 0.25 });
    beginOpacityScope(page, { stroke: 0.75 });

    const entries = extGStateEntries(page, doc);
    expect(entries).toHaveLength(2);
    const values = entries.map(([, v]) => v).join('|');
    expect(values).toContain('ca 0.25');
    expect(values).toContain('CA 0.75');
  });

  it('reuses one ExtGState per alpha pair', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    expect(beginOpacityScope(page, { fill: 0.5 })).toBe(true);
    expect(beginOpacityScope(page, { fill: 0.5 })).toBe(true);
    expect(extGStateEntries(page, doc)).toHaveLength(1);
    expect(pageContent(page, doc).match(/\/GS0 gs/g)).toHaveLength(2);
  });

  it('does nothing for opaque requests', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);

    expect(beginOpacityScope(page, {})).toBe(false);
    expect(beginOpacityScope(page, { fill: 1 })).toBe(false);
    expect(beginOpacityScope(page, { stroke: 0 })).toBe(false);
    expect(extGStateEntries(page, doc)).toHaveLength(0);
    expect(pageUsesTransparency(page)).toBe(false);
  });

  it('adds the page transparency group only when alpha was used', async () => {
    const doc = await PDFDocument.create();
    const plain = doc.addPage([200, 200]);
    applyPageTransparencyGroup(plain);
    expect(plain.node.get(PDFName.of('Group'))).toBeUndefined();

    const alpha = doc.addPage([200, 200]);
    beginOpacityScope(alpha, { fill: 0.4 });
    applyPageTransparencyGroup(alpha);
    applyPageTransparencyGroup(alpha); // idempotent
    const group = alpha.node.get(PDFName.of('Group')) as any;
    expect(group).toBeDefined();
    expect(group.get(PDFName.of('S')).toString()).toBe('/Transparency');
    expect(alpha.node.get(PDFName.of('Group'))).toBeDefined();
  });
});
