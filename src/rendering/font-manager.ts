import * as path from 'path';
import * as fs from 'fs';
import { PDFDocument, StandardFonts, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { RenderOptions } from '../types';
import { ERROR_CODES } from '../errors/error-codes';

import defaultFontsJson from '../config/default-fonts.json';

const DEFAULT_FONTS: Record<string, string> = defaultFontsJson;

const STANDARD_FONT_MAP: Record<string, string> = {
  helvetica: StandardFonts.Helvetica,
  arial: StandardFonts.Helvetica,
  'arial narrow': StandardFonts.Helvetica,
  times: StandardFonts.TimesRoman,
  'times new roman': StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
  'courier new': StandardFonts.Courier,
};

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

  private async loadFont(family: string, _weight?: string): Promise<PDFFont> {
    // 1. Check custom fonts from options
    if (this.customFonts[family]) {
      return this.loadCustomFont(this.customFonts[family]);
    }

    // 2. Check default font paths
    const defaultPath = DEFAULT_FONTS[family];
    if (defaultPath && fs.existsSync(defaultPath)) {
      return this.loadCustomFont(defaultPath);
    }

    // 3. Fall back to standard PDF fonts (no embedding needed)
    const normalized = family.toLowerCase();
    const standardFont = STANDARD_FONT_MAP[normalized] ?? StandardFonts.Helvetica;
    return this.doc.embedFont(standardFont);
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
