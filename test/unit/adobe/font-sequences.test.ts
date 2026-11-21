import {
  resolveFontSequence,
  addFontSequenceRule,
  parseFontSequenceString,
  DEFAULT_FONT_SEQUENCES,
  FontSequenceRule,
} from '../../../src/adobe/font-sequences';

describe('G16 — font fallback sequences', () => {
  it('selects the first available candidate from a built-in rule', () => {
    expect(resolveFontSequence('Helvetica', new Set(['Arial', 'Liberation Sans']))).toBe('Arial');
    expect(resolveFontSequence('Times', new Set(['TimesRoman']))).toBe('TimesRoman');
    expect(resolveFontSequence('arial', new Set(['Helvetica']))).toBe('Helvetica');
  });

  it('matches candidates by normalized family key', () => {
    expect(resolveFontSequence('Helvetica', new Set(['LiberationSans']))).toBe('LiberationSans');
    expect(resolveFontSequence('Courier', new Set(['Courier Prime']))).toBe('Courier Prime');
  });

  it('returns the original family when no rule or candidate matches', () => {
    expect(resolveFontSequence('Fantasy', new Set(['Arial']))).toBe('Fantasy');
    expect(resolveFontSequence('Helvetica', new Set(['Comic Sans']))).toBe('Helvetica');
  });

  it('applies posture and weight constraints when selecting a rule', () => {
    const original = [...DEFAULT_FONT_SEQUENCES];
    try {
      DEFAULT_FONT_SEQUENCES.length = 0;
      DEFAULT_FONT_SEQUENCES.push(
        { fromFamily: 'Custom', fromWeight: 'bold', fromPosture: 'italic', sequence: ['BI'] },
        { fromFamily: 'Custom', fromWeight: 'normal', fromPosture: 'normal', sequence: ['Reg'] }
      );

      expect(resolveFontSequence('custom', new Set(['BI', 'Reg']), 'italic', 'bold')).toBe('BI');
      expect(resolveFontSequence('custom', new Set(['BI', 'Reg']), 'normal', 'normal')).toBe('Reg');
      expect(resolveFontSequence('custom', new Set(['BI', 'Reg']), 'italic', 'normal')).toBe(
        'custom'
      );
    } finally {
      DEFAULT_FONT_SEQUENCES.splice(0, DEFAULT_FONT_SEQUENCES.length, ...original);
    }
  });

  it('replaces a matching rule and appends a new one', () => {
    const rules: FontSequenceRule[] = [
      { fromFamily: 'Times', sequence: ['Old'] },
      { fromFamily: 'Other', sequence: ['Keep'] },
    ];

    addFontSequenceRule(rules, { fromFamily: 'times', sequence: ['New'] });
    expect(rules).toEqual([
      { fromFamily: 'times', sequence: ['New'] },
      { fromFamily: 'Other', sequence: ['Keep'] },
    ]);

    addFontSequenceRule(rules, {
      fromFamily: 'Added',
      fromPosture: 'italic',
      sequence: ['Italic'],
    });
    expect(rules.length).toBe(3);
    expect(rules[2]).toEqual({
      fromFamily: 'Added',
      fromPosture: 'italic',
      sequence: ['Italic'],
    });
  });

  it('parses semicolon-delimited family, weight, posture and sequence entries', () => {
    const rules = parseFontSequenceString(
      ' Times * bold * italic * Times New Roman * serif ; Helvetica * normal * roman * Arial * sans-serif ; Orphan'
    );

    expect(rules).toEqual([
      {
        fromFamily: 'Times',
        fromWeight: 'bold',
        fromPosture: 'italic',
        sequence: ['Times New Roman', 'serif'],
      },
      {
        fromFamily: 'Helvetica',
        fromWeight: 'normal',
        fromPosture: 'roman',
        sequence: ['Arial', 'sans-serif'],
      },
    ]);
    expect(parseFontSequenceString('')).toEqual([]);
  });
});
