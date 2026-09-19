import * as path from 'path';
import * as fs from 'fs';
import { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { RenderOptions } from '../types';

import defaultFontsJson from '../config/default-fonts.json';

const DEFAULT_FONTS: Record<string, string> = defaultFontsJson;

// Bundled Unicode-capable fallback (DejaVu Sans, Bitstream Vera license — see assets/fonts/LICENSE-DejaVu.txt).
// Used instead of pdf-lib's built-in WinAnsi-only standard fonts so that non-Latin-1 characters
// (e.g. "Δ", "µ", accented names) common in real-world form data don't crash PDF generation.
const UNICODE_FALLBACK_REGULAR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const UNICODE_FALLBACK_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

/** Manages font loading and embedding in a pdf-lib PDFDocument. */
export class FontManager {
  private fontCache: Map<string, PDFFont> = new Map();
  private customFonts: Record<string, string>;
  private doc: PDFDocument;

  constructor(doc: PDFDocument, options?: RenderOptions) {
    this.doc = doc;
    this.customFonts = options?.fonts ?? {};
    this.doc.registerFontkit(fontkit);
  }

  async getFont(family: string, weight?: string): Promise<PDFFont> {
    const key = `${family}:${weight ?? 'normal'}`;
    if (this.fontCache.has(key)) return this.fontCache.get(key)!;

    const font = await this.loadFont(family, weight);
    this.fontCache.set(key, font);
    return font;
  }

  private async loadFont(family: string, weight?: string): Promise<PDFFont> {
    // 1. Check custom fonts from options
    if (this.customFonts[family]) {
      return this.loadCustomFont(this.customFonts[family]);
    }

    // 2. Check default font paths
    const defaultPath = DEFAULT_FONTS[family];
    if (defaultPath && fs.existsSync(defaultPath)) {
      return this.loadCustomFont(defaultPath);
    }

    // 3. Fall back to the bundled Unicode-capable font (embedded via fontkit) rather than
    // pdf-lib's built-in standard fonts, which only encode WinAnsi (Latin-1) and throw on
    // characters like "Δ", "µ", or accented names that are common in real-world form data.
    const isBold = (weight ?? '').toLowerCase() === 'bold';
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
