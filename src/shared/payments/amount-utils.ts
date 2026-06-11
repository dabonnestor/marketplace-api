const DECIMAL_RE = /^\d+(\.\d{1,2})?$/;

export function toCents(decimal: string): number {
  if (!DECIMAL_RE.test(decimal)) {
    throw new Error(`Invalid decimal amount: "${decimal}"`);
  }
  const parts = decimal.split(".");
  const whole = parts[0];
  const frac = (parts[1] ?? "").padEnd(2, "0");
  return parseInt(whole + frac, 10);
}

export function fromCents(cents: number): string {
  const whole = Math.floor(cents / 100).toString();
  const frac = (cents % 100).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}
