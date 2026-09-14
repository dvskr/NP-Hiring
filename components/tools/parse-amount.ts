/**
 * Shared parser for the free-text numeric fields on the /tools calculators.
 *
 * Accepts only a plain non-negative amount, optionally written with a dollar
 * sign, thousands separators, or surrounding spaces ("$120,000", "12.5").
 * Anything else, a minus sign above all, is NOT an amount and returns null.
 *
 * The parsers this replaces stripped every character outside [0-9.] before
 * calling parseFloat, which silently deleted the minus sign: "-500" became
 * 500 and was priced or graded as a real positive figure.
 */
const PLAIN_AMOUNT = /^(\d+(\.\d*)?|\.\d+)$/;

export function parsePlainAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s,$]/g, '');
  if (!PLAIN_AMOUNT.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
