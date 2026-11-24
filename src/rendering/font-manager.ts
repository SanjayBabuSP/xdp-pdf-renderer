import * as path from 'path';
import * as fsp from 'fs/promises';
import type { Stats } from 'fs';
import { PDFDocument, PDFFont } from 'pdf-lib';
import { RenderOptions, FontEquateRule } from '../types';
import { ERROR_CODES } from '../errors/error-codes';
import { createPatchedFontkit } from './cff-subset-patch';
import { FontSubstitution } from './font-substitution';
import {
  BASE14_FAMILIES,
  isBoldWeight,
  isItalicPosture,
  mapToStandardPdfFont,
} from './standard-fonts';
import { resolveFontSequence } from '../adobe/font-sequences';
import {
  FontManifest,
  FontVariant,
  familyKey,
  loadManifestAsync,
  lookupVariants,
  normalizePosture,
  normalizeWeight,
  pickVariant,
  scanFontDirAsync,
} from './font-registry';

import defaultFontsJson from '../config/default-fonts.json';

const DEFAULT_FONTS: Record<string, string> = defaultFontsJson;

function resolveDefaultFont(value: string): string {
  return path.join(__dirname, '..', '..', value);
}

function defaultFontPath(family: string, weight?: string, posture?: string): string | undefined {
  const base = DEFAULT_FONTS[family];
  if (base === undefined) return undefined;
  if (
    family.trim().toLowerCase() === 'arial' &&
    (isBoldWeight(weight) || isItalicPosture(posture))
  ) {
    return undefined;
  }
  const resolved = resolveDefaultFont(base);
  return AVAILABLE_DEFAULT_FONTS.has(resolved) ? resolved : undefined;
}

interface CachedFontBytes {
  mtimeMs: number;
  size: number;
  bytes: Buffer;
}

const FONT_BYTES_CACHE = new Map<string, CachedFontBytes>();
const FONT_BYTES_CACHE_LIMIT = 8 * 1024 * 1024;
let cachedFontBytesTotal = 0;

export class FontFileNotFoundError extends Error {
  readonly code = ERROR_CODES.FONT_NOT_FOUND.code;

  constructor(fontPath: string) {
    super(`${ERROR_CODES.FONT_NOT_FOUND.message}: ${fontPath}`);
    this.name = 'FontFileNotFoundError';
  }
}

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

const FONT_LOADS = new Map<string, Promise<Buffer>>();
const AVAILABLE_DEFAULT_FONTS = new Set<string>();
let defaultFontPreload: Promise<void> | undefined;

function storeFontBytes(resolvedPath: string, mtimeMs: number, size: number, bytes: Buffer): void {
  const cached = FONT_BYTES_CACHE.get(resolvedPath);
  if (cached !== undefined) cachedFontBytesTotal -= cached.size;
  if (cachedFontBytesTotal + bytes.length > FONT_BYTES_CACHE_LIMIT) {
    FONT_BYTES_CACHE.clear();
    cachedFontBytesTotal = 0;
  }
  FONT_BYTES_CACHE.set(resolvedPath, { mtimeMs, size, bytes });
  cachedFontBytesTotal += bytes.length;
}

async function readFontBytes(resolvedPath: string): Promise<Buffer> {
  let stats: Stats;
  try {
    stats = await fsp.stat(resolvedPath);
  } catch {
    throw new FontFileNotFoundError(resolvedPath);
  }

  const cached = FONT_BYTES_CACHE.get(resolvedPath);
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.bytes;
  }

  let pending = FONT_LOADS.get(resolvedPath);
  if (pending === undefined) {
    pending = fsp
      .readFile(resolvedPath)
      .then((bytes) => {
        storeFontBytes(resolvedPath, stats.mtimeMs, stats.size, bytes);
        return bytes;
      })
      .finally(() => {
        FONT_LOADS.delete(resolvedPath);
      });
    FONT_LOADS.set(resolvedPath, pending);
  }
  return pending;
}

function preloadDefaultFonts(): Promise<void> {
  if (defaultFontPreload === undefined) {
    const configured = Object.values(DEFAULT_FONTS).map(resolveDefaultFont);
    const configuredSet = new Set(configured);
    const paths = new Set([...configured, UNICODE_FALLBACK_REGULAR, UNICODE_FALLBACK_BOLD]);
    defaultFontPreload = Promise.all(
      [...paths].map(async (resolved) => {
        try {
          await readFontBytes(resolved);
          if (configuredSet.has(resolved)) AVAILABLE_DEFAULT_FONTS.add(resolved);
        } catch {
          return;
        }
      })
    ).then(() => undefined);
  }
  return defaultFontPreload;
}

function fontKey(family: string | undefined, weight?: string, posture?: string): string {
  return `${family ?? ''}|${weight ?? ''}|${posture ?? ''}`;
}

export class FontManager {
  private fontCache: Map<string, PDFFont> = new Map();
  private customFonts: Record<string, string>;
  private doc: PDFDocument;
  private fontSubstitution: FontSubstitution;
  private fontDirs: string[];
  private adobeManifest: FontManifest | null = null;
  private scannedDirs: Map<string, FontManifest> = new Map();
  private preloadPromise: Promise<void> | undefined;

  constructor(doc: PDFDocument, options?: RenderOptions, fontEquateRules?: FontEquateRule[]) {
    this.doc = doc;
    this.customFonts = options?.fonts ?? {};
    this.fontDirs = options?.fontDirs ?? [];
    this.fontSubstitution = new FontSubstitution(fontEquateRules);
    this.doc.registerFontkit(createPatchedFontkit());
  }

  async preload(): Promise<void> {
    if (this.preloadPromise === undefined) {
      this.preloadPromise = (async () => {
        const [manifest, dirs] = await Promise.all([
          loadManifestAsync(),
          Promise.all(
            this.fontDirs.map(async (dir) => [dir, await scanFontDirAsync(dir)] as const)
          ),
          preloadDefaultFonts(),
        ]);
        this.adobeManifest = manifest;
        for (const [dir, scanned] of dirs) this.scannedDirs.set(dir, scanned);
      })();
    }
    return this.preloadPromise;
  }

  async getFont(family?: string, weight?: string, posture?: string): Promise<PDFFont> {
    await this.preload();
    const key = fontKey(family, weight, posture);
    const cached = this.fontCache.get(key);
    if (cached) return cached;

    const font = await this.loadFont(family, weight, posture);
    this.fontCache.set(key, font);
    return font;
  }

  async getSafeFont(
    _text: string,
    family?: string,
    weight?: string,
    posture?: string
  ): Promise<PDFFont> {
    return this.getFont(family, weight, posture);
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
      return font;
    }
    return undefined;
  }

  private availableFamilies(): Set<string> {
    const names = new Set<string>();
    for (const family of Object.keys(this.customFonts)) names.add(family);
    for (const family of Object.keys(DEFAULT_FONTS)) names.add(family);
    for (const family of BASE14_FAMILIES) names.add(family);

    if (this.adobeManifest)
      for (const family of Object.keys(this.adobeManifest.fonts)) names.add(family);

    for (const dir of this.fontDirs) {
      const scanned = this.scannedDirs.get(dir);
      if (scanned) for (const family of Object.keys(scanned.fonts)) names.add(family);
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

    const defaultPath = defaultFontPath(family, weight, posture);
    if (defaultPath) return defaultPath;

    const variant = this.findVariant(family, weight, posture);
    return variant?.file;
  }

  private findVariant(family: string, weight?: string, posture?: string): FontVariant | undefined {
    if (this.adobeManifest) {
      const variants = lookupVariants(this.adobeManifest, family);
      if (variants?.length) return pickVariant(variants, weight, posture);
    }
    for (const dir of this.fontDirs) {
      const scanned = this.scannedDirs.get(dir);
      if (!scanned) continue;
      const variants = lookupVariants(scanned, family);
      if (variants?.length) return pickVariant(variants, weight, posture);
    }
    return undefined;
  }

  private loadUnicodeFallback(weight?: string): Promise<PDFFont> {
    const isBold = isBoldWeight(weight);
    return this.loadCustomFont(isBold ? UNICODE_FALLBACK_BOLD : UNICODE_FALLBACK_REGULAR);
  }

  private async loadCustomFont(fontPath: string): Promise<PDFFont> {
    const resolvedPath = path.isAbsolute(fontPath) ? fontPath : path.resolve(fontPath);
    const fontBytes = await readFontBytes(resolvedPath);
    return this.doc.embedFont(fontBytes, { subset: true });
  }

  async getDefaultFont(): Promise<PDFFont> {
    return this.getFont('Helvetica');
  }
}
