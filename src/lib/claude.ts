/**
 * Classificação de transações com Claude (Haiku) em batch.
 */
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-haiku-4-5-20251001'

export interface TransactionToClassify {
  description: string
  merchant: string
  amount: number
  raw_category?: string | null
}

export interface ClassificationResult {
  category_slug: string
  confidence: 'high' | 'medium' | 'low'
}

const ALLOWED_SLUGS = [
  'alimentacao',
  'refeicao',
  'moradia',
  'saude',
  'lazer',
  'vestuario',
  'transporte',
  'educacao',
  'pets',
  'servicos',
  'outros',
] as const

function parseJsonArray(raw: string): ClassificationResult[] {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  const parsed = JSON.parse(t) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Resposta não é um array JSON')
  }
  return parsed.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Item ${i} inválido`)
    }
    const o = item as Record<string, unknown>
    const slug = String(o.category_slug ?? 'outros').toLowerCase()
    const conf = String(o.confidence ?? 'medium').toLowerCase()
    const category_slug = ALLOWED_SLUGS.includes(slug as (typeof ALLOWED_SLUGS)[number])
      ? slug
      : 'outros'
    const confidence: ClassificationResult['confidence'] =
      conf === 'high' || conf === 'low' ? conf : 'medium'
    return { category_slug, confidence }
  })
}

/**
 * Classifica até 50 transações por chamada (chame em loop para listas maiores).
 */
export async function classifyTransactions(
  transactions: TransactionToClassify[],
): Promise<ClassificationResult[]> {
  if (transactions.length === 0) return []

  const BATCH = 50
  const results: ClassificationResult[] = []

  for (let offset = 0; offset < transactions.length; offset += BATCH) {
    const batch = transactions.slice(offset, offset + BATCH)
    const payload = JSON.stringify(
      batch.map(t => ({
        description: t.description,
        merchant: t.merchant,
        amount: t.amount,
        raw_category: t.raw_category ?? null,
      })),
    )

    const prompt = `Você classifica lançamentos financeiros em categorias de orçamento pessoal (Brasil).

Para cada item do array JSON de entrada, responda com um objeto na mesma ordem com:
- category_slug: um destes valores exatos: alimentacao, refeicao, moradia, saude, lazer, vestuario, transporte, educacao, pets, servicos, outros
- confidence: high | medium | low

Use raw_category como pista quando existir (ex.: "ALIMENTAÇÃO" do banco → alimentacao ou refeicao conforme contexto do estabelecimento).

TRANSAÇÕES (JSON):
${payload}

Responda APENAS com um array JSON válido, sem texto antes ou depois, sem markdown. Formato:
[{"category_slug":"...","confidence":"high"}, ...]`

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = message.content[0]
    if (block.type !== 'text') {
      throw new Error('Resposta inesperada da API Claude')
    }

    const parsed = parseJsonArray(block.text)
    // Claude ocasionalmente retorna menos itens — completa com fallback
    while (parsed.length < batch.length) {
      parsed.push({ category_slug: 'outros', confidence: 'low' })
    }
    results.push(...parsed.slice(0, batch.length))
  }

  return results
}
