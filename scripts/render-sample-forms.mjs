#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMS = path.join(ROOT, 'test', 'fixtures', 'sample-forms');
const RESULTS = path.join(FORMS, 'results');
const require = createRequire(import.meta.url);
const { render } = require(path.join(ROOT, 'dist', 'index.js'));
const { PDFDocument } = require('pdf-lib');

const { forms } = JSON.parse(fs.readFileSync(path.join(FORMS, 'forms.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(FORMS, rel), 'utf8');
fs.mkdirSync(RESULTS, { recursive: true });

let unexpected = 0;
for (const form of forms) {
  const result = await render({ xdp: read(form.xdp), xsd: read(form.xsd), data: read(form.data) });
  if (!result.success) {
    if (!form.knownIssue) unexpected++;
    const label = form.knownIssue ? 'known issue' : 'FAILED';
    console.log(`✗ ${form.name}: ${label} [${result.error.code}] ${result.error.message}`);
    continue;
  }
  const target = path.join(RESULTS, `${form.name}.pdf`);
  fs.writeFileSync(target, result.data);
  const pages = (await PDFDocument.load(result.data)).getPageCount();
  const note = pages === form.expectedPages ? '' : ` (expected ${form.expectedPages})`;
  console.log(`✓ ${form.name}: ${pages} page(s)${note} → ${path.relative(ROOT, target)}`);
}
process.exitCode = unexpected ? 1 : 0;
