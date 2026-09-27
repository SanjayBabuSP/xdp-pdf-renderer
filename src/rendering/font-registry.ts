import * as fs from 'fs';
import * as path from 'path';
import fontkit from '@pdf-lib/fontkit';

/**
 * Font file registry.
 *
 * Adobe LiveCycle Designer ships 88 OTFs (reference/Adobe-LiveCycle-Designer-11.0/fonts,
 * 218 MB — CJK faces alone are 5–15 MB each). They are far too large to ship inside the
 * package, so they are imported on demand:
 *
 *     npm run fonts:import -- [sourceDir]
 *
 * which copies them to `assets/fonts/adobe/` and writes `manifest.json` describing each
 * face (family / weight / posture). FontManager loads that manifest at render time and
 * falls back to the base-14 fonts when no Adobe faces have been imported.
 */

/** A single font face as described by the manifest (or a scanned directory). */
export interface FontVariant {
  /** Absolute path of the font file. */
  file: string;
  /** `normal` (weight class < 700) or `bold`. */
  weight: string;
  /** `normal` or `italic`. */
  posture: string;
  /** OS/2 usWeightClass when available (400 regular, 700 bold, …). */
  weightClass?: number;
  /** PostScript name (e.g. `MyriadPro-BoldIt`). */
  psName?: string;
}

/** Indexed font registry: lowercased family name (plus aliases) → faces. */
export interface FontManifest {
  fonts: Record<string, FontVariant[]>;
  /** Directory the manifest describes (files are stored absolute). */
  source?: string;
}

/** Default import destination — `assets/fonts/adobe/`. */
export function adobeFontDir(): string {
  return path.join(__dirname, '..', '..', 'assets', 'fonts', 'adobe');
}

export function manifestPath(dir: string = adobeFontDir()): string {
  return path.join(dir, 'manifest.json');
}

export function familyKey(family: string): string {
  return family.trim().toLowerCase();
}

/**
 * Load a previously imported manifest. Returns null when no fonts were imported
 * (the renderer then falls back to base-14 + the bundled Unicode font).
 */
export function loadManifest(dir: string = adobeFontDir()): FontManifest | null {
  const file = manifestPath(dir);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      fonts?: Record<string, Array<Omit<FontVariant, 'file'> & { file: string }>>;
      source?: string;
    };
    const fonts: Record<string, FontVariant[]> = {};
    for (const [key, variants] of Object.entries(raw.fonts ?? {})) {
      fonts[key] = variants.map((variant) => ({
        ...variant,
        file: path.isAbsolute(variant.file) ? variant.file : path.join(dir, variant.file),
      }));
    }
    return { fonts, source: raw.source ?? dir };
  } catch {
    return null;
  }
}

/** Index a variant under its family plus useful aliases. */
export function indexVariant(manifest: FontManifest, family: string, variant: FontVariant): void {
  const keys = new Set([familyKey(family)]);
  if (variant.psName) keys.add(familyKey(variant.psName));
  const stem = path.basename(variant.file, path.extname(variant.file));
  keys.add(familyKey(stem));
  for (const key of keys) {
    if (!key) continue;
    const list = (manifest.fonts[key] ??= []);
    if (!list.some((v) => v.file === variant.file)) list.push(variant);
  }
}

/** Look up every face registered for a family (undefined when unknown). */
export function lookupVariants(manifest: FontManifest, family: string): FontVariant[] | undefined {
  return manifest.fonts[familyKey(family)];
}

/**
 * Choose the face closest to the requested weight/posture.
 *
 * Exact weight+posture wins; otherwise the nearer of the two halves, falling back to
 * whatever the family provides (a family with a single Regular face still renders).
 */
export function pickVariant(
  variants: FontVariant[],
  weight?: string,
  posture?: string
): FontVariant {
  const wantWeight = normalizeWeight(weight);
  const wantPosture = normalizePosture(posture);
  let best = variants[0];
  let bestScore = -1;
  for (const variant of variants) {
    let score = 0;
    if (normalizeWeight(variant.weight) === wantWeight) score += 2;
    if (normalizePosture(variant.posture) === wantPosture) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = variant;
    }
  }
  return best;
}

export function normalizeWeight(weight?: string): string {
  const value = (weight ?? 'normal').toLowerCase();
  if (value === '*' || value === 'regular' || value === 'roman') return 'normal';
  if (value === 'bold' || value === 'b' || value === 'black' || value === 'heavy') return 'bold';
  return value;
}

export function normalizePosture(posture?: string): string {
  const value = (posture ?? 'normal').toLowerCase();
  if (value === '*' || value === 'roman') return 'normal';
  if (value === 'italic' || value === 'i' || value === 'oblique' || value === 'o') return 'italic';
  return value;
}

/** Metadata extracted from a font file. */
export interface FontMetadata {
  family: string;
  subfamily?: string;
  psName?: string;
  weightClass?: number;
  weight: string;
  posture: string;
}

/** Read family / weight / posture from a font file. */
export function describeFont(buffer: Buffer, fallbackName: string): FontMetadata {
  const font = fontkit.create(buffer) as unknown as {
    name?: { records?: Record<string, { en?: string }> };
    post?: { italicAngle?: number };
    directory?: { tables?: Record<string, { offset?: number }> };
  };
  const records = font.name?.records ?? {};
  const family = records.fontFamily?.en ?? records.postscriptName?.en ?? fallbackName;
  const subfamily = records.fontSubfamily?.en;
  const psName = records.postscriptName?.en;
  const weightClass = readWeightClass(buffer, font.directory);
  const italic =
    (font.post?.italicAngle != null && font.post.italicAngle !== 0) ||
    /italic|oblique/i.test(subfamily ?? '');
  return {
    family,
    subfamily,
    psName,
    weightClass,
    weight: (weightClass ?? guessWeight(subfamily)) >= 700 ? 'bold' : 'normal',
    posture: italic ? 'italic' : 'normal',
  };
}

/** OS/2 usWeightClass lives at offset 4 of the OS/2 table. */
function readWeightClass(
  buffer: Buffer,
  directory?: { tables?: Record<string, { offset?: number }> }
): number | undefined {
  const entry = directory?.tables?.['OS/2'];
  if (!entry?.offset) return undefined;
  try {
    return buffer.readUInt16BE(entry.offset + 4);
  } catch {
    return undefined;
  }
}

function guessWeight(subfamily?: string): number {
  return /bold|black|heavy|demi/i.test(subfamily ?? '') ? 700 : 400;
}

const FONT_EXTENSIONS = new Set(['.otf', '.ttf', '.otc', '.ttc']);

/** Scan a directory of font files into a manifest (absolute paths). */
export function scanFontDir(dir: string): FontManifest {
  const manifest: FontManifest = { fonts: {}, source: dir };
  if (!fs.existsSync(dir)) return manifest;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!FONT_EXTENSIONS.has(ext)) continue;
    const file = path.join(dir, entry.name);
    try {
      const buffer = fs.readFileSync(file);
      const meta = describeFont(buffer, path.basename(entry.name, ext));
      indexVariant(manifest, meta.family, {
        file,
        weight: meta.weight,
        posture: meta.posture,
        weightClass: meta.weightClass,
        psName: meta.psName,
      });
    } catch {
      // Unreadable/exotic font — skip rather than fail the render.
    }
  }
  return manifest;
}
