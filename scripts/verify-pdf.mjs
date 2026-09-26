#!/usr/bin/env node
/**
 * Oracle verification harness — renders each oracle fixture with the current
 * engine and pixel-diffs the result against Designer's `expected.pdf`.
 *
 * Evidence/plan: reference/IMPLEMENTATION-PLAN.md Phase 0.
 *
 * Usage:
 *   node scripts/verify-pdf.mjs [options] [oracleDir...]
 *
 * Options:
 *   --threshold <pct>   Max per-page pixel diff % to pass (default 1.0)
 *   --dpi <n>           Rasterization DPI (default 150)
 *   --only <name>       Only run oracles whose directory name contains <name>
 *   --render-only       Render actual PDFs but skip diffing (no expected.pdf needed)
 *
 * Oracle directory layout (default search paths: test/final-test, test/oracles/<name>):
 *   <dir>/form.xdp (any *.xdp)  <dir>/*.xsd  <dir>/*.xml  <dir>/expected.pdf
 *
 * Artifacts are written to <dir>/.verify/ (actual.out.pdf, diff-page-N.png).
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}
const threshold = Number(opt('threshold', '1.0'));
const dpi = Number(opt('dpi', '150'));
const only = opt('only', null);
const renderOnly = argv.includes('--render-only');

// positional args = anything not consumed as option keys/values
const consumed = new Set();
for (const key of ['threshold', 'dpi', 'only']) {
  const i = argv.indexOf(`--${key}`);
  if (i >= 0) {
    consumed.add(argv[i]);
    if (i + 1 < argv.length) consumed.add(argv[i + 1]);
  }
}
const dirs = argv.filter((a) => !consumed.has(a) && a !== '--render-only');

// ── locate oracles ───────────────────────────────────────────────────────────
function findOracles() {
  const roots = dirs.length
    ? dirs.map((d) => path.resolve(repoRoot, d))
    : [path.join(repoRoot, 'test', 'final-test'), path.join(repoRoot, 'test', 'oracles')];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stat = fs.statSync(root);
    if (stat.isFile()) continue;
    const hasXdp = fs.readdirSync(root).some((f) => f.toLowerCase().endsWith('.xdp'));
    if (hasXdp) {
      found.push(root);
    } else {
      for (const child of fs.readdirSync(root)) {
        const cp = path.join(root, child);
        if (fs.statSync(cp).isDirectory()) {
          const childFiles = fs.readdirSync(cp);
          if (childFiles.some((f) => f.toLowerCase().endsWith('.xdp'))) found.push(cp);
        }
      }
    }
  }
  return found.filter((d) => !only || path.basename(d).includes(only));
}

function pick(dir, ext) {
  const f = fs.readdirSync(dir).find((n) => n.toLowerCase().endsWith(ext));
  return f ? path.join(dir, f) : null;
}

// ── rasterize ────────────────────────────────────────────────────────────────
async function rasterize(pdfPath, scale) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = path.join(repoRoot, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
  const cmapUrl = path.join(repoRoot, 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep;
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({
    data,
    standardFontDataUrl,
    cMapUrl: cmapUrl,
    cMapPacked: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale });
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
    pages.push({ width: canvas.width, height: canvas.height, png: canvas.toBuffer('image/png') });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

// ── diff ─────────────────────────────────────────────────────────────────────
async function diffPages(aPages, bPages, outDir) {
  const { PNG } = require('pngjs');
  const pixelmatch = require('pixelmatch');
  const results = [];
  const max = Math.max(aPages.length, bPages.length);
  for (let i = 0; i < max; i++) {
    const a = aPages[i];
    const b = bPages[i];
    if (!a || !b) {
      results.push({ page: i + 1, pct: 100, note: `page count mismatch (${aPages.length} vs ${bPages.length})` });
      continue;
    }
    if (a.width !== b.width || a.height !== b.height) {
      // Rescale b onto a's grid by nearest-neighbor before comparing.
      const sa = PNG.sync.read(a.png);
      const sb = PNG.sync.read(b.png);
      const out = new PNG({ width: sa.width, height: sa.height });
      for (let y = 0; y < sa.height; y++) {
        for (let x = 0; x < sa.width; x++) {
          const sx = Math.min(sb.width - 1, Math.floor((x * sb.width) / sa.width));
          const sy = Math.min(sb.height - 1, Math.floor((y * sb.height) / sa.height));
          const si = (sy * sb.width + sx) * 4;
          const di = (y * sa.width + x) * 4;
          out.data[di] = sb.data[si];
          out.data[di + 1] = sb.data[si + 1];
          out.data[di + 2] = sb.data[si + 2];
          out.data[di + 3] = sb.data[si + 3];
        }
      }
      const ia = PNG.sync.read(a.png);
      const diff = new PNG({ width: ia.width, height: ia.height });
      const mismatched = pixelmatch(ia.data, out.data, diff.data, ia.width, ia.height, { threshold: 0.1 });
      const pct = (mismatched / (ia.width * ia.height)) * 100;
      fs.writeFileSync(path.join(outDir, `diff-page-${i + 1}.png`), PNG.sync.write(diff));
      results.push({ page: i + 1, pct, note: 'size mismatch, rescaled' });
      continue;
    }
    const ia = PNG.sync.read(a.png);
    const ib = PNG.sync.read(b.png);
    const diff = new PNG({ width: ia.width, height: ia.height });
    const mismatched = pixelmatch(ia.data, ib.data, diff.data, ia.width, ia.height, { threshold: 0.1 });
    const pct = (mismatched / (ia.width * ia.height)) * 100;
    if (pct > threshold) {
      fs.writeFileSync(path.join(outDir, `diff-page-${i + 1}.png`), PNG.sync.write(diff));
    }
    results.push({ page: i + 1, pct });
  }
  return results;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const oracles = findOracles();
  if (oracles.length === 0) {
    console.log('verify-pdf: no oracle directories found.');
    console.log('  Add fixtures as test/oracles/<name>/{form.xdp,schema.xsd,data.xml,expected.pdf}');
    console.log('  (see reference/IMPLEMENTATION-PLAN.md Phase 0). Nothing to verify — exiting 0.');
    return 0;
  }

  // dist build required
  const distEntry = path.join(repoRoot, 'dist', 'index.js');
  if (!fs.existsSync(distEntry)) {
    console.error('verify-pdf: dist/index.js missing — run `npm run build` first.');
    return 2;
  }
  const { render } = await import(pathToFileURL(distEntry).href);

  let failures = 0;
  const scale = dpi / 72;
  for (const dir of oracles) {
    const name = path.basename(dir);
    const xdp = pick(dir, '.xdp');
    const xsd = pick(dir, '.xsd');
    const xml = pick(dir, '.xml');
    const expected = pick(dir, 'expected.pdf');
    if (!xdp || !xsd || !xml) {
      console.log(`SKIP  ${name}: missing ${!xdp ? '.xdp ' : ''}${!xsd ? '.xsd ' : ''}${!xml ? '.xml' : ''}`);
      continue;
    }
    const outDir = path.join(dir, '.verify');
    fs.mkdirSync(outDir, { recursive: true });

    const result = await render({
      xdp: fs.readFileSync(xdp, 'utf8'),
      xsd: fs.readFileSync(xsd, 'utf8'),
      data: fs.readFileSync(xml, 'utf8'),
    });
    if (!result.success) {
      console.log(`FAIL  ${name}: render error [${result.error.code}] ${result.error.message}`);
      failures++;
      continue;
    }
    const actualPath = path.join(outDir, 'actual.out.pdf');
    fs.writeFileSync(actualPath, result.data);

    if (renderOnly || !expected) {
      console.log(`RENDER ${name}: ${actualPath}${expected ? '' : ' (no expected.pdf — diff skipped)'}`);
      continue;
    }

    try {
      const actualPages = await rasterize(actualPath, scale);
      const expectedPages = await rasterize(expected, scale);
      const results = await diffPages(actualPages, expectedPages, outDir);
      const worst = Math.max(...results.map((r) => r.pct));
      const pass = worst <= threshold;
      if (!pass) failures++;
      const detail = results.map((r) => `p${r.page}=${r.pct.toFixed(2)}%${r.note ? ` (${r.note})` : ''}`).join(' ');
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}: worst ${worst.toFixed(2)}% [${detail}] threshold ${threshold}%`);
    } catch (e) {
      console.log(`FAIL  ${name}: diff error: ${e.message}`);
      failures++;
    }
  }

  console.log(failures ? `\n${failures} oracle(s) failed.` : `\nAll oracles passed (threshold ${threshold}%).`);
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
