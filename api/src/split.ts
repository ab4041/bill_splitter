/**
 * Split `totalCents` into `count` integer shares that always add up to the total.
 * The remainder is handed out one cent at a time to the first shares.
 * Example: splitCents(1000, 3) -> [334, 333, 333]
 */
export function splitCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('totalCents must be a positive safe integer')
  }
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new RangeError('count must be a positive safe integer')
  }
  const base = Math.floor(totalCents / count)
  const remainder = totalCents % count
  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base))
}
