import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { compile, render } from '../dist/index.js';

const ROOT = path.join(import.meta.dirname, '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const ITERATIONS = 5;

const FORMS = [
  {
    name: 'minimal',
    xdp: path.join(FIXTURES, 'minimal.xdp'),
    xsd: path.join(FIXTURES, 'minimal.xsd'),
    data: path.join(FIXTURES, 'minimal-data.xml'),
  },
  {
    name: 'Example-3',
    xdp: path.join(FIXTURES, 'sample-forms', 'Example-3', 'Example-Datasheet.xdp'),
    xsd: path.join(FIXTURES, 'sample-forms', 'Example-3', 'Example-Schema.xsd'),
    data: path.join(FIXTURES, 'sample-forms', 'Example-3', 'Example-Test-Data.xml'),
  },
];

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)].toFixed(2));
}

async function time(fn) {
  const start = performance.now();
  const result = await fn();
  if (!result.success) throw new Error(result.error.message);
  return performance.now() - start;
}

const results = [];
for (const form of FORMS) {
  const xdp = fs.readFileSync(form.xdp, 'utf8');
  const xsd = fs.readFileSync(form.xsd, 'utf8');
  const data = fs.readFileSync(form.data, 'utf8');
  const renderSamples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    renderSamples.push(await time(() => render({ xdp, xsd, data })));
  }

  const compileStart = performance.now();
  const compiled = compile(xdp, xsd);
  if (!compiled.success) throw new Error(compiled.error.message);
  const compileMs = Number((performance.now() - compileStart).toFixed(2));
  const compiledSamples = [];
  for (let i = 0; i < ITERATIONS; i++) {
    compiledSamples.push(await time(() => compiled.data.render(data)));
  }

  results.push({
    form: form.name,
    iterations: ITERATIONS,
    renderMedianMs: median(renderSamples),
    compileMs,
    compiledRenderMedianMs: median(compiledSamples),
    rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
  });
}

console.log(JSON.stringify(results, null, 2));
