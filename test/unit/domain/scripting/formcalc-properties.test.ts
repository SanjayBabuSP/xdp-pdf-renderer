import fc from 'fast-check';
import { FormCalcParseError, FormCalcParser } from '../../../../src/domain/scripting/formcalc';

describe('FormCalc properties', () => {
  it('only raises typed parse errors for arbitrary source', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (source) => {
        try {
          new FormCalcParser(source).parse();
        } catch (error) {
          expect(error).toBeInstanceOf(FormCalcParseError);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('parses non-negative integer literals back to their numeric value', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (value) => {
        const program = new FormCalcParser(String(value)).parse();
        const statement = program.body[0];
        expect(statement?.type).toBe('ExprStmt');
        if (statement?.type !== 'ExprStmt') throw new Error('expected an expression statement');
        expect(statement.expr.type).toBe('Literal');
        if (statement.expr.type !== 'Literal') throw new Error('expected a literal');
        expect(statement.expr.value).toBe(value);
      }),
      { numRuns: 200 }
    );
  });

  it('handles empty and whitespace-only source', () => {
    expect(new FormCalcParser('').parse().body).toEqual([]);
    expect(new FormCalcParser('   ').parse().body).toEqual([]);
  });
});
