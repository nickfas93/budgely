/**
 * Parser Alelo — extrato de benefícios.
 *
 * - Transações: data por extenso PT-BR, tipo Refeição/Alimentação, estabelecimento, R$ valor.
 * - Créditos "Saldo liberado" / DISPONIBILIZACAO somados em refeicao_budget / alimentacao_budget.
 * - reference_month: primeiro dia do mês inferido das datas (ano atual).
 */

import type { ParsedTransaction } from './itau-credit'

const MONTH_MAP: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

export interface AleloResult {
  transactions: ParsedTransaction[]
  refeicao_budget: number
  alimentacao_budget: number
  reference_month: string
}

function parseMonthName(s: string): number | null {
  const k = s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  return MONTH_MAP[k] ?? null
}

/**
 * Extrai datas como "Hoje, 4 abril", "sexta-feira, 3 abril", "segunda-feira, 30 março"
 */
function parsePortugueseDateLine(line: string, year: number): string | null {
  const m = line.match(
    /^(?:hoje|(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(?:-feira)?),?\s*(\d{1,2})\s+(\S+)/i,
  )
  if (!m) return null
  const day = Number.parseInt(m[1], 10)
  const monthWord = m[2]
  const month = parseMonthName(monthWord)
  if (!month || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseBrlValue(s: string): number {
  const t = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  return Number.parseFloat(t) || 0
}

// Formato real: "08:59 Compra no Refeição" ou "Compra no Refeição"
const COMPRA_RE =
  /(?:^\d{2}:\d{2}\s+)?Compra\s+no\s+(Refeição|Alimentação|Refeicao|Alimentacao)/i
const DISP_RE = /DISPONIBILIZACAO|DISPONIBILIZAÇÃO|saldo\s+liberado/i

export function parseAlelo(text: string): AleloResult {
  const year = new Date().getFullYear()
  const lines = text.split(/\n/).map(l => l.trim())

  const transactions: ParsedTransaction[] = []
  let refeicao_budget = 0
  let alimentacao_budget = 0
  const seenMonths = new Set<number>()

  let currentDate: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const dateLine = parsePortugueseDateLine(line, year)
    if (dateLine) {
      currentDate = dateLine
      const m = dateLine.match(/^(\d{4})-(\d{2})/)
      if (m) seenMonths.add(Number(m[2]))
      continue
    }

    if (!currentDate) continue

    // "Saldo liberado" é label, próxima linha é "DISPONIBILIZACAO DE VALOR R$ X"
    if (/saldo\s+liberado/i.test(line)) {
      const nextLine = lines[i + 1] ?? ''
      const valMatch = nextLine.match(/R\$\s*([\d.,]+)/i)
      const val = valMatch ? parseBrlValue(valMatch[1]) : 0
      // Alelo divide créditos em 2 linhas: primeiro refeição, depois alimentação
      // Heurística: acumulamos alternando — se refeicao_budget == alimentacao_budget, é refeição
      if (refeicao_budget <= alimentacao_budget) refeicao_budget += val
      else alimentacao_budget += val
      i++ // pula linha DISPONIBILIZACAO
      continue
    }

    if (DISP_RE.test(line)) {
      // linha DISPONIBILIZACAO sem "Saldo liberado" antes — captura valor direto
      const valMatch = line.match(/R\$\s*([\d.,]+)/i)
      const val = valMatch ? parseBrlValue(valMatch[1]) : 0
      if (refeicao_budget <= alimentacao_budget) refeicao_budget += val
      else alimentacao_budget += val
      continue
    }

    const cm = line.match(COMPRA_RE)
    if (cm) {
      const tipo = cm[1].toLowerCase()
      const wallet_type = tipo.includes('refei') ? 'refeicao' : 'alimentacao'

      let j = i + 1
      let merchant = ''
      let amount = 0

      // Formato real: próxima linha contém "ESTABELECIMENTO R$ valor"
      if (j < lines.length) {
        const nextLine = lines[j]
        const inlineVal = nextLine.match(/^(.+?)\s+R\$\s*([\d.,]+)\s*$/i)
        if (inlineVal) {
          merchant = inlineVal[1].trim()
          amount = Math.abs(parseBrlValue(inlineVal[2]))
          j++
        } else {
          // fallback: estabelecimento e valor em linhas separadas
          while (j < lines.length && lines[j] && !/^R\$\s*/i.test(lines[j]) && !parsePortugueseDateLine(lines[j], year)) {
            merchant = merchant ? `${merchant} ${lines[j]}` : lines[j]
            j++
          }
          const valLine = j < lines.length ? lines[j] : ''
          const vm = valLine.match(/R\$\s*([\d.,]+)/i)
          amount = vm ? Math.abs(parseBrlValue(vm[1])) : 0
          if (vm) j++
        }
      }

      if (amount > 0) {
        transactions.push({
          date: currentDate,
          description: line,
          merchant: merchant.trim() || line,
          amount,
          raw_category: wallet_type === 'refeicao' ? 'REFEIÇÃO' : 'ALIMENTAÇÃO',
          card_last4: null,
          is_installment: false,
          installment_current: null,
          installment_total: null,
          alelo_wallet_type: wallet_type,
        })
      }
      i = j - 1
      continue
    }
  }

  let refMonth = new Date().getMonth() + 1
  if (transactions.length > 0) {
    const d0 = transactions[0].date
    const m = d0.match(/^(\d{4})-(\d{2})/)
    if (m) refMonth = Number(m[2])
  } else if (seenMonths.size > 0) {
    refMonth = Math.min(...seenMonths)
  }

  const reference_month = `${year}-${String(refMonth).padStart(2, '0')}-01`

  return {
    transactions,
    refeicao_budget,
    alimentacao_budget,
    reference_month,
  }
}
