import { validateXdpStructure } from '../../../../src/domain/validation/validate-xdp-structure';
import { LayoutModel, PageDefinition } from '../../../../src/types';

const page = (): PageDefinition => ({
  name: 'Page1',
  medium: { stock: '', short: 0, long: 0 },
  contentArea: { x: 0, y: 0, w: 0, h: 0 },
  masterPageChildren: [],
});

const layout = (pages: PageDefinition[] = [page()], rootSubformName = 'form'): LayoutModel => ({
  rootSubformName,
  pages,
  children: [],
});

describe('validateXdpStructure', () => {
  it('returns the original layout on a valid structure', () => {
    const valid = layout();
    const result = validateXdpStructure(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(valid);
  });

  it('reports a missing rootSubformName', () => {
    const result = validateXdpStructure(layout([page()], ''));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('XDP_1001');
      expect(result.error.message).toBe('Invalid XDP structure');
      expect(result.error.details).toEqual(['Missing rootSubformName']);
    }
  });

  it('reports an empty pages array', () => {
    const result = validateXdpStructure(layout([]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual(['No pages defined']);
    }
  });

  it('reports both a missing root name and empty pages', () => {
    const result = validateXdpStructure(layout([], ''));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual(['Missing rootSubformName', 'No pages defined']);
    }
  });

  it('treats a missing pages property as no pages', () => {
    const malformed: Partial<LayoutModel> = { rootSubformName: 'form', children: [] };
    const result = validateXdpStructure(malformed as LayoutModel);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual(['No pages defined']);
    }
  });

  it('reports a page missing its medium', () => {
    const broken = { ...page() } as Partial<PageDefinition>;
    delete broken.medium;
    const result = validateXdpStructure(layout([broken as PageDefinition]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual(['Page "Page1" missing medium']);
    }
  });

  it('reports a page missing its contentArea', () => {
    const broken = { ...page() } as Partial<PageDefinition>;
    delete broken.contentArea;
    const result = validateXdpStructure(layout([broken as PageDefinition]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual(['Page "Page1" missing contentArea']);
    }
  });

  it('reports all missing properties of a page', () => {
    const broken = { ...page() } as Partial<PageDefinition>;
    delete broken.medium;
    delete broken.contentArea;
    const result = validateXdpStructure(layout([broken as PageDefinition]));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual([
        'Page "Page1" missing medium',
        'Page "Page1" missing contentArea',
      ]);
    }
  });
});
