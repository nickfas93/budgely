import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const { category_id, apply_to_merchant, date, description, merchant, amount, bank } = body as {
    category_id?: string
    apply_to_merchant?: boolean
    date?: string
    description?: string
    merchant?: string | null
    amount?: number
    bank?: string | null
  }

  // Fetch target to validate ownership
  const { data: target, error: fetchErr } = await supabase
    .from('transactions')
    .select('id, description, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!target) return NextResponse.json({ error: 'Transação não encontrada' }, { status: 404 })

  // apply_to_merchant: batch-update only category_id across all matching descriptions
  if (apply_to_merchant) {
    if (!category_id) return NextResponse.json({ error: 'category_id obrigatório para apply_to_merchant' }, { status: 400 })
    const { error, count } = await supabase
      .from('transactions')
      .update({ category_id })
      .eq('user_id', user.id)
      .eq('description', target.description)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ updated_count: count ?? 1 })
  }

  // Single-transaction update: only include provided fields
  const patch: Record<string, unknown> = {}
  if (category_id !== undefined) patch.category_id = category_id || null
  if (date !== undefined) patch.date = date
  if (description !== undefined) patch.description = description
  if (merchant !== undefined) patch.merchant = merchant
  if (amount !== undefined) patch.amount = amount
  if (bank !== undefined) patch.bank = bank

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 })
  }

  const { error: updateErr } = await supabase
    .from('transactions')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ updated_count: 1 })
}

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase
    .from('transactions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
