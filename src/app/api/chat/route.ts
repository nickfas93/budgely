/**
 * POST /api/chat (NIC-97)
 *
 * Agente Fin — chat conversacional sobre dados financeiros.
 * Reutiliza a arquitetura de tool-use do whatsario/chat.ts,
 * adaptado para web: auth via sessão, sem limites de chars, + ferramentas de edição.
 *
 * Body: { message: string, history?: { role: 'user'|'assistant', content: string }[] }
 * Response: { reply: string, actions?: ActionSummary[] }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_monthly_summary',
    description: 'Retorna total gasto e receita no mês, agrupado por banco/fonte. Use para "quanto gastei esse mês?" ou comparações mensais.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Formato YYYY-MM. Padrão: mês atual.' },
      },
    },
  },
  {
    name: 'get_category_breakdown',
    description: 'Retorna gasto por categoria no mês com total e percentual. Use para distribuição de gastos ou perguntas sobre categorias.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Formato YYYY-MM. Padrão: mês atual.' },
      },
    },
  },
  {
    name: 'get_top_merchants',
    description: 'Lista estabelecimentos com maior gasto no mês. Use para "onde gastei mais?" ou "maiores despesas".',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'Formato YYYY-MM. Padrão: mês atual.' },
        limit: { type: 'number', description: 'Quantidade de estabelecimentos. Padrão: 10.' },
      },
    },
  },
  {
    name: 'get_budget_status',
    description: 'Retorna status dos orçamentos: valor definido vs real gasto por categoria no mês atual.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_recent_transactions',
    description: 'Lista transações recentes com ID, data, estabelecimento, valor, categoria e banco. SEMPRE use antes de qualquer edição para confirmar o ID correto.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Número de transações. Padrão: 20.' },
        month: { type: 'string', description: 'Formato YYYY-MM. Padrão: mês atual.' },
        category_slug: { type: 'string', description: 'Filtro por categoria (ex: alimentacao, lazer).' },
        bank: { type: 'string', description: 'Filtro por banco (ex: itau, alelo).' },
        search: { type: 'string', description: 'Texto para buscar em merchant/description.' },
      },
    },
  },
  {
    name: 'update_transaction_category',
    description: 'Muda a categoria de uma transação específica (por ID). Use get_recent_transactions antes para confirmar o ID. Pode aplicar a todas do mesmo estabelecimento.',
    input_schema: {
      type: 'object',
      required: ['transaction_id', 'category_slug'],
      properties: {
        transaction_id: { type: 'string', description: 'UUID da transação (obtido via get_recent_transactions).' },
        category_slug: { type: 'string', description: 'Slug da nova categoria: alimentacao, refeicao, moradia, saude, lazer, vestuario, transporte, educacao, pets, servicos, outros.' },
        apply_to_merchant: { type: 'boolean', description: 'Se true, aplica a todas as transações do mesmo estabelecimento.' },
      },
    },
  },
  {
    name: 'delete_transaction',
    description: 'Exclui uma transação específica por ID. Use get_recent_transactions antes para confirmar o ID correto.',
    input_schema: {
      type: 'object',
      required: ['transaction_id'],
      properties: {
        transaction_id: { type: 'string', description: 'UUID da transação a excluir.' },
      },
    },
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

function brl(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

// ── Tool executors ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = ReturnType<typeof import('@supabase/supabase-js').createClient<any>>

async function execMonthlySummary(input: Record<string, unknown>, userId: string, supabase: SB) {
  const month = (input.month as string) ?? currentMonth()
  const { start, end } = monthRange(month)
  const { data } = await supabase
    .from('transactions')
    .select('amount, bank, source')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end)

  const rows = data ?? []
  const expenses = rows.filter((r: { amount: number }) => r.amount < 0)
  const income = rows.filter((r: { amount: number }) => r.amount > 0)
  const totalSpent = Math.abs(expenses.reduce((s: number, r: { amount: number }) => s + r.amount, 0))
  const totalIncome = income.reduce((s: number, r: { amount: number }) => s + r.amount, 0)
  const byBank: Record<string, number> = {}
  for (const r of expenses) {
    const key = (r.bank ?? r.source ?? 'outros') as string
    byBank[key] = (byBank[key] ?? 0) + Math.abs(r.amount as number)
  }
  return {
    month,
    total_spent: brl(totalSpent),
    total_income: brl(totalIncome),
    savings: brl(totalIncome - totalSpent),
    savings_rate: totalIncome > 0 ? `${((1 - totalSpent / totalIncome) * 100).toFixed(1)}%` : 'N/A',
    transactions_count: rows.length,
    by_bank: Object.entries(byBank).sort(([, a], [, b]) => b - a).map(([bank, amount]) => ({ bank, amount: brl(amount) })),
  }
}

async function execCategoryBreakdown(input: Record<string, unknown>, userId: string, supabase: SB) {
  const month = (input.month as string) ?? currentMonth()
  const { start, end } = monthRange(month)
  const [{ data: txs }, { data: cats }] = await Promise.all([
    supabase.from('transactions').select('amount, category_id').eq('user_id', userId).gte('date', start).lte('date', end).lt('amount', 0),
    supabase.from('categories').select('id, slug, label'),
  ])
  const catMap = new Map((cats ?? []).map((c: { id: string; label: string }) => [c.id, c.label]))
  const totals: Record<string, number> = {}
  for (const t of txs ?? []) {
    const label = catMap.get(t.category_id ?? '') ?? 'Sem categoria'
    totals[label] = (totals[label] ?? 0) + Math.abs(t.amount as number)
  }
  const grand = Object.values(totals).reduce((s, v) => s + v, 0)
  return {
    month, total: brl(grand),
    categories: Object.entries(totals).sort(([, a], [, b]) => b - a).map(([label, amount]) => ({
      category: label, amount: brl(amount), pct: grand > 0 ? `${((amount / grand) * 100).toFixed(1)}%` : '0%',
    })),
  }
}

async function execTopMerchants(input: Record<string, unknown>, userId: string, supabase: SB) {
  const month = (input.month as string) ?? currentMonth()
  const limit = (input.limit as number) ?? 10
  const { start, end } = monthRange(month)
  const { data } = await supabase
    .from('transactions').select('merchant, description, amount')
    .eq('user_id', userId).gte('date', start).lte('date', end).lt('amount', 0)
  const totals: Record<string, { amount: number; count: number }> = {}
  for (const t of data ?? []) {
    const key = (t.merchant ?? t.description ?? 'Desconhecido') as string
    if (!totals[key]) totals[key] = { amount: 0, count: 0 }
    totals[key].amount += Math.abs(t.amount as number)
    totals[key].count++
  }
  return {
    month,
    top_merchants: Object.entries(totals).sort(([, a], [, b]) => b.amount - a.amount).slice(0, limit)
      .map(([merchant, { amount, count }]) => ({ merchant, total: brl(amount), transactions: count })),
  }
}

async function execBudgetStatus(userId: string, supabase: SB) {
  const month = currentMonth()
  const { start, end } = monthRange(month)
  const [{ data: budgets }, { data: txs }, { data: cats }] = await Promise.all([
    supabase.from('budgets').select('category_id, amount').eq('user_id', userId).eq('month', `${month}-01`),
    supabase.from('transactions').select('amount, category_id').eq('user_id', userId).gte('date', start).lte('date', end).lt('amount', 0),
    supabase.from('categories').select('id, label'),
  ])
  const catLabel = new Map((cats ?? []).map((c: { id: string; label: string }) => [c.id, c.label]))
  const spentByCat: Record<string, number> = {}
  for (const t of txs ?? []) {
    const id = t.category_id ?? ''
    spentByCat[id] = (spentByCat[id] ?? 0) + Math.abs(t.amount as number)
  }
  return {
    month,
    budgets: (budgets ?? []).map((b: { category_id: string; amount: number }) => {
      const spent = spentByCat[b.category_id] ?? 0
      const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0
      return {
        category: catLabel.get(b.category_id) ?? b.category_id,
        budget: brl(b.amount), spent: brl(spent),
        pct: `${pct.toFixed(0)}%`, status: pct > 100 ? 'EXCEDIDO' : pct >= 85 ? 'ATENÇÃO' : 'OK',
      }
    }),
  }
}

async function execRecentTransactions(input: Record<string, unknown>, userId: string, supabase: SB) {
  const limit = (input.limit as number) ?? 20
  const month = (input.month as string) ?? currentMonth()
  const { start, end } = monthRange(month)
  const { data: cats } = await supabase.from('categories').select('id, slug, label')
  const catLabel = new Map((cats ?? []).map((c: { id: string; label: string; slug: string }) => [c.id, { label: c.label, slug: c.slug }]))

  let query = supabase
    .from('transactions').select('id, date, merchant, description, amount, bank, category_id')
    .eq('user_id', userId).gte('date', start).lte('date', end)
    .order('date', { ascending: false }).limit(limit)

  if (input.bank) query = query.eq('bank', input.bank as string)
  if (input.category_slug && cats) {
    const catId = cats.find((c: { slug: string }) => c.slug === input.category_slug)?.id
    if (catId) query = query.eq('category_id', catId)
  }
  const { data: txs } = await query

  let rows = txs ?? []
  if (input.search) {
    const q = (input.search as string).toLowerCase()
    rows = rows.filter((t: { merchant?: string; description?: string }) =>
      (t.merchant ?? '').toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
    )
  }

  return {
    transactions: rows.map((t: { id: string; date: string; merchant?: string; description?: string; amount: number; bank?: string; category_id?: string }) => ({
      id: t.id,
      date: new Date(`${t.date}T12:00:00`).toLocaleDateString('pt-BR'),
      merchant: t.merchant ?? t.description ?? '—',
      amount: brl(t.amount),
      amount_raw: t.amount,
      bank: t.bank ?? '—',
      category: catLabel.get(t.category_id ?? '')?.label ?? 'Sem categoria',
      category_slug: catLabel.get(t.category_id ?? '')?.slug ?? null,
    })),
  }
}

async function execUpdateCategory(input: Record<string, unknown>, userId: string, supabase: SB) {
  const { transaction_id, category_slug, apply_to_merchant } = input as {
    transaction_id: string; category_slug: string; apply_to_merchant?: boolean
  }
  const { data: cat } = await supabase.from('categories').select('id, label').eq('slug', category_slug).maybeSingle()
  if (!cat) return { error: `Categoria "${category_slug}" não encontrada.` }

  const { data: tx } = await supabase.from('transactions').select('id, merchant, description').eq('id', transaction_id).eq('user_id', userId).maybeSingle()
  if (!tx) return { error: 'Transação não encontrada ou não pertence a este usuário.' }

  let query = supabase.from('transactions').update({ category_id: cat.id }).eq('user_id', userId)
  if (apply_to_merchant) {
    query = query.eq('merchant', tx.merchant ?? tx.description)
  } else {
    query = query.eq('id', transaction_id)
  }
  const { count, error } = await query
  if (error) return { error: error.message }
  return { success: true, updated_count: count ?? 1, new_category: cat.label, apply_to_merchant: !!apply_to_merchant }
}

async function execDeleteTransaction(input: Record<string, unknown>, userId: string, supabase: SB) {
  const { transaction_id } = input as { transaction_id: string }
  const { data: tx } = await supabase.from('transactions').select('id, merchant, description, amount, date').eq('id', transaction_id).eq('user_id', userId).maybeSingle()
  if (!tx) return { error: 'Transação não encontrada ou não pertence a este usuário.' }
  const { error } = await supabase.from('transactions').delete().eq('id', transaction_id).eq('user_id', userId)
  if (error) return { error: error.message }
  return { success: true, deleted: { merchant: tx.merchant ?? tx.description, amount: brl(tx.amount), date: tx.date } }
}

async function executeTool(name: string, input: Record<string, unknown>, userId: string, supabase: SB): Promise<unknown> {
  switch (name) {
    case 'get_monthly_summary':        return execMonthlySummary(input, userId, supabase)
    case 'get_category_breakdown':     return execCategoryBreakdown(input, userId, supabase)
    case 'get_top_merchants':          return execTopMerchants(input, userId, supabase)
    case 'get_budget_status':          return execBudgetStatus(userId, supabase)
    case 'get_recent_transactions':    return execRecentTransactions(input, userId, supabase)
    case 'update_transaction_category': return execUpdateCategory(input, userId, supabase)
    case 'delete_transaction':         return execDeleteTransaction(input, userId, supabase)
    default: return { error: `Ferramenta desconhecida: ${name}` }
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let body: { message?: string; history?: { role: string; content: string }[] }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const userMessage = String(body.message ?? '').trim()
  if (!userMessage) return NextResponse.json({ error: 'Campo "message" obrigatório' }, { status: 400 })

  const history = (body.history ?? []).slice(-10) // máx 10 turns de contexto

  const now = new Date()
  const systemPrompt = `Você é Fin, o assistente financeiro pessoal do Budgetly.
Data atual: ${now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
Mês atual: ${currentMonth()}.

## Comportamento
- Use SEMPRE as ferramentas para buscar dados reais antes de responder — nunca invente números.
- Para edições (mudar categoria, excluir): primeiro use get_recent_transactions para confirmar o ID, depois execute a edição.
- Após uma edição bem-sucedida, confirme o que foi feito em linguagem natural.
- Se uma edição falhar, explique o motivo claramente.
- Cite valores reais (R$) e percentuais quando relevante.
- Não mencione IDs técnicos (UUIDs) nas respostas ao usuário.
- Responda sempre em português brasileiro.

## Framework de análise (use internamente)

Psicologia do Dinheiro (Housel):
- Taxa de poupança importa mais que retorno de investimento
- Compounding exige consistência — pequenas melhorias regulares > grandes esforços esporádicos
- Você controla: quanto gasta, quanto poupa. Não controla mercado ou inflação.
- Margem de segurança: reserva antes de investir

Cerbasi — Framework Patrimonial Brasileiro:
- PMS (reserva de emergência) = 6× despesas mensais
- Regra dos 10%: poupar ao menos 10% da renda bruta
- Dívidas de cartão (>10%/mês no Brasil) = prioridade máxima para quitar
- Orçamento saudável: moradia ≤30%, transporte ≤15%, alimentação ≤15%, lazer ≤10%, poupança ≥10%

## Dados do Budgetly
- Despesas = valores negativos; Receitas = valores positivos
- Fontes: pdf_credit (Itaú crédito), pdf_debit (débito), pdf_alelo (Alelo), whatsapp (manual), manual`

  const messages: Anthropic.MessageParam[] = [
    ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: userMessage },
  ]

  try {
    // Primeira chamada
    const first = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, tools: TOOLS, messages,
    })

    if (first.stop_reason !== 'tool_use') {
      const text = first.content.find(b => b.type === 'text')?.text ?? 'Não consegui processar sua pergunta.'
      return NextResponse.json({ reply: text })
    }

    // Executa todas as tool calls em paralelo
    const toolBlocks = first.content.filter(b => b.type === 'tool_use')
    const toolResults = await Promise.all(
      toolBlocks.map(async (block) => {
        if (block.type !== 'tool_use') return null
        const result = await executeTool(block.name, block.input as Record<string, unknown>, user.id, supabase as unknown as SB)
        return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) }
      }),
    )

    // Segunda chamada com os resultados
    const final = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2048, system: systemPrompt, tools: TOOLS,
      messages: [
        ...messages,
        { role: 'assistant', content: first.content },
        { role: 'user', content: toolResults.filter(Boolean) as Anthropic.ToolResultBlockParam[] },
      ],
    })

    const reply = final.content.find(b => b.type === 'text')?.text ?? 'Não consegui gerar uma resposta.'
    return NextResponse.json({ reply })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
