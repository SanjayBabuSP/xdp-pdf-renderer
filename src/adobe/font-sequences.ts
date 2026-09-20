// ────────────────────────────────────────────────────────────────────────────
// Font Substitution Sequences — Fallback chains for font resolution
// Implements the <fontInfo><seq> mechanism from Adobe XDC/XCI files
// ────────────────────────────────────────────────────────────────────────────

export interface FontSequenceRule {
  /** The font family name to match */
  fromFamily: string;
  /** The posture (regular, italic) to match */
  fromPosture?: string;
  /** The weight (normal, bold) to match */
  fromWeight?: string;
  /** Ordered list of fallback font families */
  sequence: string[];
}

/** Default font substitution sequences matching Adobe's standard mappings */
export const DEFAULT_FONT_SEQUENCES: FontSequenceRule[] = [
  // Serif sequences
  {
    fromFamily: 'Times',
    sequence: ['Times New Roman', 'TimesRoman', 'serif'],
  },
  {
    fromFamily: 'Times New Roman',
    sequence: ['Times', 'TimesRoman', 'serif'],
  },
  {
    fromFamily: 'Garamond',
    sequence: ['EB Garamond', 'Garamond Linotype', 'Times New Roman', 'serif'],
  },
  {
    fromFamily: 'Palatino',
    sequence: ['Palatino Linotype', 'Book Antiqua', 'Georgia', 'serif'],
  },
  {
    fromFamily: 'Georgia',
    sequence: ['Palatino Linotype', 'Book Antiqua', 'Times New Roman', 'serif'],
  },

  // Sans-serif sequences
  {
    fromFamily: 'Helvetica',
    sequence: ['Arial', 'Helvetica Neue', 'Liberation Sans', 'sans-serif'],
  },
  {
    fromFamily: 'Arial',
    sequence: ['Helvetica', 'Helvetica Neue', 'Liberation Sans', 'sans-serif'],
  },
  {
    fromFamily: 'Arial Black',
    sequence: ['Impact', 'Haettenschweiler', 'Arial Bold', 'sans-serif'],
  },
  {
    fromFamily: 'Verdana',
    sequence: ['Geneva', 'Liberation Sans', 'sans-serif'],
  },
  {
    fromFamily: 'Tahoma',
    sequence: ['Geneva', 'Segoe UI', 'sans-serif'],
  },
  {
    fromFamily: 'Trebuchet MS',
    sequence: ['Lucida Grande', 'sans-serif'],
  },

  // Monospace sequences
  {
    fromFamily: 'Courier',
    sequence: ['Courier New', 'CourierPrime', 'Liberation Mono', 'monospace'],
  },
  {
    fromFamily: 'Courier New',
    sequence: ['Courier', 'CourierPrime', 'Liberation Mono', 'monospace'],
  },
  {
    fromFamily: 'Consolas',
    sequence: ['Courier New', 'Liberation Mono', 'monospace'],
  },
  {
    fromFamily: 'Lucida Console',
    sequence: ['Consolas', 'Courier New', 'monospace'],
  },

  // CJK fallbacks
  {
    fromFamily: 'MS Mincho',
    sequence: ['Yu Mincho', 'Hiragino Mincho Pro', 'Noto Serif CJK JP', 'serif'],
  },
  {
    fromFamily: 'MS Gothic',
    sequence: ['Yu Gothic', 'Hiragino Kaku Gothic Pro', 'Noto Sans CJK JP', 'sans-serif'],
  },
  {
    fromFamily: 'SimSun',
    sequence: ['NSimSun', 'Noto Serif CJK SC', 'serif'],
  },
  {
    fromFamily: 'SimHei',
    sequence: ['Microsoft YaHei', 'Noto Sans CJK SC', 'sans-serif'],
  },

  // Korean
  {
    fromFamily: 'Gulim',
    sequence: ['Malgun Gothic', 'Noto Sans CJK KR', 'sans-serif'],
  },

  // Special
  {
    fromFamily: 'Symbol',
    sequence: ['Symbol', 'serif'],
  },
  {
    fromFamily: 'Zapf Dingbats',
    sequence: ['ZapfDingbats', 'serif'],
  },
];

/**
 * Find the best fallback font for a given font family.
 * Traverses the substitution sequence to find the first available font.
 *
 * @param family - The requested font family
 * @param availableFonts - Set of available font family names
 * @param posture - Font posture (optional, for matching)
 * @param weight - Font weight (optional, for matching)
 * @returns The best matching font family, or the original if no match
 */
export function resolveFontSequence(
  family: string,
  availableFonts: Set<string>,
  posture?: string,
  weight?: string
): string {
  // Find matching sequence rule
  const rule = DEFAULT_FONT_SEQUENCES.find(
    (r) =>
      r.fromFamily.toLowerCase() === family.toLowerCase() &&
      (!r.fromPosture || r.fromPosture === posture) &&
      (!r.fromWeight || r.fromWeight === weight)
  );

  if (!rule) return family;

  // Try each font in the sequence
  for (const candidate of rule.sequence) {
    if (availableFonts.has(candidate)) {
      return candidate;
    }
    // Case-insensitive check
    for (const available of availableFonts) {
      if (available.toLowerCase() === candidate.toLowerCase()) {
        return available;
      }
    }
  }

  return family;
}

/**
 * Add a custom font substitution sequence rule.
 */
export function addFontSequenceRule(rules: FontSequenceRule[], rule: FontSequenceRule): void {
  // Remove existing rule for same family
  const idx = rules.findIndex(
    (r) =>
      r.fromFamily.toLowerCase() === rule.fromFamily.toLowerCase() &&
      r.fromPosture === rule.fromPosture &&
      r.fromWeight === rule.fromWeight
  );
  if (idx >= 0) {
    rules[idx] = rule;
  } else {
    rules.push(rule);
  }
}

/**
 * Create a font sequence from a semicolon-separated string.
 * Format: "Family1;Family2;Family3" or "Family1*weight*posture;Family2"
 */
export function parseFontSequenceString(input: string): FontSequenceRule[] {
  const rules: FontSequenceRule[] = [];
  const entries = input.split(';').map((s) => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const parts = entry.split('*');
    const family = parts[0].trim();
    const weight = parts[1]?.trim();
    const posture = parts[2]?.trim();
    const sequence = parts.slice(3).map((s) => s.trim()).filter(Boolean);

    if (family && sequence.length > 0) {
      rules.push({
        fromFamily: family,
        fromWeight: weight,
        fromPosture: posture,
        sequence,
      });
    }
  }

  return rules;
}
