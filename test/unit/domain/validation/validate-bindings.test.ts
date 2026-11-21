import { validateBindings } from '../../../../src/domain/validation/validate-bindings';
import {
  LayoutModel,
  LayoutNode,
  SchemaModel,
  PageDefinition,
  FieldNode,
  SubformNode,
  ExclGroupNode,
} from '../../../../src/types';

const schema: SchemaModel = {
  rootElement: 'Root',
  schemaAttributes: {},
  fields: {
    Name: { type: 'string', required: true },
    Header: {
      type: 'complex',
      required: true,
      fields: {
        Title: { type: 'string', required: true },
        Id: { type: 'int', required: false },
      },
    },
    Items: {
      type: 'complex',
      required: false,
      repeating: true,
      maxOccurs: -1,
      fields: {
        Sku: { type: 'string', required: true },
      },
    },
  },
};

const field = (bindRef: string, bindMatch: FieldNode['bindMatch'] = 'dataRef'): FieldNode => ({
  type: 'field',
  name: bindRef,
  bindRef,
  bindMatch,
});

const subform = (
  children: LayoutNode[],
  bindRef?: string,
  bindMatch: SubformNode['bindMatch'] = 'dataRef'
): SubformNode => ({
  type: 'subform',
  name: bindRef ?? 'sub',
  children,
  bindRef,
  bindMatch,
});

const exclGroup = (
  children: LayoutNode[],
  bindRef?: string,
  bindMatch: ExclGroupNode['bindMatch'] = 'dataRef'
): ExclGroupNode => ({
  type: 'exclGroup',
  name: 'group',
  children,
  bindRef,
  bindMatch,
});

const page = (masterPageChildren: LayoutNode[] = []): PageDefinition => ({
  name: 'Page1',
  medium: { stock: '', short: 0, long: 0 },
  contentArea: { x: 0, y: 0, w: 0, h: 0 },
  masterPageChildren,
});

const layout = (children: LayoutNode[], masterPageChildren: LayoutNode[] = []): LayoutModel => ({
  rootSubformName: 'form',
  pages: [page(masterPageChildren)],
  children,
});

describe('validateBindings', () => {
  describe('successful bindings', () => {
    it('accepts a field bound to a top-level schema field', () => {
      const result = validateBindings(layout([field('$.Name')]), schema);
      expect(result).toEqual({ success: true, data: undefined });
    });

    it('accepts a field bound to a nested schema field', () => {
      expect(validateBindings(layout([field('$.Header.Title')]), schema).success).toBe(true);
    });

    it('accepts numeric and wildcard array indexes in a bind ref', () => {
      expect(validateBindings(layout([field('$.Items[0].Sku')]), schema).success).toBe(true);
      expect(validateBindings(layout([field('$.Items[*].Sku')]), schema).success).toBe(true);
    });

    it('ignores fields whose bindMatch is not dataRef', () => {
      expect(validateBindings(layout([field('$.Ghost', 'none')]), schema).success).toBe(true);
    });

    it('ignores dataRef fields with no bindRef', () => {
      const noRef: FieldNode = { type: 'field', name: 'empty', bindMatch: 'dataRef' };
      expect(validateBindings(layout([noRef]), schema).success).toBe(true);
    });

    it('resolves a child ref against a repeating subform array context', () => {
      const l = layout([subform([field('$.Sku')], '$.Items[*]')]);
      expect(validateBindings(l, schema).success).toBe(true);
    });
  });

  describe('unresolvable bindings', () => {
    it('reports an unknown bind ref with the VAL_2004 code', () => {
      const result = validateBindings(layout([field('$.Ghost')]), schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VAL_2004');
        expect(result.error.message).toBe('Bind ref does not resolve to schema field');
        expect(result.error.details).toEqual(['Unresolvable bind ref: $.Ghost']);
      }
    });

    it('rejects a ref that does not start with $ dot', () => {
      const result = validateBindings(layout([field('Name')]), schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual(['Unresolvable bind ref: Name']);
      }
    });

    it('collects multiple unresolvable refs', () => {
      const result = validateBindings(
        layout([field('$.FirstGhost'), field('$.SecondGhost')]),
        schema
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual([
          'Unresolvable bind ref: $.FirstGhost',
          'Unresolvable bind ref: $.SecondGhost',
        ]);
      }
    });

    it('reports unresolved refs on master pages with a distinct message', () => {
      const result = validateBindings(layout([], [field('$.Nope')]), schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual(['Unresolvable bind ref in master page: $.Nope']);
      }
    });

    it('reports unresolved refs inside an exclusion group', () => {
      const result = validateBindings(
        layout([exclGroup([field('$.Ghost')], undefined, 'none')]),
        schema
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual(['Unresolvable bind ref: $.Ghost']);
      }
    });

    it('checks the exclusion group own bind ref', () => {
      const result = validateBindings(layout([exclGroup([], '$.Ghost')]), schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual(['Unresolvable bind ref: $.Ghost']);
      }
    });

    it('does not apply array context when the subform ref has no array index', () => {
      const result = validateBindings(layout([subform([field('$.Sku')], '$.Items')]), schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual(['Unresolvable bind ref: $.Sku']);
      }
    });

    it('does not apply array context when the context field is not complex', () => {
      const result = validateBindings(layout([subform([field('$.Sku')], '$.Name[*]')]), schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details).toEqual(['Unresolvable bind ref: $.Sku']);
      }
    });

    it('returns success in lenient mode despite unresolved refs', () => {
      const result = validateBindings(layout([field('$.Ghost')]), schema, { strict: false });
      expect(result).toEqual({ success: true, data: undefined });
    });
  });
});
