#!/usr/bin/env node
/**
 * compare-local.mjs — render a company XDP locally and diff it against the
 * Designer "Preview as PDF" output, printing STRUCTURAL NUMBERS ONLY.
 *
 * Privacy: this script never prints text content, metadata values (other than
 * Producer/Creator, which identify the PDF toolchain), or file paths. All
 * intermediates (rendered PDF, facts JSON) go to a temp dir that is deleted
 * on exit. Paste only the printed summary back — never the PDFs, XDP/XSD/XML,
 * or facts files for company forms.
 *
 * Usage:
 *   node scripts/oracle-kit/compare-local.mjs --xdp F --xsd F --data F --expected PDF
 *     [--lenient] [--python python3]
 *
 * Requires: npm install && npm run build, plus python3 with pypdf for the
 * sibling extract-facts.py.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const extractFacts = path.join(here, 'extract-facts.py');

function opt(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  if (name === 'lenient') return true;
  return process.argv[i + 1] ?? fallback;
}

const xdpPath = opt('xdp');
const xsdPath = opt('xsd');
const dataPath = opt('data');
const expectedPdf = opt('expected');
const python = opt('python', process.platform === 'win32' ? 'py' : 'python3');
if (!xdpPath || !xsdPath || !dataPath || !expectedPdf) {
  console.error('usage: node scripts/oracle-kit/compare-local.mjs --xdp F --xsd F --data F --expected PDF [--lenient] [--python PY]');
  process.exit(2);
}

const distEntry = path.join(repoRoot, 'dist', 'workflows', 'render-pdf.js');
if (!fs.existsSync(distEntry)) {
  console.error('dist/ not built. Run: npm install && npm run build');
  process.exit(2);
}

const { renderFormToPdf } = await import(pathToFileURL(distEntry).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-kit-'));
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
process.on('exit', cleanup);

const factsOf = (pdf, tag) => {
  const out = path.join(tmp, `${tag}-facts.json`);
  try {
    execFileSync(python, [extractFacts, pdf, '-o', out], { stdio: 'pipe' });
  } catch {
    console.error(`extract-facts.py failed on ${tag} (needs: ${python} + pypdf).`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(out, 'utf8'));
};

const r = await renderFormToPdf(
  fs.readFileSync(xdpPath, 'utf8'),
  fs.readFileSync(xsdPath, 'utf8'),
  fs.readFileSync(dataPath, 'utf8'),
  { strictValidation: opt('lenient', false) !== true },
);
if (!r.success) {
  console.error(`RENDER FAILED [${r.error.code}] ${r.error.message}`);
  for (const d of r.error.details ?? []) console.error(`  ${d}`);
  process.exit(1);
}
const oursPdf = path.join(tmp, 'ours.pdf');
fs.writeFileSync(oursPdf, r.data);

const ours = factsOf(oursPdf, 'ours');
const exp = factsOf(expectedPdf, 'expected');

const basefonts = (facts) => [...new Set(facts.fonts.map((f) => f.basefont).filter(Boolean))].sort();
const runs = (facts) => facts.pages.map((p) => p.text_runs.length);
const count = (facts, k) => facts.pages.map((p) => (p[k] ?? []).length);
const topOps = (facts, n = 8) => {
  const totals = {};
  for (const p of facts.pages) for (const [op, c] of Object.entries(p.counted ?? {})) totals[op] = (totals[op] ?? 0) + c;
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n).map(([op, c]) => `${op}:${c}`);
};
const tools = (facts) => ({ producer: facts.info?.Producer ?? '?', creator: facts.info?.Creator ?? '?' });

// Numbers and font/toolchain names only — no text content, no paths.
console.log(JSON.stringify({
  pages: { ours: ours.num_pages, expected: exp.num_pages },
  mediabox: { ours: ours.pages[0]?.media_box ?? null, expected: exp.pages[0]?.media_box ?? null },
  toolchain: { ours: tools(ours), expected: tools(exp) },
  basefonts: { ours: basefonts(ours), expected: basefonts(exp) },
  text_runs_per_page: { ours: runs(ours), expected: runs(exp) },
  rects_per_page: { ours: count(ours, 'rectangles'), expected: count(exp, 'rectangles') },
  top_operators: { ours: topOps(ours), expected: topOps(exp) },
}, null, 1));
