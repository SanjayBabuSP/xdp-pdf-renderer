import { execFileSync } from 'node:child_process';

const LIMIT_BYTES = 1_000_000;
const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const parsed = JSON.parse(output);
const pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];

console.log(
  `Package size: ${pack.size} bytes (${pack.entryCount} files, ${pack.unpackedSize} bytes unpacked)`
);

if (pack.size > LIMIT_BYTES) {
  console.error(`Package size budget exceeded: ${pack.size} > ${LIMIT_BYTES} bytes`);
  process.exit(1);
}
