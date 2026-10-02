import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';

/**
 * G16 — `xfa-namespace-validation.ts` is now enforced by `parseXdp`: supported
 * versions parse cleanly, known-unsupported versions warn (default) or fail
 * (strict).
 */

function xdp(templateNamespace: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="${templateNamespace}">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="0" y="0" w="200mm" h="260mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <field name="Name"><bind match="dataRef" ref="$.Name"/></field>
    </subform>
  </template>
</xdp:xdp>`;
}

describe('G16 — XFA namespace enforcement', () => {
  it('detects the supported version without warnings', () => {
    const result = parseXdp(xdp('http://www.xfa.org/schema/xfa-template/3.3/'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe('3.3');
    expect(result.data.warnings).toBeUndefined();
  });

  it('warns on a known-but-unsupported version by default', () => {
    const result = parseXdp(xdp('http://www.xfa.org/schema/xfa-template/2.6/'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.version).toBe('2.6');
    expect(result.data.warnings?.join(' ')).toContain('not directly supported');
  });

  it('rejects a known-but-unsupported version in strict mode', () => {
    const result = parseXdp(xdp('http://www.xfa.org/schema/xfa-template/2.6/'), { strict: true });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('XDP_UNSUPPORTED_XFA_VERSION');
  });

  it('enforces the maxInputSize cap', () => {
    const result = parseXdp(xdp('http://www.xfa.org/schema/xfa-template/3.3/'), {
      maxInputSize: 10,
    });
    expect(result.success).toBe(false);
  });
});
