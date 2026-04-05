/**
 * Parser Itaú — Fatura de cartão de crédito (itau_credit).
 *
 * Heurísticas:
 * - Data de fechamento/vencimento no topo (DD/MM/AAAA) para ano e mês de referência.
 * - Seção entre "Lançamentos: compras e saques" e "Compras parceladas - próximas faturas".
 * - Linha de lançamento: DD/MM + texto + valor BRL no final.
 * - Linha seguinte: categoria Itaú (ex: ALIMENTAÇÃO .SAO PAULO).
 * - Titular: padrão "(final NNNN)" quando aparece em bloco separado.
 * - Parcelas: padrão NN/NN no texto (ex: 03/12).
 */

export interface ParsedTransaction {
  date: string
  description: string
  merchant: string
  amount: number
  raw_category: string | null
  card_last4: string | null
  is_installment: boolean
  installment_current: number | null
  installment_total: number | null
  /** Preenchido apenas em extratos Alelo */
  alelo_wallet_type?: 'refeicao' | 'alimentacao' | null
}

const BRL_END = /(-?[\d]{1,3}(?:\.[\d]{3})*,\d{2}|-?[\d]+,\d{2})$/

function parseBrl(s: string): number {
  const t = s.trim().replace(/\./g, '').replace(',', '.')
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : NaN
}

/** Primeira data DD/MM/AAAA no texto (cabeçalho). */
function extractClosingDate(text: string): { d: number; m: number; y: number } | null {
  const head = text.slice(0, 4000)
  const re = /(\d{2})\/(\d{2})\/(\d{4})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(head)) !== null) {
    const d = Number(m[1])
    const mo = Number(m[2])
    const y = Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100) {
      return { d, m: mo, y }
    }
  }
  return null
}

/** Infere YYYY-MM-DD a partir de DD/MM e data de fechamento da fatura. */
function inferDate(
  day: number,
  month: number,
  closing: { d: number; m: number; y: number },
): string {
  let year = closing.y
  const cand = new Date(year, month - 1, day)
  const closingT = new Date(closing.y, closing.m - 1, closing.d)
  if (cand > closingT) {
    year -= 1
  }
  const d2 = new Date(year, month - 1, day)
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return iso(d2)
}

const INSTALL_RE = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/
const FINAL4_RE = /\(final\s*(\d{4})\)/i

function parseInstallment(text: string): {
  is_installment: boolean
  installment_current: number | null
  installment_total: number | null
} {
  const m = text.match(INSTALL_RE)
  if (!m) {
    return { is_installment: false, installment_current: null, installment_total: null }
  }
  const a = Number.parseInt(m[1], 10)
  const b = Number.parseInt(m[2], 10)
  if (a >= 1 && a <= 12 && b >= 2 && b <= 24) {
    return {
      is_installment: true,
      installment_current: a,
      installment_total: b,
    }
  }
  return { is_installment: false, installment_current: null, installment_total: null }
}

/** Linha de categoria Itaú: "ALIMENTAÇÃO .SAO PAULO" ou similar. */
function parseCategoryLine(line: string): string | null {
  const t = line.trim()
  if (!t || t.length < 3) return null
  if (/^[\d]{2}\/[\d]{2}\s/.test(t)) return null
  if (BRL_END.test(t)) return null
  return t
}

export function parseItauCredit(text: string): ParsedTransaction[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const closing = extractClosingDate(normalized) ?? {
    d: new Date().getDate(),
    m: new Date().getMonth() + 1,
    y: new Date().getFullYear(),
  }

  const lower = normalized.toLowerCase()
  const startIdx = lower.indexOf('lançamentos: compras e saques')
  const endIdx = lower.indexOf('compras parceladas - próximas faturas')
  const section =
    startIdx >= 0
      ? normalized.slice(startIdx, endIdx >= 0 ? endIdx : undefined)
      : normalized

  const lines = section.split('\n').map(l => l.trim()).filter(Boolean)

  const out: ParsedTransaction[] = []
  let pendingCard: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fm = line.match(FINAL4_RE)
    if (fm) {
      pendingCard = fm[1]
      continue
    }

    const m = line.match(/^(\d{2})\/(\d{2})\s+(.+)$/)
    if (!m) continue

    const day = Number.parseInt(m[1], 10)
    const month = Number.parseInt(m[2], 10)
    if (month < 1 || month > 12 || day < 1 || day > 31) continue

    const rest = m[3]
    const vm = rest.match(BRL_END)
    if (!vm) continue

    const valueStr = vm[1]
    const beforeValue = rest.slice(0, rest.length - valueStr.length).trim()
    const amount = parseBrl(valueStr)
    if (!Number.isFinite(amount)) continue

    let rawCat: string | null = null
    if (i + 1 < lines.length) {
      const maybeCat = parseCategoryLine(lines[i + 1])
      if (maybeCat) {
        rawCat = maybeCat
      }
    }

    const inst = parseInstallment(beforeValue + ' ' + line)
    const merchant = beforeValue.replace(INSTALL_RE, '').trim() || beforeValue

    out.push({
      date: inferDate(day, month, closing),
      description: line,
      merchant: merchant || beforeValue,
      amount,
      raw_category: rawCat,
      card_last4: pendingCard,
      is_installment: inst.is_installment,
      installment_current: inst.installment_current,
      installment_total: inst.installment_total,
    })
  }

  return out
}
