import type { ConfigSpec, FontEquateRule } from '../../../types';
import { getChild, toArray, attr, textContent } from '../../../lib/xml-utils';

const DEFAULT_FONT_EQUATE_RULES: FontEquateRule[] = [
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
  {
    from: 'Adobe Fan Heiti Std B_normal_normal',
    to: 'Adobe Fan Heiti Std B_bold_normal',
    force: true,
  },
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

export function parseConfig(config: unknown): ConfigSpec | undefined {
  if (!config) {
    return {
      fontEquateRules: [...DEFAULT_FONT_EQUATE_RULES],
    };
  }
  const present = getChild(config, 'present');
  const pdf = getChild(present, 'pdf');
  const psMap = getChild(config, 'psMap');
  const fontEntries = toArray<unknown>(getChild(psMap, 'font'));

  const fontEquateRules = parseFontEquateRules(pdf);

  const mergedRules = fontEquateRules.length
    ? mergeFontEquateRules(fontEquateRules, DEFAULT_FONT_EQUATE_RULES)
    : [...DEFAULT_FONT_EQUATE_RULES];

  return {
    pdfVersion: textContent(getChild(pdf, 'version')),
    adobeExtensionLevel: parseInt(textContent(getChild(pdf, 'adobeExtensionLevel')) ?? '0', 10),
    fonts: fontEntries.map((f) => ({
      typeface: attr(f, 'typeface') ?? '',
      psName: attr(f, 'psName') ?? '',
      weight: attr(f, 'weight'),
    })),
    fontEquateRules: mergedRules,
  };
}

function parseFontEquateRules(pdf: unknown): FontEquateRule[] {
  if (!pdf) return [];
  const fontInfo = getChild(pdf, 'fontInfo');
  if (!fontInfo) return [];
  const map = getChild(fontInfo, 'map');
  if (!map) return [];
  const equates = toArray<unknown>(getChild(map, 'equate'));
  return equates
    .map((eq) => {
      const from = attr(eq, 'from');
      const to = attr(eq, 'to');
      if (!from || !to) return null;
      return {
        from,
        to,
        force: attr(eq, 'force') === '1',
      };
    })
    .filter(Boolean) as FontEquateRule[];
}

function mergeFontEquateRules(
  xdpRules: FontEquateRule[],
  defaultRules: FontEquateRule[]
): FontEquateRule[] {
  const merged = [...xdpRules];
  const xdpFromPatterns = new Set(xdpRules.map((r) => r.from.toLowerCase()));
  for (const defaultRule of defaultRules) {
    if (!xdpFromPatterns.has(defaultRule.from.toLowerCase())) {
      merged.push(defaultRule);
    }
  }
  return merged;
}

export function parseConnectionSet(connSet: unknown): { xsdUri?: string; xsdRootElement?: string } {
  if (!connSet) return {};
  const conn = toArray<unknown>(getChild(connSet, 'xsdConnection'))[0];
  if (!conn) return {};
  return {
    xsdUri: textContent(getChild(conn, 'uri')),
    xsdRootElement: textContent(getChild(conn, 'rootElement')),
  };
}
