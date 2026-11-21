#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createScrambler } from './sanitize-forms/scrambler.mjs';
import { collect, transform, fileKind } from './sanitize-forms/transform.mjs';
import { vocabularyOf } from './sanitize-forms/names.mjs';
import {
  scan,
  leakProblems,
  auditProblems,
  nameLeakProblems,
  nameAuditProblems,
  report,
} from './sanitize-forms/leak-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_IN = path.join(ROOT, 'test', 'final-test');
const DEFAULT_OUT = path.join(ROOT, 'test', 'fixtures', 'sample-forms');
const FORM_FILE = /\.(xdp|xml|xsd)$/i;

const USAGE = `Usage:
  node scripts/sanitize-forms.mjs [--in DIR] [--out DIR] [--terms FILE] [--salt-file FILE]
  node scripts/sanitize-forms.mjs --check [--in DIR] [--out DIR] [--terms FILE]
  node scripts/sanitize-forms.mjs --audit [DIR]
  node scripts/sanitize-forms.mjs --compare [--in DIR] [--out DIR]    (after npm run build)

Defaults: --in test/final-test   --out test/fixtures/sample-forms
          --terms <in>/.sanitize-terms.txt   --salt-file <in>/.sanitize-salt`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { mode: 'sanitize' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) fail(`Missing value for ${arg}`);
      return path.resolve(argv[++i]);
    };
    switch (arg) {
      case '--in':
        opts.in = value();
        break;
      case '--out':
        opts.out = value();
        break;
      case '--terms':
        opts.terms = value();
        break;
      case '--salt-file':
        opts.saltFile = value();
        break;
      case '--check':
      case '--compare':
        opts.mode = arg.slice(2);
        break;
      case '--audit':
        opts.mode = 'audit';
        if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.out = value();
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  opts.in ??= DEFAULT_IN;
  opts.out ??= DEFAULT_OUT;
  opts.terms ??= path.join(opts.in, '.sanitize-terms.txt');
  opts.saltFile ??= path.join(opts.in, '.sanitize-salt');
  return opts;
}

const display = (p) => path.relative(ROOT, p) || '.';

function listForms(dir, skip) {
  const found = [];
  const visit = (abs) => {
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(abs, entry.name);
      if (entry.name.startsWith('.') || full === skip) continue;
      if (entry.isDirectory()) visit(full);
      else if (FORM_FILE.test(entry.name)) found.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  visit(dir);
  return found;
}

function readSalt(file, create) {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  if (create) fs.writeFileSync(file, `${salt}\n`, { mode: 0o600 });
  return salt;
}

function readTerms(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sanitize(files, salt, terms) {
  const known = collect(files);
  const scrambler = createScrambler({
    salt,
    controlValues: known.controlValues,
    controlNumbers: known.controlNumbers,
  });
  const ctx = {
    scrambler,
    typeMap: known.typeMap,
    vocab: known.vocab,
    names: known.names,
    fileNames: new Set(files.map((file) => path.basename(file.rel))),
    termPatterns: [...terms].sort((a, b) => b.length - a.length).map((t) => new RegExp(escapeRegExp(t), 'giu')),
    originalImageHashes: new Set(),
    stats: {},
  };
  const outputs = new Map();
  const stats = new Map();
  for (const file of files) {
    ctx.stats = {};
    outputs.set(file.rel, transform(file, ctx));
    stats.set(file.rel, ctx.stats);
  }
  return {
    outputs,
    stats,
    known: {
      ...known,
      renamedNames: known.names.renamed,
      replacedValues: scrambler.replacedValues,
      replacedWords: new Set([...scrambler.replacedWords, ...known.names.renamedWords]),
      originalImageHashes: ctx.originalImageHashes,
      terms,
    },
  };
}

function privacyProblems(outputs, known) {
  const files = [...outputs].map(([rel, text]) => ({ rel, kind: fileKind(rel), text }));
  const genericWords = vocabularyOf(files);
  return files.flatMap((file) => {
    const scanned = scan(file.text);
    return [
      ...leakProblems(file.rel, scanned, known),
      ...nameLeakProblems(file, known.renamedNames),
      ...auditProblems(file.rel, scanned),
      ...nameAuditProblems(file, genericWords),
    ];
  });
}

function readForms(dir, rels) {
  return rels.map((rel) => ({ rel, kind: fileKind(rel), text: fs.readFileSync(path.join(dir, rel), 'utf8') }));
}

function runAudit(opts) {
  if (!fs.existsSync(opts.out)) fail(`Folder not found: ${display(opts.out)}`);
  const files = readForms(opts.out, listForms(opts.out));
  const genericWords = vocabularyOf(files);
  const problems = files.flatMap((file) => [
    ...auditProblems(file.rel, scan(file.text)),
    ...nameAuditProblems(file, genericWords),
  ]);
  if (problems.length) {
    report(problems);
    return 1;
  }
  console.log(`Audit passed: ${files.length} file(s) in ${display(opts.out)}`);
  return 0;
}

function runCheck(opts, files, terms) {
  const { known } = sanitize(files, readSalt(opts.saltFile, false), terms);
  const outputs = new Map();
  for (const { rel } of files) {
    const target = path.join(opts.out, rel);
    if (fs.existsSync(target)) outputs.set(rel, fs.readFileSync(target, 'utf8'));
  }
  const problems = privacyProblems(outputs, known);
  if (problems.length) {
    report(problems);
    return 1;
  }
  console.log(`Leak check passed: ${outputs.size} file(s) in ${display(opts.out)}`);
  return 0;
}

function runSanitize(opts, files, terms) {
  const { outputs, stats, known } = sanitize(files, readSalt(opts.saltFile, true), terms);
  const problems = privacyProblems(outputs, known);
  if (problems.length) {
    report(problems);
    console.error('Nothing was written.');
    return 1;
  }
  console.log(`Sanitized ${outputs.size} file(s) → ${display(opts.out)}`);
  for (const file of files) {
    const text = outputs.get(file.rel);
    const target = path.join(opts.out, file.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    const kb = (s) => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
    const counts = Object.entries(stats.get(file.rel)).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`  ${file.rel.padEnd(48)} ${kb(file.text).padStart(8)} → ${kb(text).padStart(8)}  ${counts}`);
  }
  console.log(
    `Leak check passed (${known.renamedNames.size} names, ${known.replacedValues.size} values, ${known.replacedWords.size} words, ${known.originalImageHashes.size} images checked).`
  );
  return 0;
}

async function pdfFacts(bytes) {
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } = (await import('pdf-lib')).default;
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const decode = (obj) => {
    if (obj instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1');
    if (obj instanceof PDFArray) return obj.asArray().map((ref) => decode(doc.context.lookup(ref))).join('\n');
    return '';
  };
  let images = 0;
  const fonts = new Set();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj?.dict;
    if (!(dict instanceof PDFDict)) continue;
    const subtype = dict.get(PDFName.of('Subtype'))?.toString();
    if (subtype === '/Image') images++;
    const base = dict.get(PDFName.of('BaseFont'))?.toString();
    if (base && subtype !== '/CIDFontType2') fonts.add(base.replace(/^\/([A-Z]{6}\+)?/, '').replace(/-\d+$/, ''));
  }
  return {
    pages: pages.length,
    sizes: [...new Set(pages.map((p) => p.getSize()).map((s) => `${Math.round(s.width)}x${Math.round(s.height)}`))].join(','),
    images,
    fonts: [...fonts].sort().join(','),
    textRuns: pages.map((p) => (decode(p.node.Contents()).match(/\bT[jJ]\b/g) ?? []).length).join('/'),
  };
}

async function runCompare(opts) {
  const manifest = path.join(opts.out, 'forms.json');
  const dist = path.join(ROOT, 'dist', 'index.js');
  if (!fs.existsSync(manifest)) fail(`Missing ${display(manifest)}`);
  if (!fs.existsSync(dist)) fail('Missing dist/ — run `npm run build` first.');
  const lib = await import(pathToFileURL(dist).href);
  const render = lib.render ?? lib.default.render;
  const { forms } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  let mismatches = 0;
  for (const form of forms) {
    const facts = {};
    for (const [label, dir] of [['original', opts.in], ['sanitized', opts.out]]) {
      const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
      let warnings = 0;
      const result = await render({
        xdp: read(form.xdp),
        xsd: read(form.xsd),
        data: read(form.data),
        options: { onWarning: () => warnings++ },
      });
      facts[label] = result.success ? { ...(await pdfFacts(result.data)), warnings } : { error: result.error.code };
    }
    const { original: a, sanitized: b } = facts;
    const same = a.pages === b.pages && a.sizes === b.sizes && a.images === b.images && a.fonts === b.fonts;
    if (!same) mismatches++;
    console.log(`${same ? 'OK  ' : 'DIFF'} ${form.name}`);
    for (const key of ['error', 'pages', 'sizes', 'images', 'fonts', 'warnings', 'textRuns']) {
      if (a[key] !== undefined || b[key] !== undefined) {
        console.log(`       ${key.padEnd(9)} ${String(a[key]).padEnd(30)} ${String(b[key])}`);
      }
    }
  }
  return mismatches ? 1 : 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'audit') return runAudit(opts);
  if (!fs.existsSync(opts.in)) fail(`Input folder not found: ${display(opts.in)}`);
  if (opts.mode === 'compare') return runCompare(opts);
  const rels = listForms(opts.in, opts.out);
  if (!rels.length) fail(`No .xdp/.xml/.xsd files in ${display(opts.in)}`);
  const files = readForms(opts.in, rels);
  const terms = readTerms(opts.terms);
  return opts.mode === 'check' ? runCheck(opts, files, terms) : runSanitize(opts, files, terms);
}

process.exitCode = await main();
