import { resolveXPath, resolveXPathRelative } from '../../../src/lib/xpath-resolver';
import { DataObject } from '../../../src/types';

describe('xpath-resolver', () => {
  const data: DataObject = {
    Name: 'Acme Corp',
    Quotation: {
      OEM: 'Test OEM',
      LeadID: 42,
    } as DataObject,
    revisionHistory: [
      { revision: 0, date: '2026-05-01', description: 'Initial' } as DataObject,
      { revision: 1, date: '2026-06-01', description: 'Updated' } as DataObject,
    ],
    nested: {
      to_Perf: [
        { Value: '100' } as DataObject,
        { Value: '200' } as DataObject,
      ],
    } as DataObject,
  };

  it('resolves a top-level field', () => {
    expect(resolveXPath('$.Name', data)).toBe('Acme Corp');
  });

  it('resolves a nested field', () => {
    expect(resolveXPath('$.Quotation.OEM', data)).toBe('Test OEM');
  });

  it('resolves a nested numeric field', () => {
    expect(resolveXPath('$.Quotation.LeadID', data)).toBe(42);
  });

  it('resolves array with [*] subscript', () => {
    const result = resolveXPath('$.revisionHistory[*]', data);
    expect(Array.isArray(result)).toBe(true);
    expect((result as DataObject[]).length).toBe(2);
  });

  it('resolves indexed array access [0]', () => {
    const result = resolveXPath('$.revisionHistory[0]', data);
    expect(result).toMatchObject({ revision: 0 });
  });

  it('resolves indexed array access [1]', () => {
    const result = resolveXPath('$.revisionHistory[1]', data);
    expect(result).toMatchObject({ revision: 1 });
  });

  it('returns undefined for missing field', () => {
    expect(resolveXPath('$.NonExistent', data)).toBeUndefined();
  });

  it('accepts bare Designer dataRefs without the $ prefix', () => {
    expect(resolveXPath('Name', data)).toBe('Acme Corp');
    expect(resolveXPath('revisionHistory[0]', data)).toMatchObject({ revision: 0 });
  });

  it('returns undefined when intermediate is null', () => {
    expect(resolveXPath('$.Quotation.Missing.Deep', data)).toBeUndefined();
  });

  describe('repeat-occurrence scope (Adobe LiveCycle row binding)', () => {
    it('resolves $.Records.Amount from a Records[i] scope (same occurrence)', () => {
      const scope = { Amount: '300.000', Unit: 'wlp' } as DataObject;
      expect(resolveXPathRelative('$.Records.Amount', scope)).toBe('300.000');
    });

    it('still prefers the full scoped path when present (no stripping)', () => {
      const scope = { Records: { Amount: 'nested' } } as unknown as DataObject;
      expect(resolveXPathRelative('$.Records.Amount', scope)).toBe('nested');
    });

    it('falls back to undefined (caller tries root) when neither matches', () => {
      const scope = { Other: 'x' } as DataObject;
      expect(resolveXPathRelative('$.Records.Amount', scope)).toBeUndefined();
    });
  });
});
