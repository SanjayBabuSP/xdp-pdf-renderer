import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { render } from '../dist/index.js';

const ROOT = path.join(import.meta.dirname, '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const ITERATIONS = 5;

const xdp = fs.readFileSync(path.join(FIXTURES, 'minimal.xdp'), 'utf8');
const xsd = fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8');
const data = fs.readFileSync(path.join(FIXTURES, 'minimal-data.xml'), 'utf8');

const samples = [];
for (let i = 0; i < ITERATIONS; i++) {
  const start = performance.now();
  const result = await render({ xdp, xsd, data });
  if (!result.success) throw new Error(result.error.message);
  samples.push(performance.now() - start);
}

samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
      minMs: Number(samples[0].toFixed(2)),
      maxMs: Number(samples[samples.length - 1].toFixed(2)),
      rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
    },
    null,
    2
  )
);
