/** Money is stored as integer eurocents. Floating point values never cross the domain boundary. */
export type Money = Readonly<{ cents: number; currency: 'EUR' }>;

export function euro(cents: number): Money {
  if (!Number.isSafeInteger(cents))
    throw new Error('Money must be a safe integer amount of cents.');
  return { cents, currency: 'EUR' };
}

export function add(...amounts: Money[]): Money {
  return euro(amounts.reduce((sum, amount) => sum + amount.cents, 0));
}

export function formatEuro(amount: Money, locale = 'nl-BE'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: amount.currency }).format(
    amount.cents / 100,
  );
}

export function splitVat(
  grossCents: number,
  rateBasisPoints: number,
): {
  net: Money;
  vat: Money;
  gross: Money;
} {
  if (grossCents < 0 || rateBasisPoints < 0)
    throw new Error('Amounts and VAT rates cannot be negative.');
  const netCents = Math.round((grossCents * 10_000) / (10_000 + rateBasisPoints));
  return { net: euro(netCents), vat: euro(grossCents - netCents), gross: euro(grossCents) };
}

/**
 * Parses what a Belgian user types ("1.234,56", "99,8", "99.80", "€ 12") into cents
 * using string arithmetic only — no float multiplication, so "0,29" is exactly 29 cents.
 */
export function parseEuroToCents(input: string): number {
  let value = input.replace(/[€\s]/g, '');
  if (!/^\d[\d.,]*$/.test(value)) throw new Error('Enter an amount like 99,80.');
  const lastSep = Math.max(value.lastIndexOf(','), value.lastIndexOf('.'));
  const decimals = lastSep === -1 ? '' : value.slice(lastSep + 1);
  if (lastSep !== -1 && decimals.length <= 2) {
    value = value.slice(0, lastSep).replace(/[.,]/g, '') + '.' + decimals;
  } else {
    value = value.replace(/[.,]/g, ''); // thousands separators only
  }
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Amount is too large.');
  return cents;
}
