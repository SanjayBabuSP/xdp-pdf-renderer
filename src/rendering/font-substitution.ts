import { FontEquateRule } from '../types';

/**
 * Default font equate rules matching Adobe LiveCycle Designer's Designer.xci.
 * These map standard PostScript font names to their Windows equivalents,
 * which are the names that commonly appear in XDP templates.
 *
 * The full rule set (including the CJK/Adobe Kozuka/Mincho/Myriad families) is
 * replicated from reference/config_files/Designer.xci. Rules with
 * `force="1"` are applied unconditionally; the rest only substitute when the
 * requested font is unavailable (handled by the font manager).
 */
const DEFAULT_EQUATE_RULES: FontEquateRule[] = [
  { from: 'Helvetica Black_*_*', to: 'Arial Black_*_*', force: false },
  { from: 'HelveticaBlack_*_*', to: 'Arial Black_*_*', force: false },
  { from: 'Helvetica-Black_*_*', to: 'Arial Black_*_*', force: false },
  { from: 'Helvetica_*_*', to: 'Arial_*_*', force: false },
  { from: 'Helv_*_*', to: 'Arial_*_*', force: false },
  { from: 'Cour_*_*', to: 'Courier New_*_*', force: false },
  { from: 'Courier_*_*', to: 'Courier New_*_*', force: false },
  { from: 'Times_*_*', to: 'Times New Roman_*_*', force: false },
  { from: 'TimesNewRoman_*_*', to: 'Times New Roman_*_*', force: false },
  // CJK and Adobe font families from Designer.xci (both <agent> and <present> blocks)
  { from: 'Kozuka Gothic Pro-VI B_*_*', to: 'Kozuka Gothic Pro-VI B_bold_normal', force: true },
  { from: 'Kozuka Gothic Pro-VI H_*_*', to: 'Kozuka Gothic Pro-VI H_bold_normal', force: true },
  { from: 'Kozuka Gothic Pro-VI M_*_*', to: 'Kozuka Gothic Pro-VI M_*_*', force: false },
  { from: 'Kozuka Mincho Pro-VI B_*_*', to: 'Kozuka Mincho Pro-VI B_bold_normal', force: true },
  { from: 'Kozuka Mincho Pro-VI H_*_*', to: 'Kozuka Mincho Pro-VI H_bold_normal', force: true },
  { from: 'Kozuka Mincho Pro-VI R_*_*', to: 'Kozuka Mincho Pro-VI R_*_*', force: false },
  { from: 'Myriad Pro Black_normal_*', to: 'Myriad Pro Black_bold_*', force: false },
  { from: 'MyriadPro_bold_normal', to: 'Myriad Pro_bold_normal', force: true },
  { from: 'Adobe Gothic Std B_normal_normal', to: 'Adobe Gothic Std B_bold_normal', force: true },
  { from: 'Adobe Fan Heiti Std B_normal_normal', to: 'Adobe Fan Heiti Std B_bold_normal', force: true },
  { from: 'Kozuka Gothic Pr6N B_*_*', to: 'Kozuka Gothic Pr6N B_bold_normal', force: true },
  { from: 'Kozuka Gothic Pr6N EL_*_*', to: 'Kozuka Gothic Pr6N EL_*_*', force: false },
  { from: 'Kozuka Gothic Pr6N H_*_*', to: 'Kozuka Gothic Pr6N H_bold_normal', force: true },
  { from: 'Kozuka Gothic Pr6N L_*_*', to: 'Kozuka Gothic Pr6N L_*_*', force: false },
  { from: 'Kozuka Gothic Pr6N M_*_*', to: 'Kozuka Gothic Pr6N M_*_*', force: false },
  { from: 'Kozuka Gothic Pr6N R_*_*', to: 'Kozuka Gothic Pr6N R_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N B_*_*', to: 'Kozuka Mincho Pr6N B_bold_normal', force: true },
  { from: 'Kozuka Mincho Pr6N EL_*_*', to: 'Kozuka Mincho Pr6N EL_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N H_*_*', to: 'Kozuka Mincho Pr6N H_bold_normal', force: true },
  { from: 'Kozuka Mincho Pr6N L_*_*', to: 'Kozuka Mincho Pr6N L_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N M_*_*', to: 'Kozuka Mincho Pr6N M_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N R_*_*', to: 'Kozuka Mincho Pr6N R_*_*', force: false },
];

interface FontDescriptor {
  family: string;
  weight: string;
  posture: string;
}

/**
 * Resolve font substitution using XCI equate rules.
 *
 * The XCI equate pattern format is: `FontFamily_Weight_Posture`
 *   - `*` means "match any value" (wildcard)
 *   - `force="1"` means always apply (even if the original font is available)
 *   - `force="0"` means apply only when the requested font is unavailable
 */
export class FontSubstitution {
  private rules: FontEquateRule[];

  constructor(customRules?: FontEquateRule[]) {
    // Custom rules take precedence over defaults
    this.rules = [...(customRules ?? []), ...DEFAULT_EQUATE_RULES];
  }

  /**
   * Resolve a font family/weight/posture through the equate rules.
   * Returns the substituted font descriptor, or the original if no rule matches.
   */
  resolve(family: string, weight?: string, posture?: string): FontDescriptor {
    const w = weight ?? '*';
    const p = posture ?? '*';

    for (const rule of this.rules) {
      if (matchesPattern(family, w, p, rule.from)) {
        return applySubstitution(family, w, p, rule.to);
      }
    }

    return { family, weight: w, posture: p };
  }

  /**
   * Resolve only the family name (convenience for the FontManager which
   * primarily needs the family string).
   */
  resolveFamily(family: string, weight?: string): string {
    return this.resolve(family, weight).family;
  }
}

/**
 * Check if a font descriptor (family, weight, posture) matches an XCI pattern.
 * Pattern format: `Family_Weight_Posture` where `*` matches anything.
 */
function matchesPattern(family: string, weight: string, posture: string, pattern: string): boolean {
  const parts = splitPattern(pattern);
  if (parts.length !== 3) return false;

  const [patFamily, patWeight, patPosture] = parts;
  return (
    matchesPart(family, patFamily) &&
    matchesPart(weight, patWeight) &&
    matchesPart(posture, patPosture)
  );
}

/** Apply substitution pattern to produce the resolved font descriptor. */
function applySubstitution(
  _family: string,
  weight: string,
  posture: string,
  toPattern: string
): FontDescriptor {
  const parts = splitPattern(toPattern);
  if (parts.length !== 3) return { family: _family, weight, posture };

  const [toFamily, toWeight, toPosture] = parts;
  return {
    family: toFamily === '*' ? _family : toFamily,
    weight: toWeight === '*' ? weight : toWeight,
    posture: toPosture === '*' ? posture : toPosture,
  };
}

/** Split a pattern string on `_`, respecting that family names may contain spaces. */
function splitPattern(pattern: string): string[] {
  // Pattern is "Family_Weight_Posture" — split from the RIGHT on underscores
  // since family names can contain spaces but weight/posture are single tokens.
  const lastUnderscore = pattern.lastIndexOf('_');
  if (lastUnderscore === -1) return [pattern];

  const secondLastUnderscore = pattern.lastIndexOf('_', lastUnderscore - 1);
  if (secondLastUnderscore === -1) return [pattern];

  return [
    pattern.slice(0, secondLastUnderscore),
    pattern.slice(secondLastUnderscore + 1, lastUnderscore),
    pattern.slice(lastUnderscore + 1),
  ];
}

/** Match a value against a pattern part (exact match or wildcard). */
function matchesPart(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  return value.toLowerCase() === pattern.toLowerCase();
}
