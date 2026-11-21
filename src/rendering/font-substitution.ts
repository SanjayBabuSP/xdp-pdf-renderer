import { FontEquateRule } from '../types';

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
  force: boolean;
}

export class FontSubstitution {
  private rules: FontEquateRule[];

  constructor(customRules?: FontEquateRule[]) {
    this.rules = [...(customRules ?? []), ...DEFAULT_EQUATE_RULES];
  }

  resolve(family: string, weight?: string, posture?: string): FontDescriptor {
    const w = weight ?? '*';
    const p = posture ?? '*';

    for (const rule of this.rules) {
      if (matchesPattern(family, w, p, rule.from)) {
        const descriptor = applySubstitution(family, w, p, rule.to);
        return { ...descriptor, force: rule.force };
      }
    }

    return { family, weight: w, posture: p, force: false };
  }

  resolveFamily(family: string, weight?: string): string {
    return this.resolve(family, weight).family;
  }
}

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

function applySubstitution(
  _family: string,
  weight: string,
  posture: string,
  toPattern: string
): FontDescriptor {
  const parts = splitPattern(toPattern);
  if (parts.length !== 3) return { family: _family, weight, posture, force: false };

  const [toFamily, toWeight, toPosture] = parts;
  return {
    family: toFamily === '*' ? _family : toFamily,
    weight: toWeight === '*' ? weight : toWeight,
    posture: toPosture === '*' ? posture : toPosture,
    force: false,
  };
}

function splitPattern(pattern: string): string[] {
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

function matchesPart(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  return value.toLowerCase() === pattern.toLowerCase();
}
