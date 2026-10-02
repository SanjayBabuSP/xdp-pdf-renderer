#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Import the XFA locale catalog / picture presets from Designer 11.0.
//
// Source: reference/Adobe-LiveCycle-Designer-11.0/EN/LocalesList.xml
// Output: src/config/xfa-locales.json
//
// Run: npm run locales:import
// ────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SOURCE = path.join(
  root,
  'reference',
  'Adobe-LiveCycle-Designer-11.0',
  'EN',
  'LocalesList.xml',
);
const TARGET = path.join(root, 'src', 'config', 'xfa-locales.json');

if (!fs.existsSync(SOURCE)) {
  console.error(`LocalesList.xml not found at ${SOURCE}`);
  process.exit(1);
}

const toArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'language' || name === 'countryOrRegion' || name === 'custom',
});
const parsed = parser.parse(fs.readFileSync(SOURCE, 'utf8'));
const rootNode = parsed.localeslist ?? {};

const locales = {};
const patterns = {};

for (const language of toArray(rootNode.language)) {
  const languageName = language['@_name'];
  for (const region of toArray(language.countryOrRegion)) {
    const lcid = region['@_lcid'];
    if (!lcid) continue;
    locales[lcid] = { language: languageName, region: region['@_name'] };

    const customs = toArray(region.patterns?.custom).map((c) => ({
      type: c['@_type'] ?? 'text',
      desc: c['@_desc'] ?? '',
      pattern: c['@_pattern'] ?? '',
    }));
    if (customs.length > 0) patterns[lcid] = customs;
  }
}

const globalPatterns = toArray(rootNode.patterns?.custom).map((c) => ({
  type: c['@_type'] ?? 'text',
  desc: c['@_desc'] ?? '',
  pattern: c['@_pattern'] ?? '',
}));

const output = { locales, patterns, globalPatterns };
fs.writeFileSync(TARGET, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Wrote ${TARGET}: ${Object.keys(locales).length} locales, ` +
    `${Object.keys(patterns).length} with custom patterns, ${globalPatterns.length} global patterns`,
);
