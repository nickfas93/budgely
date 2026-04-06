/**
 * POST /api/analyze
 *
 * Agente de análise financeira pessoal.
 * Agrega dados reais do usuário (até 6 meses) e envia para o Fin (Claude Sonnet).
 *
 * Body JSON:
 *   message  → pergunta ou pedido do usuário (string, obrigatório)
 *   month?   → mês de referência YYYY-MM (padrão: mês atual)
 *   months?  → quantos meses de histórico incluir (1–6, padrão: 3)
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { analyzeFinances } from '@/lib/finance-agent'
import type { MonthSnapshot, CategorySnapshot } from '@/lib/finance-agent'

export const runtime = 'nodejs'

function monthRange(monthDate: string): { start: string; end: string } {
  const [y, m] = monthDate.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${y}-${pad(m)}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
  return { start, end }
}

function addMonths(monthDate: string, delta: number): string {
  const [y, m] = monthDate.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function currentMonthDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function parseSavingsRate(income: number, spent: number): number {
  if (income <= 0) return 0
  const savings = income - spent
  return Math.max(0, savings / income)
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: { message?: string; month?: string; months?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const userMessage = String(body.message ?? '').trim()
  if (!userMessage) {
    return NextResponse.json({ error: 'Campo "message" é obrigatório' }, { status: 400 })
  }

  const referenceMonth = body.month && /^\d{4}-\d{2}$/.test(body.month)
    ? `${body.month}-01`
    : currentMonthDate()

  const numMonths = Math.min(6, Math.max(1, Number(body.months ?? 3)))

  const admin = createAdminClient()

  // Buscar todas as categorias para enriquecer slugs com labels
  const { data: categories } = await admin.from('categories').select('id, slug, label')
  const catById = new Map((categories ?? []).map(c => [c.id, c]))
  const catBySlug = new Map((categories ?? []).map(c => [c.slug, c]))

  // Buscar salário mensal
  const { data: profile } = await supabase
    .from('budgely_users')
    .select('monthly_salary')
    .eq('id', user.id)
    .maybeSingle()

  const monthly_salary = profile?.monthly_salary ?? 0

  // Construir snapshots para cada mês
  const snapshots: MonthSnapshot[] = []

  for (let i = numMonths - 1; i >= 0; i--) {
    const monthDate = addMonths(referenceMonth, -i)
    const { start, end } = monthRange(monthDate)

    const [txResult, budgetResult, aleloResult, aleloSpentResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('amount, category_id, alelo_wallet_type, source')
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .is('deleted_at', null)
        .gte('date', start)
        .lt('date', end),

      supabase
        .from('budgets')
        .select('category_id, amount')
        .eq('user_id', user.id)
        .eq('month', monthDate),

      supabase
        .from('alelo_budgets')
        .select('refeicao_budget, alimentacao_budget')
        .eq('user_id', user.id)
        .eq('month', monthDate)
        .maybeSingle(),

      supabase
        .from('transactions')
        .select('alelo_wallet_type, amount')
        .eq('user_id', user.id)
        .eq('source', 'pdf_alelo')
        .eq('status', 'confirmed')
        .is('deleted_at', null)
        .gte('date', start)
        .lt('date', end)
        .lt('amount', 0),
    ])

    const txs = txResult.data ?? []
    const budgets = budgetResult.data ?? []
    const aleloRow = aleloResult.data
    const aleloSpent = aleloSpentResult.data ?? []

    const budgetByCat = new Map(budgets.map(b => [b.category_id, b.amount]))

    // Calcular gastos por categoria (somente negativos)
    const spentByCat: Record<string, number> = {}
    for (const tx of txs) {
      if (tx.amount < 0 && tx.category_id) {
        spentByCat[tx.category_id] = (spentByCat[tx.category_id] ?? 0) + Math.abs(tx.amount)
      }
    }

    const catSnapshots: CategorySnapshot[] = Object.entries(spentByCat)
      .map(([catId, spent]) => {
        const cat = catById.get(catId)
        return {
          slug: cat?.slug ?? 'outros',
          label: cat?.label ?? 'Outros',
          spent,
          budget: budgetByCat.get(catId) ?? null,
        }
      })
      .sort((a, b) => b.spent - a.spent)

    const total_spent = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
    const total_income = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0)
    const effectiveIncome = total_income > 0 ? total_income : monthly_salary
    const savings = effectiveIncome - total_spent

    const spent_refeicao = Math.abs(
      aleloSpent.filter(t => t.alelo_wallet_type === 'refeicao').reduce((s, t) => s + t.amount, 0)
    )
    const spent_alimentacao = Math.abs(
      aleloSpent.filter(t => t.alelo_wallet_type === 'alimentacao').reduce((s, t) => s + t.amount, 0)
    )

    snapshots.push({
      month: monthDate,
      monthly_salary,
      total_spent,
      total_income: effectiveIncome,
      savings,
      savings_rate: parseSavingsRate(effectiveIncome, total_spent),
      categories: catSnapshots,
      alelo: aleloRow
        ? { ...aleloRow, spent_refeicao, spent_alimentacao }
        : (spent_refeicao > 0 || spent_alimentacao > 0)
          ? { refeicao_budget: null, alimentacao_budget: null, spent_refeicao, spent_alimentacao }
          : null,
    })
  }

  const current_month = snapshots[snapshots.length - 1]

  try {
    const reply = await analyzeFinances({
      months: snapshots,
      current_month,
      user_message: userMessage,
    })

    return NextResponse.json({ reply, month: referenceMonth.slice(0, 7) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
