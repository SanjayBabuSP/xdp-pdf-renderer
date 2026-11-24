import * as fs from 'fs';
import * as path from 'path';
import { compile, render } from '../../../src/index';
import { pageText } from '../../helpers/pdf-content';

const FIXTURES = path.join(__dirname, '../../fixtures');

function fixture(name: 'minimal' | 'invoice'): { xdp: string; xsd: string; data: string } {
  const prefix = path.join(FIXTURES, name);
  return {
    xdp: fs.readFileSync(`${prefix}.xdp`, 'utf8'),
    xsd: fs.readFileSync(`${prefix}.xsd`, 'utf8'),
    data: fs.readFileSync(`${prefix}-data.xml`, 'utf8'),
  };
}

function bytes(result: { success: true; data: Uint8Array } | { success: false }): Uint8Array {
  if (!result.success) throw new Error('expected a successful render');
  return result.data;
}

describe('compile()', () => {
  it.each(['minimal', 'invoice'] as const)(
    'renders the %s template identically to render()',
    async (name) => {
      const input = fixture(name);
      const compiled = compile(input.xdp, input.xsd);
      expect(compiled.success).toBe(true);
      if (!compiled.success) throw new Error(compiled.error.message);

      const direct = await render(input);
      const fromTemplate = await compiled.data.render(input.data);

      expect(await pageText(Buffer.from(bytes(fromTemplate)))).toBe(
        await pageText(Buffer.from(bytes(direct)))
      );
    }
  );

  it('reuses the parsed template without leaking data between renders', async () => {
    const input = fixture('minimal');
    const compiled = compile(input.xdp, input.xsd);
    expect(compiled.success).toBe(true);
    if (!compiled.success) throw new Error(compiled.error.message);

    const secondData = input.data.replace('Test Document', 'Second Document');
    const first = await compiled.data.render(input.data);
    const second = await compiled.data.render(secondData);
    const freshSecond = await render({ ...input, data: secondData });

    const firstText = await pageText(Buffer.from(bytes(first)));
    const secondText = await pageText(Buffer.from(bytes(second)));
    const freshSecondText = await pageText(Buffer.from(bytes(freshSecond)));

    expect(firstText).not.toBe(secondText);
    expect(secondText).toBe(freshSecondText);
  });

  it('lets render-time options override compile-time defaults', async () => {
    const input = fixture('minimal');
    const compiled = compile(input.xdp, input.xsd, { locale: 'de-DE' });
    expect(compiled.success).toBe(true);
    if (!compiled.success) throw new Error(compiled.error.message);

    const result = await compiled.data.render(input.data, { locale: 'en-US' });
    expect(result.success).toBe(true);
  });

  it('returns a failure result for invalid templates', () => {
    const input = fixture('minimal');
    const result = compile('<invalid/>', input.xsd);
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error.code).toBe('XDP_1001');
  });
});
