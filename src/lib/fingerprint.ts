import { createHash } from 'crypto'

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Deterministic fingerprint for a transaction.
 * Used to detect and skip duplicate inserts.
 * Key: userId | date | amount | normalize(merchant ?? description) | installmentCurrent
 * installmentCurrent differentiates installment #1 from #2 of the same purchase series.
 */
export function transactionFingerprint(
  userId: string,
  date: string,
  amount: number,
  merchantOrDescription: string,
  installmentCurrent?: number | null,
): string {
  const installPart = installmentCurrent != null ? `|${installmentCurrent}` : ''
  const key = `${userId}|${date}|${amount}|${normalize(merchantOrDescription)}${installPart}`
  return createHash('sha256').update(key).digest('hex')
}

/**
 * SHA-256 fingerprint of a file buffer.
 * Used to detect re-import of the same PDF.
 */
export function fileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
