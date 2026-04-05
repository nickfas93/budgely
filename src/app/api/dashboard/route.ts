import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

function parseMonth(monthParam: string | null): { start: string; end: string; monthDate: string } {
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth() + 1

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number)
    year = y
    month = m
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const monthDate = `${year}-${pad(month)}-01`
  const start = monthDate
  // Último dia do mês: primeiro dia do mês seguinte - 1 dia
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`
  const end = nextMonth

  return { start, end, monthDate }
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const { start, end, monthDate } = parseMonth(searchParams.get('month'))

  const [
    userResult,
    spentResult,
    incomeResult,
    categoryResult,
    budgetsResult,
    aleloResult,
    recentResult,
    categoriesResult,
  ] = await Promise.all([
    // 1. Salário mensal
    supabase
      .from('budgely_users')
      .select('monthly_salary')
      .eq('id', user.id)
      .maybeSingle(),

    // 2. Total gasto no mês (valores negativos)
    supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .gte('date', start)
      .lt('date', end)
      .lt('amount', 0),

    // 3. Total de entradas no mês (valores positivos)
    supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .gte('date', start)
      .lt('date', end)
      .gt('amount', 0),

    // 4. Gasto por categoria no mês
    supabase
      .from('transactions')
      .select('category_id, amount')
      .eq('user_id', user.id)
      .gte('date', start)
      .lt('date', end)
      .lt('amount', 0),

    // 5. Budgets do mês (pode ser vazio → copy-forward abaixo)
    supabase
      .from('budgets')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', monthDate),

    // 6. Alelo budgets do mês
    supabase
      .from('alelo_budgets')
      .select('*')
      .eq('user_id', user.id)
      .eq('month', monthDate)
      .maybeSingle(),

    // 7. Últimas 5 transações
    supabase
      .from('transactions')
      .select('id, date, description, amount, category_id, source, bank')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(5),

    // 8. Todas as categorias (para enriquecer os dados)
    supabase
      .from('categories')
      .select('id, slug, label, color, icon'),
  ])

  // Copy-forward: se não há budgets para o mês, busca o mais recente por categoria
  let budgets = budgetsResult.data ?? []
  let is_copy_forward = false
  if (budgets.length === 0) {
    const { data: allPrev } = await supabase
      .from('budgets')
      .select('*')
      .eq('user_id', user.id)
      .lt('month', monthDate)
      .order('month', { ascending: false })

    if (allPrev && allPrev.length > 0) {
      // DISTINCT ON category_id: pegar o mais recente por categoria
      const seen = new Set<string>()
      budgets = allPrev.filter(b => {
        if (seen.has(b.category_id)) return false
        seen.add(b.category_id)
        return true
      })
      is_copy_forward = true
    }
  }

  // Agregar gastos por categoria
  const spentTransactions = categoryResult.data ?? []
  const spentByCategory = spentTransactions.reduce<Record<string, number>>((acc, tx) => {
    if (!tx.category_id) return acc
    acc[tx.category_id] = (acc[tx.category_id] ?? 0) + Math.abs(tx.amount)
    return acc
  }, {})

  const spent_by_category = Object.entries(spentByCategory).map(([category_id, total]) => ({
    category_id,
    total,
  }))

  // Calcular totais
  const total_spent = Math.abs(
    (spentResult.data ?? []).reduce((sum, tx) => sum + tx.amount, 0)
  )
  const total_income = (incomeResult.data ?? []).reduce((sum, tx) => sum + tx.amount, 0)

  // Gasto Alelo por wallet_type (query separada para precisão)
  const { data: aleloSpent } = await supabase
    .from('transactions')
    .select('alelo_wallet_type, amount')
    .eq('user_id', user.id)
    .eq('source', 'pdf_alelo')
    .gte('date', start)
    .lt('date', end)
    .lt('amount', 0)

  const spent_alimentacao = Math.abs(
    (aleloSpent ?? [])
      .filter(t => t.alelo_wallet_type === 'alimentacao')
      .reduce((sum, t) => sum + t.amount, 0)
  )
  const spent_refeicao = Math.abs(
    (aleloSpent ?? [])
      .filter(t => t.alelo_wallet_type === 'refeicao')
      .reduce((sum, t) => sum + t.amount, 0)
  )

  return NextResponse.json({
    month: monthDate,
    monthly_salary: userResult.data?.monthly_salary ?? 0,
    total_spent,
    total_income,
    spent_by_category,
    budgets,
    alelo_budgets: aleloResult.data
      ? {
          ...aleloResult.data,
          spent_alimentacao,
          spent_refeicao,
        }
      : null,
    recent_transactions: recentResult.data ?? [],
    categories: categoriesResult.data ?? [],
    is_copy_forward,
  })
}
