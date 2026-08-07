import { describe, expect, it } from 'vitest';
import { assertTransition, euro, formatEuro, splitVat } from '../src/index.js';

describe('financial primitives', () => {
  it('keeps cents exact and formats for Belgian users', () => {
    expect(formatEuro(euro(1999))).toContain('19,99');
  });

  it('splits VAT without leaking rounding difference', () => {
    const value = splitVat(12_099, 2100);
    expect(value.net.cents + value.vat.cents).toBe(value.gross.cents);
  });

  it('allows only documented status transitions', () => {
    expect(() => assertTransition('RECEIVED', 'POSTED')).toThrow('Invalid financial document');
    expect(() => assertTransition('VALIDATED', 'REVIEW_REQUIRED')).not.toThrow();
  });
});
