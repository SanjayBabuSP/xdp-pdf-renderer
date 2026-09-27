import * as fs from 'fs';
import * as path from 'path';
import { parseXdp } from '../../../src/domain/parsing/parse-xdp';
import { parseXsd } from '../../../src/domain/parsing/parse-xsd';
import { parseXmlData } from '../../../src/domain/parsing/parse-xml-data';
import { resolveBindings } from '../../../src/domain/mapping/resolve-bindings';
import { expandRepeats } from '../../../src/domain/mapping/expand-repeats';
import { evaluateConditions } from '../../../src/domain/mapping/evaluate-conditions';
import { applyTableLayouts } from '../../../src/domain/layout/calculate-table-layout';
import { calculatePositions } from '../../../src/domain/layout/calculate-positions';
import { applyPagination } from '../../../src/domain/layout/apply-pagination';
import {
  dispatchScripts,
  dispatchPostLayoutScripts,
} from '../../../src/domain/scripting';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { FieldNode } from '../../../src/types';

const FIXTURES = path.join(__dirname, '../../fixtures/lifecycle');

function loadFixtures(): { xdp: string; xsd: string; data: string } {
  return {
    xdp: fs.readFileSync(path.join(FIXTURES, 'form.xdp'), 'utf8'),
    xsd: fs.readFileSync(path.join(FIXTURES, 'schema.xsd'), 'utf8'),
    data: fs.readFileSync(path.join(FIXTURES, 'data.xml'), 'utf8'),
  };
}

function stageField(layout: unknown): FieldNode | undefined {
  const l = layout as {
    children?: unknown[];
    pages?: { children?: unknown[] }[];
  };
  const containers = [...(l.children ?? []), ...(l.pages?.[0]?.children ?? [])];
  for (const container of containers) {
    const children = (container as { children?: unknown[] }).children ?? [];
    const field = children.find(
      (c) => (c as FieldNode).type === 'field' && (c as FieldNode).name === 'stage'
    );
    if (field) return field as FieldNode;
  }
  return undefined;
}

describe('XFA script lifecycle order (Phase 1)', () => {
  it('executes ready → initialize → calculate → validate → overlay → ready($layout) → docReady in order', () => {
    const { xdp, xsd, data } = loadFixtures();

    const parsed = parseXdp(xdp);
    const schema = parseXsd(xsd);
    expect(parsed.success).toBe(true);
    expect(schema.success).toBe(true);
    if (!parsed.success || !schema.success) return;

    const parsedData = parseXmlData(data, schema.data);
    expect(parsedData.success).toBe(true);
    if (!parsedData.success) return;

    const resolved = resolveBindings(parsed.data, parsedData.data);
    expect(resolved.success).toBe(true);
    if (!resolved.success) return;

    const expanded = expandRepeats(resolved.data, parsedData.data);
    expect(expanded.success).toBe(true);
    if (!expanded.success) return;

    const preLayout = dispatchScripts(expanded.data, parsedData.data, {
      strictMode: true,
    });
    expect(preLayout.success).toBe(true);
    if (!preLayout.success) return;
    expect(preLayout.data.scriptErrors).toBe(0);
    // ready(A) + initialize(B) + calculate(C, executed exactly once despite
    // reading its own output) + validate(D) + overlay(E) + ready($layout)(F)
    expect(preLayout.data.scriptsExecuted).toBe(6);
    expect(stageField(preLayout.data.layout)?.resolvedValue).toBe('SABCDEF');

    const conditions = evaluateConditions(preLayout.data.layout);
    expect(conditions.success).toBe(true);
    if (!conditions.success) return;

    const tables = applyTableLayouts(conditions.data, 487);
    expect(tables.success).toBe(true);
    if (!tables.success) return;

    const positioned = calculatePositions(tables.data);
    expect(positioned.success).toBe(true);
    if (!positioned.success) return;

    const paginated = applyPagination(positioned.data, undefined);
    expect(paginated.success).toBe(true);
    if (!paginated.success) return;

    const postLayout = dispatchPostLayoutScripts(paginated.data, parsedData.data, {
      strictMode: true,
    });
    expect(postLayout.success).toBe(true);
    if (!postLayout.success) return;
    expect(postLayout.data.scriptErrors).toBe(0);
    expect(stageField(postLayout.data.layout)?.resolvedValue).toBe('SABCDEFG');
  });

  it('renders the lifecycle fixture to a PDF', async () => {
    const { xdp, xsd, data } = loadFixtures();
    const result = await renderFormToPdf(xdp, xsd, data);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.slice(0, 5).toString()).toBe('%PDF-');
  });
});
