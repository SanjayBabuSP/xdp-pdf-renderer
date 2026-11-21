import {
  validateXfaNamespaces,
  validateNamespacePrefixes,
  getVersionFeatures,
} from '../../../src/adobe/xfa-namespace-validation';

describe('G16 — XFA namespace validation', () => {
  it('accepts supported template namespaces', () => {
    for (const version of ['2.8', '3.3', '3.6']) {
      const result = validateXfaNamespaces({
        template: `http://www.xfa.org/schema/xfa-template/${version}/`,
      });

      expect(result).toEqual({
        valid: true,
        detectedVersion: version,
        warnings: [],
        errors: [],
        backwardCompat: false,
      });
    }
  });

  it('rejects unsupported namespaces in strict mode', () => {
    const result = validateXfaNamespaces(
      { t: 'http://www.xfa.org/schema/xfa-template/3.5/' },
      true
    );

    expect(result.valid).toBe(false);
    expect(result.detectedVersion).toBe('3.5');
    expect(result.backwardCompat).toBe(false);
    expect(result.errors).toEqual([
      'XFA template namespace 3.5 is not directly supported. Supported versions: 2.8, 3.3, 3.6',
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('warns about backward-compatible parsing outside strict mode', () => {
    const result = validateXfaNamespaces({ t: 'http://www.xfa.org/schema/xfa-template/2.4/' });

    expect(result.valid).toBe(true);
    expect(result.detectedVersion).toBe('2.4');
    expect(result.backwardCompat).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      'XFA template namespace 2.4 is not directly supported. Attempting backward-compatible parsing. Some features may not work correctly.',
    ]);
  });

  it('assumes 3.3 when no template namespace is declared', () => {
    const result = validateXfaNamespaces({ xdp: 'http://ns.adobe.com/xdp/' });

    expect(result).toEqual({
      valid: true,
      detectedVersion: '3.3',
      warnings: ['No XFA template namespace found — assuming XFA 3.3'],
      errors: [],
      backwardCompat: false,
    });
  });

  it('flags unknown template namespaces', () => {
    const result = validateXfaNamespaces({ t: 'http://www.xfa.org/schema/xfa-template/9.9/' });

    expect(result.valid).toBe(true);
    expect(result.detectedVersion).toBe('3.3');
    expect(result.backwardCompat).toBe(false);
    expect(result.warnings).toEqual([
      'Unknown XFA template namespace: http://www.xfa.org/schema/xfa-template/9.9/. Attempting to parse as XFA 3.3.',
    ]);
  });

  it('validates prefix URIs and detects the xpatemplate misspelling', () => {
    expect(validateNamespacePrefixes({ x: 'http://example.com', y: 'urn:example' })).toEqual([]);
    expect(validateNamespacePrefixes({ x: 'example' })).toEqual([
      "Warning: Namespace prefix 'x' has non-standard URI",
    ]);
    expect(validateNamespacePrefixes({ x: 'example' }, true)).toEqual([
      "Namespace prefix 'x' has non-standard URI: example",
    ]);
    expect(validateNamespacePrefixes({ xpatemplate: 'http://example.com' })).toEqual([
      "Possible misspelled namespace prefix: 'xpatemplate'. Did you mean 'xfa-templates'?",
    ]);
  });

  it('gates version-specific features', () => {
    const early = getVersionFeatures('2.7');
    const middle = getVersionFeatures('3.3');
    const latest = getVersionFeatures('3.6');

    expect(early.field).toBe(true);
    expect(early['subform.layout.table']).toBe(true);
    expect(early['layout.position']).toBe(false);
    expect(early.assist).toBe(false);
    expect(getVersionFeatures('2.8')['layout.position']).toBe(true);
    expect(middle.assist).toBe(true);
    expect(middle['layout.tbrl']).toBe(false);
    expect(latest['layout.tbrl']).toBe(true);
    expect(latest['script.runAt.docReady']).toBe(true);
    expect(latest['pdf.enhanced']).toBe(true);
    expect(latest['field.access.enhanced']).toBe(true);
    expect(latest['script.runAt.pageOpen']).toBe(true);
  });
});
