import { dispatchPostLayoutScripts } from '../../../../src/domain/scripting';
import { FieldNode, SubformNode, PaginatedLayout, LayoutNode } from '../../../../src/types';

/**
 * G4 — `xfa.layout.*`: page-number/page-count queries used by Designer's
 * auto-generated page-number scripts (`xfa.layout.page(this)`,
 * `xfa.layout.pageCount()` — reference/decompiled ConvertIP.exe_disasm.c:73871).
 */

function scriptedField(name: string, script: string): FieldNode {
  return {
    type: 'field',
    name,
    presence: 'visible',
    events: [
      {
        name: 'docReady',
        activity: 'docReady',
        script,
        contentType: 'application/x-javascript',
      },
    ],
  };
}

function pageSubform(name: string, children: LayoutNode[]): SubformNode {
  return { type: 'subform', name, layout: 'tb', presence: 'visible', children };
}

const MEDIUM = { stock: 'a4', short: 595.28, long: 841.89 };
const CONTENT = { x: 0, y: 0, w: 595.28, h: 841.89 };

function twoPageLayout(p1: LayoutNode[], p2: LayoutNode[]): PaginatedLayout {
  return {
    rootSubformName: 'value',
    rootEvents: [],
    pages: [
      { pageIndex: 0, medium: MEDIUM, contentArea: CONTENT, masterPageChildren: [], children: p1 },
      { pageIndex: 1, medium: MEDIUM, contentArea: CONTENT, masterPageChildren: [], children: p2 },
    ],
  };
}

function findField(nodes: LayoutNode[], name: string): FieldNode | undefined {
  for (const node of nodes) {
    if (node.type === 'field' && node.name === name) return node;
    if (node.type === 'subform' || node.type === 'exclGroup') {
      const found = findField(node.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

describe('G4 — xfa.layout page queries', () => {
  it('reports the page a node lives on', () => {
    const layout = twoPageLayout(
      [pageSubform('p1', [scriptedField('first', '$.rawValue = xfa.layout.page(this);')])],
      [pageSubform('p2', [scriptedField('second', '$.rawValue = xfa.layout.page(this);')])],
    );
    const result = dispatchPostLayoutScripts(layout, {});
    expect(result.success).toBe(true);

    expect(findField(layout.pages[0].children, 'first')?.resolvedValue).toBe(1);
    expect(findField(layout.pages[1].children, 'second')?.resolvedValue).toBe(2);
  });

  it('reports the total page count', () => {
    const layout = twoPageLayout(
      [pageSubform('p1', [scriptedField('total', '$.rawValue = xfa.layout.pageCount();')])],
      [],
    );
    dispatchPostLayoutScripts(layout, {});
    expect(findField(layout.pages[0].children, 'total')?.resolvedValue).toBe(2);
  });

  it('reports per-page content counts and readiness', () => {
    const layout = twoPageLayout(
      [
        pageSubform('p1', [
          scriptedField(
            'stats',
            '$.rawValue = xfa.layout.pageContent(1) + ":" + xfa.layout.ready;',
          ),
        ]),
      ],
      [pageSubform('p2', [scriptedField('a', ''), scriptedField('b', '')])],
    );
    dispatchPostLayoutScripts(layout, {});
    expect(findField(layout.pages[0].children, 'stats')?.resolvedValue).toBe('2:true');
  });
});
