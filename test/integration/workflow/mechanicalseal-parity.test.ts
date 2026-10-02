import * as fs from 'fs';
import * as path from 'path';
import { parseXdp } from '../../../src/domain/parsing/parse-xdp';
import { parseXsd } from '../../../src/domain/parsing/parse-xsd';
import { parseXmlData } from '../../../src/domain/parsing/parse-xml-data';
import { resolveBindings } from '../../../src/domain/mapping/resolve-bindings';
import { expandRepeats } from '../../../src/domain/mapping/expand-repeats';
import { resolveXfaEmbeds } from '../../../src/domain/mapping/resolve-embeds';
import { dispatchScripts } from '../../../src/domain/scripting';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import {
  LayoutModel,
  LayoutNode,
  FieldNode,
  DrawNode,
  SubformNode,
} from '../../../src/types';
import {
  contentStream,
  extractText,
  rotatedTextMatrices,
  hasGreyFill,
} from '../../helpers/pdf-content';

const FIXTURES = path.join(__dirname, '../../fixtures/mechanicalseal');

function load(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

function walk(nodes: LayoutNode[], fn: (n: LayoutNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.type === 'subform' || n.type === 'exclGroup') walk(n.children, fn);
  }
}

function findField(layout: LayoutModel, name: string): FieldNode | undefined {
  let found: FieldNode | undefined;
  walk(layout.children, (n) => {
    if (n.type === 'field' && n.name === name) found = n as FieldNode;
  });
  return found;
}

function findDraw(layout: LayoutModel, name: string): DrawNode | undefined {
  let found: DrawNode | undefined;
  walk(layout.children, (n) => {
    if (n.type === 'draw' && n.name === name) found = n as DrawNode;
  });
  return found;
}

function findSubform(layout: LayoutModel, name: string): SubformNode | undefined {
  let found: SubformNode | undefined;
  walk(layout.children, (n) => {
    if (n.type === 'subform' && n.name === name) found = n as SubformNode;
  });
  return found;
}

/** Run parse → bind → expand → scripts → embed resolution. */
function runPreLayout(dataFile: string): {
  layout: LayoutModel;
  errors: string[];
  executed: number;
} {
  const parsed = parseXdp(load('synthetic.xdp'));
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('parseXdp failed');

  const schema = parseXsd(load('synthetic.xsd'));
  expect(schema.success).toBe(true);
  if (!schema.success) throw new Error('parseXsd failed');

  const parsedData = parseXmlData(load(dataFile), schema.data);
  expect(parsedData.success).toBe(true);
  if (!parsedData.success) throw new Error('parseXmlData failed');

  const resolved = resolveBindings(parsed.data, parsedData.data);
  expect(resolved.success).toBe(true);
  if (!resolved.success) throw new Error('resolveBindings failed');
  const expanded = expandRepeats(resolved.data, parsedData.data);
  expect(expanded.success).toBe(true);
  if (!expanded.success) throw new Error('expandRepeats failed');

  const pre = dispatchScripts(expanded.data, parsedData.data as Record<string, unknown>, {});
  expect(pre.success).toBe(true);
  if (!pre.success) throw new Error('dispatchScripts failed');

  resolveXfaEmbeds(pre.data.layout);
  return {
    layout: pre.data.layout,
    errors: (pre.data as unknown as { errorMessages: string[] }).errorMessages,
    executed: pre.data.scriptsExecuted,
  };
}

const rendered = new Map<string, Buffer>();
async function render(dataFile: string, previewMode = false): Promise<Buffer> {
  const key = `${dataFile}:${previewMode}`;
  const cached = rendered.get(key);
  if (cached) return cached;
  const result = await renderFormToPdf(
    load('synthetic.xdp'),
    load('synthetic.xsd'),
    load(dataFile),
    previewMode ? { previewMode: true } : {}
  );
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  rendered.set(key, result.data);
  return result.data;
}

describe('MechanicalSeal synthetic fixture — Adobe parity', () => {
  describe('Issue 1 — assumption twins render as one, not two black boxes', () => {
    it('applies the presence change to the script owner only', () => {
      const { layout, errors, executed } = runPreLayout('synthetic.xml');
      expect(errors).toEqual([]);
      expect(executed).toBeGreaterThanOrEqual(4);

      // MachineLocationIsAssumption is empty → the -Black twin hides.
      expect(findField(layout, 'MachineLocation-Black')?.presence).toBe('hidden');
      // The twin that never ran a script keeps its template presence.
      expect(findField(layout, 'MachineLocation-White')?.presence).toBe('visible');
    });

    it('emits the -White value once and never paints the -Black cell', async () => {
      const stream = await contentStream(await render('synthetic.xml'));
      const text = extractText(stream);

      expect(text).toContain('Machine location (white)');
      expect(text).toContain('Hamburg');
      expect(text.filter((t) => t === 'Hamburg')).toHaveLength(2); // white + density row
      expect(text).not.toContain('Machine location (black)');

      // No opaque full-cell black fill anywhere over the value area.
      expect(/(^|\n)0 g(\n|$)/.test(stream)).toBe(false);
    });
  });

  describe('Issue 2 — initialize-assigned values', () => {
    it('selects the else branch for an empty sibling and shows the OEM data value', () => {
      const { layout, errors } = runPreLayout('synthetic.xml');
      expect(errors).toEqual([]);
      expect(findField(layout, 'oemDisplay')?.resolvedValue).toBe('ITT Bornemann GmbH');
    });

    it('renders the script-derived value', async () => {
      const text = extractText(await contentStream(await render('synthetic.xml')));
      expect(text).toContain('ITT Bornemann GmbH');
    });
  });

  describe('Issue 3 — xfa:embed unit labels', () => {
    it('substitutes the hidden floatingField value into the embedding draw', () => {
      const { layout } = runPreLayout('synthetic.xml');
      const host = findDraw(layout, 'unitHost');
      expect(host?.value?.content).toContain('kg/m3');
      expect(host?.value?.content).not.toContain('xfa:embed');
      // The source field stays hidden: only its embedded appearance is drawn.
      expect(findField(layout, 'unitDensity')?.presence).toBe('hidden');
      expect(findField(layout, 'unitDensity')?.resolvedValue).toBe('kg/m3');
    });

    it('renders the unit', async () => {
      const text = extractText(await contentStream(await render('synthetic.xml')));
      expect(text).toContain('kg/m3');
    });
  });

  describe('Issue 4 — DRAFT watermark', () => {
    it('shows a rotated, light-grey DRAFT when the data carries the preview flag', async () => {
      const { layout } = runPreLayout('synthetic.xml');
      expect(findSubform(layout, 'txtWatermarkSubform')?.presence).toBe('visible');
      expect(findDraw(layout, 'txtWatermark')?.position?.rotate).toBe(30);

      const stream = await contentStream(await render('synthetic.xml'));
      expect(extractText(stream)).toContain('DRAFT');
      expect(rotatedTextMatrices(stream, 30).length).toBeGreaterThan(0);
      expect(hasGreyFill(stream, 0.6)).toBe(true); // 153/255
    });

    it('omits the watermark without the preview flag', async () => {
      const { layout } = runPreLayout('synthetic-no-preview.xml');
      expect(findSubform(layout, 'txtWatermarkSubform')?.presence).toBe('invisible');
      expect(findDraw(layout, 'txtWatermark')?.position?.rotate).toBe(30);

      const stream = await contentStream(await render('synthetic-no-preview.xml'));
      expect(extractText(stream)).not.toContain('DRAFT');
    });

    it('force-shows it in previewMode', async () => {
      const stream = await contentStream(
        await render('synthetic-no-preview.xml', true)
      );
      expect(extractText(stream)).toContain('DRAFT');
      expect(rotatedTextMatrices(stream, 30).length).toBeGreaterThan(0);
    });
  });

  describe('Issue 5 — header logo subtitle', () => {
    it('renders on page 1', async () => {
      const text = extractText(await contentStream(await render('synthetic.xml'), 0));
      expect(text).toContain('a member of EKK and FREUDENBERG');
    });
  });
});
