import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../../src/index';

const FIXTURES = path.join(__dirname, '../../fixtures');
const XDP = fs.readFileSync(path.join(FIXTURES, 'minimal.xdp'), 'utf8');
const XSD = fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8');
const DATA = fs.readFileSync(path.join(FIXTURES, 'minimal-data.xml'), 'utf8');

describe('render — malformed inputs', () => {
  it.each([
    { name: 'truncated XDP', xdp: '<xdp:xdp', xsd: XSD, data: DATA },
    { name: 'malformed XML', xdp: '<not valid xml>>>', xsd: XSD, data: DATA },
    { name: 'empty XDP', xdp: '', xsd: XSD, data: DATA },
    { name: 'malformed XSD', xdp: XDP, xsd: '<xs:schema', data: DATA },
    { name: 'truncated XML data', xdp: XDP, xsd: XSD, data: '<form><name>' },
  ])('returns a failure result for $name', async ({ xdp, xsd, data }) => {
    const result = await render({ xdp, xsd, data });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toEqual(expect.any(String));
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});
