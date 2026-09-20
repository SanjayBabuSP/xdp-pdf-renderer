import { FontSubstitution } from '../../../src/rendering/font-substitution';

describe('FontSubstitution', () => {
  describe('default rules', () => {
    const sub = new FontSubstitution();

    it('substitutes Helvetica → Arial', () => {
      const result = sub.resolve('Helvetica');
      expect(result.family).toBe('Arial');
    });

    it('substitutes Helvetica with weight/posture wildcards', () => {
      const result = sub.resolve('Helvetica', 'bold', 'italic');
      expect(result.family).toBe('Arial');
      expect(result.weight).toBe('bold');
      expect(result.posture).toBe('italic');
    });

    it('substitutes Times → Times New Roman', () => {
      expect(sub.resolveFamily('Times')).toBe('Times New Roman');
    });

    it('substitutes Courier → Courier New', () => {
      expect(sub.resolveFamily('Courier')).toBe('Courier New');
    });

    it('substitutes Cour → Courier New', () => {
      expect(sub.resolveFamily('Cour')).toBe('Courier New');
    });

    it('substitutes Helv → Arial', () => {
      expect(sub.resolveFamily('Helv')).toBe('Arial');
    });

    it('substitutes Helvetica Black → Arial Black', () => {
      expect(sub.resolveFamily('Helvetica Black')).toBe('Arial Black');
    });

    it('does not substitute unknown fonts', () => {
      expect(sub.resolveFamily('DejaVu Sans')).toBe('DejaVu Sans');
    });

    it('is case-insensitive for family matching', () => {
      expect(sub.resolveFamily('helvetica')).toBe('Arial');
    });

    it('substitutes TimesNewRoman → Times New Roman', () => {
      expect(sub.resolveFamily('TimesNewRoman')).toBe('Times New Roman');
    });

    it('applies forced Kozuka Gothic Pro-VI B rule (sets bold)', () => {
      const result = sub.resolve('Kozuka Gothic Pro-VI B', 'normal', 'normal');
      expect(result.family).toBe('Kozuka Gothic Pro-VI B');
      expect(result.weight).toBe('bold');
      expect(result.posture).toBe('normal');
    });

    it('passes Kozuka Gothic Pr6N M through unchanged (force=0)', () => {
      const result = sub.resolve('Kozuka Gothic Pr6N M', 'normal', 'italic');
      expect(result.family).toBe('Kozuka Gothic Pr6N M');
      expect(result.weight).toBe('normal');
      expect(result.posture).toBe('italic');
    });

    it('forces italic posture off for Kozuka Mincho Pr6N H (bold normal)', () => {
      const result = sub.resolve('Kozuka Mincho Pr6N H', 'normal', 'italic');
      expect(result.weight).toBe('bold');
      expect(result.posture).toBe('normal');
    });

    it('maps Myriad Pro Black normal → bold', () => {
      const result = sub.resolve('Myriad Pro Black', 'normal', 'normal');
      expect(result.family).toBe('Myriad Pro Black');
      expect(result.weight).toBe('bold');
    });

    it('maps MyriadPro_bold_normal to "Myriad Pro" bold normal (force=1)', () => {
      const result = sub.resolve('MyriadPro', 'bold', 'normal');
      expect(result.family).toBe('Myriad Pro');
      expect(result.weight).toBe('bold');
      expect(result.posture).toBe('normal');
    });

    it('forces Adobe Gothic Std B to bold', () => {
      const result = sub.resolve('Adobe Gothic Std B', 'normal', 'normal');
      expect(result.weight).toBe('bold');
    });
  });

  describe('custom rules', () => {
    it('applies custom rules before defaults', () => {
      const sub = new FontSubstitution([
        { from: 'Helvetica_*_*', to: 'Custom Font_*_*', force: false },
      ]);
      expect(sub.resolveFamily('Helvetica')).toBe('Custom Font');
    });

    it('passes through weight from to-pattern wildcards', () => {
      const sub = new FontSubstitution([
        { from: 'Source_*_*', to: 'Target_*_*', force: false },
      ]);
      const result = sub.resolve('Source', 'bold', 'normal');
      expect(result.family).toBe('Target');
      expect(result.weight).toBe('bold');
      expect(result.posture).toBe('normal');
    });

    it('overrides weight when to-pattern specifies it', () => {
      const sub = new FontSubstitution([
        { from: 'Source_*_*', to: 'Target_bold_normal', force: true },
      ]);
      const result = sub.resolve('Source', 'normal', 'italic');
      expect(result.family).toBe('Target');
      expect(result.weight).toBe('bold');
      expect(result.posture).toBe('normal');
    });
  });

  describe('resolveFamily convenience method', () => {
    it('returns just the family name', () => {
      const sub = new FontSubstitution();
      expect(sub.resolveFamily('Helvetica', 'bold')).toBe('Arial');
    });

    it('returns original family when no rule matches', () => {
      const sub = new FontSubstitution();
      expect(sub.resolveFamily('Arial')).toBe('Arial');
    });
  });
});
