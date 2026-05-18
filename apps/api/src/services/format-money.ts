// why: render integer cents as a customer-facing dollar string, e.g. 2000 -> "$20"
// or 2099 -> "$20.99". Used by no-show SMS copy and any other server-rendered text
// that needs a money value. Web has its own equivalent helper.

export function centsToDollarsString(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rem = Math.abs(cents % 100);
  if (rem === 0) return `$${whole}`;
  const padded = rem.toString().padStart(2, '0');
  return `$${whole}.${padded}`;
}
