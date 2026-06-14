import { success, failure } from '../../../src/lib/result-type';

describe('result-type', () => {
  describe('success', () => {
    it('returns success result with data', () => {
      const result = success(42);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(42);
    });

    it('works with object data', () => {
      const result = success({ name: 'test', value: 100 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({ name: 'test', value: 100 });
    });

    it('works with null data', () => {
      const result = success(null);
      expect(result.success).toBe(true);
    });
  });

  describe('failure', () => {
    it('returns failure result with error', () => {
      const result = failure('ERR_001', 'Something failed');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('ERR_001');
        expect(result.error.message).toBe('Something failed');
      }
    });

    it('includes details when provided', () => {
      const result = failure('ERR_002', 'Multiple errors', ['field1 missing', 'field2 invalid']);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.details).toEqual(['field1 missing', 'field2 invalid']);
    });

    it('details is undefined when not provided', () => {
      const result = failure('ERR_003', 'No details');
      if (!result.success) expect(result.error.details).toBeUndefined();
    });
  });
});
