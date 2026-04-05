import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const { category_id, apply_to_merchant } = body as {
    category_id?: string
    apply_to_merchant?: boolean
  }

  if (!category_id || typeof category_id !== 'string') {
    return NextResponse.json({ error: 'Campo obrigatório: category_id' }, { status: 400 })
  }

  // Buscar a transação alvo para validar ownership e pegar a descrição
  const { data: target, error: fetchErr } = await supabase
    .from('transactions')
    .select('id, description, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ error: 'Transação não encontrada' }, { status: 404 })
  }

  let query = supabase
    .from('transactions')
    .update({ category_id })
    .eq('user_id', user.id)

  if (apply_to_merchant) {
    // Atualiza todas as transações do mesmo estabelecimento (description)
    query = query.eq('description', target.description)
  } else {
    query = query.eq('id', id)
  }

  const { error: updateErr, count } = await query

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ updated_count: count ?? 1 })
}
