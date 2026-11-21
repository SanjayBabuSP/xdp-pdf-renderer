import { familyKey } from '../rendering/font-registry';
export interface FontSequenceRule {
  fromFamily: string;
  fromPosture?: string;
  fromWeight?: string;
  sequence: string[];
}

export const DEFAULT_FONT_SEQUENCES: FontSequenceRule[] = [
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
    sequence: ['Adobe Song Std L', 'Kozuka Mincho Pr6N R', 'NSimSun', 'Noto Serif CJK SC', 'serif'],
  },
  {
    fromFamily: 'SimSun-ExtB',
    sequence: ['Adobe Song Std L', 'Kozuka Mincho Pr6N R', 'serif'],
  },
  {
    fromFamily: 'SimHei',
    sequence: [
      'Adobe Heiti Std R',
      'Kozuka Gothic Pr6N R',
      'Microsoft YaHei',
      'Noto Sans CJK SC',
      'sans-serif',
    ],
  },
  {
    fromFamily: 'Microsoft YaHei',
    sequence: ['Adobe Heiti Std R', 'Kozuka Gothic Pr6N R', 'Noto Sans CJK SC', 'sans-serif'],
  },
  {
    fromFamily: 'Microsoft YaHei Light',
    sequence: ['Adobe Heiti Std R', 'Kozuka Gothic Pr6N L', 'Noto Sans CJK SC', 'sans-serif'],
  },
  {
    fromFamily: 'Microsoft YaHei UI',
    sequence: ['Adobe Heiti Std R', 'Kozuka Gothic Pr6N R', 'Noto Sans CJK SC', 'sans-serif'],
  },
  {
    fromFamily: 'NSimSun',
    sequence: ['Adobe Song Std L', 'Kozuka Mincho Pr6N R', 'Noto Serif CJK SC', 'serif'],
  },

  {
    fromFamily: 'Gulim',
    sequence: ['Malgun Gothic', 'Noto Sans CJK KR', 'sans-serif'],
  },

  {
    fromFamily: 'Symbol',
    sequence: ['Symbol', 'serif'],
  },
  {
    fromFamily: 'Zapf Dingbats',
    sequence: ['ZapfDingbats', 'serif'],
  },
];

export function resolveFontSequence(
  family: string,
  availableFonts: Set<string>,
  posture?: string,
  weight?: string
): string {
  const rule = DEFAULT_FONT_SEQUENCES.find(
    (r) =>
      r.fromFamily.toLowerCase() === family.toLowerCase() &&
      (!r.fromPosture || r.fromPosture === posture) &&
      (!r.fromWeight || r.fromWeight === weight)
  );

  if (!rule) return family;

  for (const candidate of rule.sequence) {
    if (availableFonts.has(candidate)) {
      return candidate;
    }
    const normCandidate = familyKey(candidate);
    for (const available of availableFonts) {
      if (familyKey(available) === normCandidate) {
        return available;
      }
    }
  }

  return family;
}

export function addFontSequenceRule(rules: FontSequenceRule[], rule: FontSequenceRule): void {
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

export function parseFontSequenceString(input: string): FontSequenceRule[] {
  const rules: FontSequenceRule[] = [];
  const entries = input
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const parts = entry.split('*');
    const family = parts[0].trim();
    const weight = parts[1]?.trim();
    const posture = parts[2]?.trim();
    const sequence = parts
      .slice(3)
      .map((s) => s.trim())
      .filter(Boolean);

    if (family && sequence.length) {
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
