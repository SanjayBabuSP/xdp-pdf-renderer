import * as fs from 'fs';
import * as path from 'path';
import { parseXdp } from '../../../src/domain/parsing/parse-xdp';
import { parseXsd } from '../../../src/domain/parsing/parse-xsd';
import { parseXmlData } from '../../../src/domain/parsing/parse-xml-data';

const KIT = path.join(__dirname, '..', '..', '..', 'scripts', 'oracle-kit');

/**
 * Oracle-kit smoke test: the committed synthetic probes must stay parseable
 * (an unparseable probe breaks the company-laptop workflow), and the kit
 * scripts must be present. No rendering here — speed over coverage.
 */
describe('oracle-kit probes', () => {
  const probes = ['p1-metrics', 'p2-borders', 'p3-subforms'];

  it('ships the extractor, compare script and readme', () => {
    for (const f of ['extract-facts.py', 'compare-local.mjs', 'README.md']) {
      expect(fs.existsSync(path.join(KIT, f))).toBe(true);
    }
  });

  for (const name of probes) {
    it(`${name}: xdp+xsd+xml parse cleanly`, () => {
      const xdp = fs.readFileSync(path.join(KIT, 'probes', `${name}.xdp`), 'utf8');
      const xsd = fs.readFileSync(path.join(KIT, 'probes', `${name}.xsd`), 'utf8');
      const xml = fs.readFileSync(path.join(KIT, 'probes', `${name}.xml`), 'utf8');
      const parsed = parseXdp(xdp, { strict: true });
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error(`probe ${name} xdp failed to parse`);
      const schema = parseXsd(xsd);
      expect(schema.success).toBe(true);
      if (!schema.success) throw new Error(`probe ${name} xsd failed to parse`);
      const data = parseXmlData(xml, schema.data);
      expect(data.success).toBe(true);
    });
  }
});
