import * as path from 'path';
import * as fs from 'fs';
import { PDFDocument, PDFFont } from 'pdf-lib';
import { RenderOptions, FontEquateRule } from '../types';
import { createPatchedFontkit } from './cff-subset-patch';
import { FontSubstitution } from './font-substitution';
import {
  BASE14_FAMILIES,
  isBoldWeight,
  mapToStandardPdfFont,
  isWinAnsiSafe,
} from './standard-fonts';
import { resolveFontSequence } from '../adobe/font-sequences';
import {
  FontManifest,
  FontVariant,
  adobeFontDir,
  familyKey,
  loadManifest,
  lookupVariants,
  normalizePosture,
  normalizeWeight,
  pickVariant,
  scanFontDir,
} from './font-registry';

import defaultFontsJson from '../config/default-fonts.json';

const DEFAULT_FONTS: Record<string, string> = defaultFontsJson;

const UNICODE_FALLBACK_REGULAR = path.join(
  __dirname,
  '..',
  '..',
  'assets',
  'fonts',
  'DejaVuSans.ttf'
);
const UNICODE_FALLBACK_BOLD = path.join(
  __dirname,
  '..',
  '..',
  'assets',
  'fonts',
  'DejaVuSans-Bold.ttf'
);

function fontKey(family: string | undefined, weight?: string, posture?: string): string {
  return `${family ?? ''}|${weight ?? ''}|${posture ?? ''}`;
}

export class FontManager {
  private fontCache: Map<string, PDFFont> = new Map();
  private standardFonts: Set<PDFFont> = new Set();
  private customFonts: Record<string, string>;
  private doc: PDFDocument;
  private fontSubstitution: FontSubstitution;
  private fontDirs: string[];
  private adobeManifest: FontManifest | null | undefined;
  private scannedDirs: Map<string, FontManifest> = new Map();

  constructor(doc: PDFDocument, options?: RenderOptions, fontEquateRules?: FontEquateRule[]) {
    this.doc = doc;
    this.customFonts = options?.fonts ?? {};
    this.fontDirs = options?.fontDirs ?? [];
    this.fontSubstitution = new FontSubstitution(fontEquateRules);
    this.doc.registerFontkit(createPatchedFontkit());
  }

  async getFont(family?: string, weight?: string, posture?: string): Promise<PDFFont> {
    const key = fontKey(family, weight, posture);
    const cached = this.fontCache.get(key);
    if (cached) return cached;

    const font = await this.loadFont(family, weight, posture);
    this.fontCache.set(key, font);
    return font;
  }

  async getSafeFont(
    text: string,
    family?: string,
    weight?: string,
    posture?: string
  ): Promise<PDFFont> {
    const font = await this.getFont(family, weight, posture);
    if (this.standardFonts.has(font) && !isWinAnsiSafe(text)) {
      return this.loadUnicodeFallback(weight);
    }
    return font;
  }

  private async loadFont(family?: string, weight?: string, posture?: string): Promise<PDFFont> {
    const requested = family ?? 'Helvetica';

    const available = this.hasFontFor(requested, weight, posture);
    const rule = this.fontSubstitution.resolve(requested, weight, posture);
    const changed =
      familyKey(rule.family) !== familyKey(requested) ||
      normalizeWeight(rule.weight) !== normalizeWeight(weight) ||
      normalizePosture(rule.posture) !== normalizePosture(posture);
    const useSubstitution = changed && (rule.force || !available);
    const targetFamily = useSubstitution ? rule.family : requested;
    const targetWeight = useSubstitution && rule.weight !== '*' ? rule.weight : weight;
    const targetPosture = useSubstitution && rule.posture !== '*' ? rule.posture : posture;

    const file = this.fileFor(targetFamily, targetWeight, targetPosture);
    if (file) return this.loadCustomFont(file);

    for (const candidate of [targetFamily, requested]) {
      const standardName = mapToStandardPdfFont(
        candidate,
        candidate === targetFamily ? targetWeight : weight,
        candidate === targetFamily ? targetPosture : posture
      );
      if (standardName) {
        const font = this.doc.embedStandardFont(standardName);
        this.standardFonts.add(font);
        return font;
      }
    }

    const sequencedStandard =
      (await this.tryFontSequence(targetFamily, weight, posture)) ??
      (await this.tryFontSequence(requested, weight, posture));
    if (sequencedStandard) return sequencedStandard;

    return this.loadUnicodeFallback(
      isBoldWeight(targetWeight ?? weight) ? 'bold' : (targetWeight ?? weight)
    );
  }

  private async tryFontSequence(
    family: string,
    weight?: string,
    posture?: string
  ): Promise<PDFFont | undefined> {
    const sequenced = resolveFontSequence(family, this.availableFamilies(), posture, weight);
    if (familyKey(sequenced) === familyKey(family)) return undefined;

    const file = this.fileFor(sequenced, weight, posture);
    if (file) return this.loadCustomFont(file);

    const standardName = mapToStandardPdfFont(sequenced, weight, posture);
    if (standardName) {
      const font = this.doc.embedStandardFont(standardName);
      this.standardFonts.add(font);
      return font;
    }
    return undefined;
  }

  private availableFamilies(): Set<string> {
    const names = new Set<string>();
    for (const family of Object.keys(this.customFonts)) names.add(family);
    for (const family of Object.keys(DEFAULT_FONTS)) names.add(family);
    for (const family of BASE14_FAMILIES) names.add(family);

    const manifest = this.getManifest();
    if (manifest) for (const family of Object.keys(manifest.fonts)) names.add(family);

    for (const dir of this.fontDirs) {
      const scanned = this.scannedDirs.get(dir) ?? scanFontDir(dir);
      this.scannedDirs.set(dir, scanned);
      for (const family of Object.keys(scanned.fonts)) names.add(family);
    }
    return names;
  }

  private hasFontFor(family: string, weight?: string, posture?: string): boolean {
    if (this.fileFor(family, weight, posture)) return true;
    return mapToStandardPdfFont(family, weight, posture) !== undefined;
  }

  private fileFor(family: string, weight?: string, posture?: string): string | undefined {
    const custom = this.customFonts[family];
    if (custom) return custom;

    const defaultPath = DEFAULT_FONTS[family];
    if (defaultPath && fs.existsSync(defaultPath)) return defaultPath;

    const variant = this.findVariant(family, weight, posture);
    return variant?.file;
  }

  private findVariant(family: string, weight?: string, posture?: string): FontVariant | undefined {
    const manifest = this.getManifest();
    if (manifest) {
      const variants = lookupVariants(manifest, family);
      if (variants?.length) return pickVariant(variants, weight, posture);
    }
    for (const dir of this.fontDirs) {
      const scanned = this.scannedDirs.get(dir) ?? scanFontDir(dir);
      this.scannedDirs.set(dir, scanned);
      const variants = lookupVariants(scanned, family);
      if (variants?.length) return pickVariant(variants, weight, posture);
    }
    return undefined;
  }

  private getManifest(): FontManifest | null {
    if (this.adobeManifest === undefined) {
      this.adobeManifest = loadManifest(adobeFontDir());
    }
    return this.adobeManifest;
  }

  private loadUnicodeFallback(weight?: string): Promise<PDFFont> {
    const isBold = isBoldWeight(weight);
    return this.loadCustomFont(isBold ? UNICODE_FALLBACK_BOLD : UNICODE_FALLBACK_REGULAR);
  }

  private async loadCustomFont(fontPath: string): Promise<PDFFont> {
    const resolvedPath = path.isAbsolute(fontPath) ? fontPath : path.resolve(fontPath);
    const fontBytes = fs.readFileSync(resolvedPath);
    return this.doc.embedFont(fontBytes, { subset: true });
  }

  async getDefaultFont(): Promise<PDFFont> {
    return this.getFont('Helvetica');
  }
}
