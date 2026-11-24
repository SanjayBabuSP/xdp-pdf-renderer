import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const fontDir = path.join(root, 'assets', 'fonts');
const fonts = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'];
const unicodes = [
  'U+0020-007E',
  'U+00A0-00FF',
  'U+0100-017F',
  'U+0370-03FF',
  'U+2000-206F',
  'U+20A0-20BF',
  'U+2190-21FF',
  'U+2200-22FF',
  'U+2610-2611',
].join(',');

const pyftsubset = process.env.PYFTSUBSET ?? 'pyftsubset';

for (const name of fonts) {
  const target = path.join(fontDir, name);
  const temp = `${target}.subset`;
  execFileSync(
    pyftsubset,
    [
      target,
      `--unicodes=${unicodes}`,
      '--layout-features=*',
      '--name-IDs=*',
      '--name-languages=*',
      '--notdef-glyph',
      '--notdef-outline',
      `--output-file=${temp}`,
    ],
    { stdio: 'inherit' }
  );
  fs.renameSync(temp, target);
}
