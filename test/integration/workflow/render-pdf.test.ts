import * as fs from 'fs';
import * as path from 'path';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

const FIXTURES = path.join(__dirname, '../../fixtures');

describe('render-pdf workflow (integration)', () => {
  it('renders a minimal PDF from XDP + XSD + XML', async () => {
    const xdp = fs.readFileSync(path.join(FIXTURES, 'minimal.xdp'), 'utf8');
    const xsd = fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8');
    const data = fs.readFileSync(path.join(FIXTURES, 'minimal-data.xml'), 'utf8');

    const result = await renderFormToPdf(xdp, xsd, data);

    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
      return;
    }

    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    // Check PDF magic bytes
    expect(result.data.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('returns structured error when XDP is invalid', async () => {
    const xsd = fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8');
    const data = fs.readFileSync(path.join(FIXTURES, 'minimal-data.xml'), 'utf8');

    const result = await renderFormToPdf('<invalid/>', xsd, data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBeTruthy();
  });

  it('returns structured error when data missing required fields', async () => {
    const xdp = fs.readFileSync(path.join(FIXTURES, 'minimal.xdp'), 'utf8');
    const xsd = fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8');
    const invalidData = fs.readFileSync(
      path.join(FIXTURES, 'invalid/missing-field.xml'),
      'utf8'
    );

    const result = await renderFormToPdf(xdp, xsd, invalidData);
    expect(result.success).toBe(false);
  });
});
