import { resolveXPath } from '../../../src/lib/xpath-resolver';
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

  it('returns undefined for non-$ prefix', () => {
    expect(resolveXPath('Name', data)).toBeUndefined();
  });

  it('returns undefined when intermediate is null', () => {
    expect(resolveXPath('$.Quotation.Missing.Deep', data)).toBeUndefined();
  });
});
