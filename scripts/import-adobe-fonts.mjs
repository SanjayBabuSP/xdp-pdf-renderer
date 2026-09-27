#!/usr/bin/env node
/**
 * Import Adobe LiveCycle Designer's OTFs for local rendering.
 *
 *   npm run fonts:import                     # copies reference/…/fonts → assets/fonts/adobe
 *   npm run fonts:import -- /path/to/fonts   # any Designer install
 *   npm run fonts:import -- --dry-run        # report only
 *
 * Writes assets/fonts/adobe/manifest.json, which FontManager loads at render time
 * (font-registry.ts). Nothing is bundled in the package — the fonts stay on your
 * machine because they are licensed with Designer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = path.join(ROOT, 'reference', 'Adobe-LiveCycle-Designer-11.0', 'fonts');
const DEFAULT_DEST = path.join(ROOT, 'assets', 'fonts', 'adobe');
const EXTENSIONS = new Set(['.otf', '.ttf']);

function parseArgs(argv) {
  const options = { source: DEFAULT_SOURCE, dest: DEFAULT_DEST, dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') options.dryRun = true;
    else if (arg.startsWith('--dest=')) options.dest = path.resolve(ROOT, arg.slice(7));
    else if (arg.startsWith('--source=')) options.source = path.resolve(ROOT, arg.slice(9));
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-')) options.source = path.resolve(arg);
  }
  return options;
}

function describeFont(buffer, fallbackName) {
  const font = fontkit.create(buffer);
  const records = font.name?.records ?? {};
  const family = records.fontFamily?.en ?? records.postscriptName?.en ?? fallbackName;
  const subfamily = records.fontSubfamily?.en;
  const psName = records.postscriptName?.en ?? fallbackName;
  const weightClass = readWeightClass(buffer, font);
  const italic =
    (font.post?.italicAngle != null && font.post.italicAngle !== 0) ||
    /italic|oblique/i.test(subfamily ?? '');
  return {
    family,
    weight: (weightClass ?? (/bold|black|heavy|demi/i.test(subfamily ?? '') ? 700 : 400)) >= 700 ? 'bold' : 'normal',
    posture: italic ? 'italic' : 'normal',
    weightClass,
    psName,
  };
}

function readWeightClass(buffer, font) {
  const entry = font.directory?.tables?.['OS/2'];
  if (!entry?.offset) return undefined;
  try {
    return buffer.readUInt16BE(entry.offset + 4);
  } catch {
    return undefined;
  }
}

function key(value) {
  return value.trim().toLowerCase();
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(
    [
      'Usage: npm run fonts:import -- [sourceDir] [--dest=dir] [--dry-run]',
      '',
      `  source  Designer fonts directory (default: ${path.relative(ROOT, DEFAULT_SOURCE)})`,
      `  --dest  import destination   (default: ${path.relative(ROOT, DEFAULT_DEST)})`,
    ].join('\n')
  );
  process.exit(0);
}

if (!fs.existsSync(options.source)) {
  console.error(`Font source not found: ${options.source}`);
  console.error('Pass a path: npm run fonts:import -- /path/to/Designer/fonts');
  process.exit(1);
}

const entries = fs
  .readdirSync(options.source, { withFileTypes: true })
  .filter((entry) => entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
  .map((entry) => entry.name)
  .sort();

if (entries.length === 0) {
  console.error(`No .otf/.ttf files in ${options.source}`);
  process.exit(1);
}

const fonts = {};
let copied = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

if (!options.dryRun) fs.mkdirSync(options.dest, { recursive: true });

for (const name of entries) {
  const sourceFile = path.join(options.source, name);
  const destFile = path.join(options.dest, name);
  try {
    const buffer = fs.readFileSync(sourceFile);
    const meta = describeFont(buffer, path.basename(name, path.extname(name)));
    const variant = {
      family: meta.family,
      weight: meta.weight,
      posture: meta.posture,
      file: name,
      ...(meta.weightClass != null ? { weightClass: meta.weightClass } : {}),
      ...(meta.psName ? { psName: meta.psName } : {}),
    };
    for (const alias of new Set([key(meta.family), key(meta.psName ?? ''), key(path.basename(name, path.extname(name)))])) {
      if (!alias) continue;
      const list = (fonts[alias] ??= []);
      if (!list.some((v) => v.file === name)) list.push(variant);
    }
    if (!options.dryRun) {
      if (!fs.existsSync(destFile) || fs.statSync(destFile).size !== buffer.length) {
        fs.writeFileSync(destFile, buffer);
        copied++;
      } else {
        skipped++;
      }
    }
    bytes += buffer.length;
  } catch (error) {
    failed++;
    console.error(`  ! ${name}: ${error.message}`);
  }
}

if (!options.dryRun) {
  const manifest = {
    generatedBy: 'scripts/import-adobe-fonts.mjs',
    source: options.source,
    count: entries.length,
    fonts,
  };
  fs.writeFileSync(path.join(options.dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const families = new Set(Object.values(fonts).flat().map((v) => v.family));
console.log(
  [
    `${options.dryRun ? 'Would import' : 'Imported'} ${entries.length} fonts` +
      `${failed ? ` (${failed} failed)` : ''} from ${options.source}`,
    `  ${families.size} families, ${(bytes / 1024 / 1024).toFixed(1)} MB` +
      (options.dryRun ? '' : ` → ${options.dest}${copied ? `, ${copied} copied` : ''}${skipped ? `, ${skipped} up to date` : ''}`),
    `  manifest: ${path.join(options.dest, 'manifest.json')}`,
    '  Note: these fonts are licensed with Adobe LiveCycle Designer — keep them local.',
  ].join('\n')
);
