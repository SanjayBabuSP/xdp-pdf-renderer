import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  describeFont,
  familyKey,
  indexVariant,
  loadManifest,
  lookupVariants,
  manifestPath,
  pickVariant,
  scanFontDir,
} from '../../../src/rendering/font-registry';

const DEJA_VU = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const DEJA_VU_BOLD = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xdp-font-registry-'));
}

const variant = (file: string, weight = 'normal', posture = 'normal') => ({
  file,
  weight,
  posture,
});

describe('font-registry — variant selection', () => {
  const variants = [
    variant('/f/Regular.otf', 'normal', 'normal'),
    variant('/f/Bold.otf', 'bold', 'normal'),
    variant('/f/BoldItalic.otf', 'bold', 'italic'),
    variant('/f/Italic.otf', 'normal', 'italic'),
  ];

  it('picks an exact weight+posture match', () => {
    expect(pickVariant(variants, 'bold', 'italic').file).toBe('/f/BoldItalic.otf');
    expect(pickVariant(variants, 'normal', 'normal').file).toBe('/f/Regular.otf');
  });

  it('prefers matching weight over posture', () => {
    expect(pickVariant(variants, 'bold', 'italic').file).toBe('/f/BoldItalic.otf');
    expect(pickVariant(variants, 'normal', 'italic').file).toBe('/f/Italic.otf');
  });

  it('falls back to the first face when nothing matches', () => {
    expect(pickVariant([variant('/f/Regular.otf')], 'bold', 'italic').file).toBe('/f/Regular.otf');
  });

  it('treats * and regular as normal', () => {
    expect(pickVariant(variants, '*', 'roman').file).toBe('/f/Regular.otf');
  });
});

describe('font-registry — indexing and lookup', () => {
  it('indexes family, postscript name and file stem', () => {
    const manifest = { fonts: {} as Record<string, ReturnType<typeof variant>[]> };
    indexVariant(manifest, 'Myriad Pro', {
      ...variant('/f/MyriadPro-Bold.otf', 'bold'),
      psName: 'MyriadPro-Bold',
    });
    expect(lookupVariants(manifest, 'Myriad Pro')).toHaveLength(1);
    expect(lookupVariants(manifest, 'myriadpro-bold')).toHaveLength(1);
    expect(lookupVariants(manifest, 'MyriadPro-Bold')).toHaveLength(1);
    expect(lookupVariants(manifest, 'NoSuchFamily')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(familyKey('  Myriad PRO ')).toBe('myriad pro');
  });
});

describe('font-registry — manifest IO', () => {
  it('returns null when no manifest exists', () => {
    expect(loadManifest(path.join(os.tmpdir(), 'xdp-missing-manifest'))).toBeNull();
  });

  it('round-trips a manifest with relative file paths', () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
    fs.writeFileSync(
      manifestPath(dir),
      JSON.stringify({
        fonts: {
          'myriad pro': [
            { family: 'Myriad Pro', weight: 'bold', posture: 'normal', file: 'fonts/MyriadPro-Bold.otf' },
          ],
        },
        source: '/elsewhere',
      })
    );
    const manifest = loadManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest!.source).toBe('/elsewhere');
    const [face] = lookupVariants(manifest!, 'Myriad Pro')!;
    expect(face.weight).toBe('bold');
    expect(path.isAbsolute(face.file)).toBe(true);
    expect(face.file).toBe(path.join(dir, 'fonts', 'MyriadPro-Bold.otf'));
  });

  it('ignores a corrupt manifest instead of throwing', () => {
    const dir = tempDir();
    fs.writeFileSync(manifestPath(dir), '{ not json');
    expect(loadManifest(dir)).toBeNull();
  });
});

describe('font-registry — directory scanning', () => {
  it('indexes real font files by family with weight/posture', () => {
    const dir = tempDir();
    fs.copyFileSync(DEJA_VU, path.join(dir, 'DejaVuSans.ttf'));
    fs.copyFileSync(DEJA_VU_BOLD, path.join(dir, 'DejaVuSans-Bold.ttf'));

    const manifest = scanFontDir(dir);
    const faces = lookupVariants(manifest, 'DejaVu Sans');
    expect(faces).toHaveLength(2);
    expect(faces!.map((f) => f.weight).sort()).toEqual(['bold', 'normal']);
    expect(pickVariant(faces!, 'bold', 'normal').file).toBe(path.join(dir, 'DejaVuSans-Bold.ttf'));
  });

  it('returns an empty manifest for a missing directory', () => {
    expect(scanFontDir(path.join(os.tmpdir(), 'xdp-definitely-missing')).fonts).toEqual({});
  });
});

describe('font-registry — describeFont', () => {
  it('reads family and style from an OTF/TTF', () => {
    const meta = describeFont(fs.readFileSync(DEJA_VU), 'fallback');
    expect(meta.family).toBe('DejaVu Sans');
    expect(meta.weight).toBe('normal');
    expect(meta.posture).toBe('normal');
  });

  it('detects bold faces', () => {
    const meta = describeFont(fs.readFileSync(DEJA_VU_BOLD), 'fallback');
    expect(meta.weight).toBe('bold');
  });
});
