/**
 * Parser Itaú — Extrato conta corrente (itau_debit).
 *
 * Formato típico: DD/MM/AAAA DESCRIÇÃO VALOR SALDO
 * Mantém apenas valores negativos (débito) como despesa com amount < 0.
 * Ignora saldo do dia, rendimento, TED/salário positivo, pagamento de fatura.
 */

import type { ParsedTransaction } from './itau-credit'

// Formato real: DD/MM/YYYY DESCRIÇÃO VALOR (sem coluna de saldo)
const LINE_RE =
  /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(-?[\d]{1,3}(?:\.[\d]{3})*,\d{2}|-?[\d]+,\d{2})\s*$/i

function parseBrl(s: string): number {
  const t = s.trim().replace(/\./g, '').replace(',', '.')
  return Number.parseFloat(t)
}

const IGNORE_DESC = [
  'saldo do dia',
  'rend pago aplic aut mais',
  'rend pago aplic aut',
  'saldo bloq acima',
]

function shouldIgnoreDescription(desc: string): boolean {
  const d = desc.toLowerCase().trim()
  if (IGNORE_DESC.some(x => d.includes(x))) return true
  if (d.includes('fatura paga')) return true
  if (d.includes('fatura pag')) return true
  return false
}

/** TED de salário / créditos — ignorar entradas positivas relevantes. */
function isPositiveSalaryOrTed(desc: string, value: number): boolean {
  if (value <= 0) return false
  const d = desc.toLowerCase()
  if (d.includes(' ted ') || d.startsWith('ted ')) return true
  if (d.includes('salario') || d.includes('salário')) return true
  if (d.includes('folha')) return true
  return false
}

export function parseItauDebit(text: string): ParsedTransaction[] {
  const lines = text.split(/\n/)
  const out: ParsedTransaction[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const m = line.match(LINE_RE)
    if (!m) continue

    const day = Number(m[1])
    const month = Number(m[2])
    const year = Number(m[3])
    const desc = m[4].trim()
    const value = parseBrl(m[5])
    if (!Number.isFinite(value)) continue

    if (shouldIgnoreDescription(desc)) continue

    if (value > 0) {
      if (isPositiveSalaryOrTed(desc, value)) continue
      continue
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const merchant = desc.replace(/-CT$/i, '').trim() || desc

    out.push({
      date: dateStr,
      description: line,
      merchant,
      amount: value,
      raw_category: null,
      card_last4: null,
      is_installment: false,
      installment_current: null,
      installment_total: null,
    })
  }

  return out
}
