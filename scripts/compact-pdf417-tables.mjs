import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const source = path.join(root, 'src', 'config', 'pdf417-tables.json');
const compact = path.join(root, 'src', 'config', 'pdf417-tables.compact.json');
const built = path.join(root, 'dist', 'config', 'pdf417-tables.compact.json');
const legacyBuilt = path.join(root, 'dist', 'config', 'pdf417-tables.json');

const tables = JSON.parse(fs.readFileSync(source, 'utf8'));
const encodedClusters = {};
for (const [name, patterns] of Object.entries(tables.clusters)) {
  const runs = patterns.flatMap((pattern) => pattern.match(/../g).map(Number));
  encodedClusters[name] = Buffer.from(runs).toString('base64');
}

const output = JSON.stringify({ clusters: encodedClusters, rs: tables.rs });
fs.writeFileSync(compact, output);
if (fs.existsSync(path.dirname(built))) {
  fs.writeFileSync(built, output);
  fs.rmSync(legacyBuilt, { force: true });
}
