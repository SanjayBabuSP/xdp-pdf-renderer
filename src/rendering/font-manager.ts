import * as path from 'path';
import * as fs from 'fs';
import { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { RenderOptions, FontEquateRule } from '../types';
import { FontSubstitution } from './font-substitution';
import { isBoldWeight, mapToStandardPdfFont, isWinAnsiSafe } from './standard-fonts';

import defaultFontsJson from '../config/default-fonts.json';

const DEFAULT_FONTS: Record<string, string> = defaultFontsJson;

// Bundled Unicode-capable fallback (DejaVu Sans, Bitstream Vera license — see assets/fonts/LICENSE-DejaVu.txt).
// Used instead of pdf-lib's built-in WinAnsi-only standard fonts so that non-Latin-1 characters
// (e.g. "Δ", "µ", accented names) common in real-world form data don't crash PDF generation.
const UNICODE_FALLBACK_REGULAR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const UNICODE_FALLBACK_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function fontKey(family: string | undefined, weight?: string, posture?: string): string {
  return `${family ?? ''}|${weight ?? ''}|${posture ?? ''}`;
}

/** Manages font loading and embedding in a pdf-lib PDFDocument. */
export class FontManager {
  private fontCache: Map<string, PDFFont> = new Map();
  private standardFonts: Set<PDFFont> = new Set();
  private customFonts: Record<string, string>;
  private doc: PDFDocument;
  private fontSubstitution: FontSubstitution;

  constructor(doc: PDFDocument, options?: RenderOptions, fontEquateRules?: FontEquateRule[]) {
    this.doc = doc;
    this.customFonts = options?.fonts ?? {};
    this.fontSubstitution = new FontSubstitution(fontEquateRules);
    this.doc.registerFontkit(fontkit);
  }

  async getFont(family?: string, weight?: string, posture?: string): Promise<PDFFont> {
    const key = fontKey(family, weight, posture);
    const cached = this.fontCache.get(key);
    if (cached) return cached;

    const font = await this.loadFont(family, weight, posture);
    this.fontCache.set(key, font);
    return font;
  }

  /**
   * Return a font guaranteed to be able to render `text`.
   *
   * Standard (base-14) PDF fonts can only encode WinAnsi. When the resolved
   * font is such a standard font and the text exceeds WinAnsi (e.g. "Δ", "µ",
   * CJK), this transparently swaps in the bundled Unicode-capable font instead
   * of letting pdf-lib throw at draw time.
   */
  async getSafeFont(text: string, family?: string, weight?: string, posture?: string): Promise<PDFFont> {
    const font = await this.getFont(family, weight, posture);
    if (this.standardFonts.has(font) && !isWinAnsiSafe(text)) {
      return this.loadUnicodeFallback(weight);
    }
    return font;
  }

  private async loadFont(family?: string, weight?: string, posture?: string): Promise<PDFFont> {
    const requested = family ?? 'Helvetica';

    // 1. Check custom fonts from options (exact match first)
    if (this.customFonts[requested]) {
      return this.loadCustomFont(this.customFonts[requested]);
    }

    // 2. Check default font paths (exact match)
    const defaultPath = DEFAULT_FONTS[requested];
    if (defaultPath && fs.existsSync(defaultPath)) {
      return this.loadCustomFont(defaultPath);
    }

    // 3. Apply XCI font substitution rules (e.g. Helvetica → Arial)
    const substituted = this.fontSubstitution.resolve(requested, weight, posture);
    if (substituted.family !== requested || substituted.weight !== weight || substituted.posture !== posture) {
      if (this.customFonts[substituted.family]) {
        return this.loadCustomFont(this.customFonts[substituted.family]);
      }
      const subDefaultPath = DEFAULT_FONTS[substituted.family];
      if (subDefaultPath && fs.existsSync(subDefaultPath)) {
        return this.loadCustomFont(subDefaultPath);
      }
    }

    // 4. Base-14 standard PDF font (Designer.xdc <seq> mapping): try the requested
    //    family first, then the XCI-substituted family (Arial → Helvetica metrics).
    const weightToUse = substituted.weight === '*' ? weight : substituted.weight;
    const postureToUse = substituted.posture === '*' ? posture : substituted.posture;
    for (const candidate of [requested, substituted.family]) {
      const standardName = mapToStandardPdfFont(candidate, weightToUse, postureToUse);
      if (standardName) {
        const font = this.doc.embedStandardFont(standardName);
        this.standardFonts.add(font);
        return font;
      }
    }

    // 5. Fall back to the bundled Unicode-capable font (embedded via fontkit) rather than
    // pdf-lib's built-in standard fonts, which only encode WinAnsi (Latin-1) and throw on
    // characters like "Δ", "µ", or accented names that are common in real-world form data.
    return this.loadUnicodeFallback(isBoldWeight(weightToUse) ? 'bold' : weightToUse);
  }

  private loadUnicodeFallback(weight?: string): Promise<PDFFont> {
    const isBold = isBoldWeight(weight);
    return this.loadCustomFont(isBold ? UNICODE_FALLBACK_BOLD : UNICODE_FALLBACK_REGULAR);
  }

  private async loadCustomFont(fontPath: string): Promise<PDFFont> {
    const resolvedPath = path.isAbsolute(fontPath) ? fontPath : path.resolve(fontPath);
    const fontBytes = fs.readFileSync(resolvedPath);
    return this.doc.embedFont(fontBytes);
  }

  async getDefaultFont(): Promise<PDFFont> {
    return this.getFont('Helvetica');
  }
}