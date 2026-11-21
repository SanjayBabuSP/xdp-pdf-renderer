import { StandardFontEmbedder } from 'pdf-lib';
import type { FontSpec } from '../../types';
import {
  isCondensedFamily,
  mapToStandardPdfFont,
  NARROW_SCALE,
} from '../../rendering/standard-fonts';
import { APPROX_CHAR_WIDTH_FACTOR } from '../../rendering/text/measure';

const embedders = new Map<string, StandardFontEmbedder>();

function embedderFor(name: string): StandardFontEmbedder | undefined {
  const cached = embedders.get(name);
  if (cached) return cached;
  try {
    const embedder = StandardFontEmbedder.for(name as never);
    embedders.set(name, embedder);
    return embedder;
  } catch {
    return undefined;
  }
}

export function measureLayoutText(text: string, size: number, font?: FontSpec): number {
  if (!text) return 0;
  const family = font?.family ?? 'Helvetica';
  const name = mapToStandardPdfFont(family, font?.weight, font?.posture);
  if (name) {
    const embedder = embedderFor(name);
    if (embedder) {
      try {
        let width = embedder.widthOfTextAtSize(text, size);
        if (isCondensedFamily(family)) width *= NARROW_SCALE;
        return width;
      } catch {
      }
    }
  }
  return text.length * size * APPROX_CHAR_WIDTH_FACTOR;
}
