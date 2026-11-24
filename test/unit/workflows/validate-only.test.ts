import * as fs from 'fs';
import * as path from 'path';
import { validate } from '../../../src/index';
import * as pdfRenderer from '../../../src/rendering/pdf-renderer';

const FIXTURES = path.join(__dirname, '../../fixtures');

function minimalFixture(): { xdp: string; xsd: string; data: string } {
  return {
    xdp: fs.readFileSync(path.join(FIXTURES, 'minimal.xdp'), 'utf8'),
    xsd: fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8'),
    data: fs.readFileSync(path.join(FIXTURES, 'minimal-data.xml'), 'utf8'),
  };
}

describe('validate()', () => {
  it('stops before PDF generation', async () => {
    const fixture = minimalFixture();
    const spy = jest.spyOn(pdfRenderer, 'renderPdfWithDoc').mockImplementation(() => {
      throw new Error('PDF generation stage must not run');
    });

    try {
      const result = await validate(fixture);
      expect(result.success).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('reports invalid template input without generating a PDF', async () => {
    const fixture = minimalFixture();
    const spy = jest.spyOn(pdfRenderer, 'renderPdfWithDoc');

    try {
      const result = await validate({ ...fixture, xdp: '<invalid/>' });
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.code).toBe('XDP_1001');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('honours strict validation before layout', async () => {
    const fixture = minimalFixture();
    const strict = await validate({
      ...fixture,
      data: fixture.data.replace('<name>', '<missing>').replace('</name>', '</missing>'),
      options: { strictValidation: true },
    });

    expect(strict.success).toBe(false);
    if (strict.success) throw new Error('expected failure');
    expect(strict.error.code).toBe('VAL_2001');
  });
});
