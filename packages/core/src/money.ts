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
