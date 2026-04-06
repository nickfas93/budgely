/**
 * GET /api/insights
 *
 * Gera 4 insights proativos sobre o mês atual do usuário.
 * Usa os 2 meses mais recentes para comparação quando disponíveis.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateInsights } from '@/lib/finance-agent'
import type { MonthSnapshot, CategorySnapshot } from '@/lib/finance-agent'

export const runtime = 'nodejs'

function currentMonthDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function addMonths(monthDate: string, delta: number): string {
  const [y, m] = monthDate.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function monthRange(monthDate: string): { start: string; end: string } {
  const [y, m] = monthDate.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${y}-${pad(m)}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
  return { start, end }
}

async function buildSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  monthDate: string,
  monthly_salary: number
): Promise<MonthSnapshot> {
  const { start, end } = monthRange(monthDate)

  const { data: categories } = await admin.from('categories').select('id, slug, label')
  const catById = new Map((categories ?? []).map(c => [c.id, c]))

  const [txResult, budgetResult, aleloResult, aleloSpentResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('amount, category_id, alelo_wallet_type, source')
      .eq('user_id', userId)
      .eq('status', 'confirmed')
      .is('deleted_at', null)
      .gte('date', start)
      .lt('date', end),

    supabase
      .from('budgets')
      .select('category_id, amount')
      .eq('user_id', userId)
      .eq('month', monthDate),

    supabase
      .from('alelo_budgets')
      .select('refeicao_budget, alimentacao_budget')
      .eq('user_id', userId)
      .eq('month', monthDate)
      .maybeSingle(),

    supabase
      .from('transactions')
      .select('alelo_wallet_type, amount')
      .eq('user_id', userId)
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
  const savings_rate = effectiveIncome > 0 ? Math.max(0, savings / effectiveIncome) : 0

  const spent_refeicao = Math.abs(
    aleloSpent.filter(t => t.alelo_wallet_type === 'refeicao').reduce((s, t) => s + t.amount, 0)
  )
  const spent_alimentacao = Math.abs(
    aleloSpent.filter(t => t.alelo_wallet_type === 'alimentacao').reduce((s, t) => s + t.amount, 0)
  )

  return {
    month: monthDate,
    monthly_salary,
    total_spent,
    total_income: effectiveIncome,
    savings,
    savings_rate,
    categories: catSnapshots,
    alelo: aleloRow
      ? { ...aleloRow, spent_refeicao, spent_alimentacao }
      : (spent_refeicao > 0 || spent_alimentacao > 0)
        ? { refeicao_budget: null, alimentacao_budget: null, spent_refeicao, spent_alimentacao }
        : null,
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('budgely_users')
    .select('monthly_salary')
    .eq('id', user.id)
    .maybeSingle()

  const monthly_salary = profile?.monthly_salary ?? 0
  const admin = createAdminClient()

  const currentMonthStr = currentMonthDate()
  const previousMonthStr = addMonths(currentMonthStr, -1)

  const [current, previous] = await Promise.all([
    buildSnapshot(supabase, admin, user.id, currentMonthStr, monthly_salary),
    buildSnapshot(supabase, admin, user.id, previousMonthStr, monthly_salary),
  ])

  try {
    const insights = await generateInsights(current, previous)
    return NextResponse.json({ insights })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
