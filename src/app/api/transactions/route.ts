import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { transactionFingerprint } from '@/lib/fingerprint'

export const runtime = 'nodejs'

type WalletType = 'alimentacao' | 'refeicao'

function mapWalletType(tipo: string): WalletType | null {
  if (tipo === 'VA') return 'alimentacao'
  if (tipo === 'VR') return 'refeicao'
  return null
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 })
  }

  const { date, amount, description, merchant, category_id, tipo, bank, notes } = body as {
    date?: string
    amount?: number
    description?: string
    merchant?: string
    category_id?: string | null
    tipo?: string  // 'Credito' | 'Debito' | 'VA' | 'VR'
    bank?: string
    notes?: string
  }

  if (!date || typeof date !== 'string') {
    return NextResponse.json({ error: 'Campo obrigatório: date' }, { status: 400 })
  }
  if (amount === undefined || amount === null || typeof amount !== 'number') {
    return NextResponse.json({ error: 'Campo obrigatório: amount (number)' }, { status: 400 })
  }
  if (!description || typeof description !== 'string' || description.trim() === '') {
    return NextResponse.json({ error: 'Campo obrigatório: description' }, { status: 400 })
  }

  const alelo_wallet_type = mapWalletType(String(tipo ?? ''))
  const fp = transactionFingerprint(
    user.id,
    date,
    amount,
    merchant?.trim() || description.trim(),
  )

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: user.id,
      date,
      amount,
      description: description.trim(),
      merchant: merchant?.trim() || null,
      category_id: category_id || null,
      source: 'manual',
      bank: bank?.trim() || null,
      alelo_wallet_type,
      notes: notes?.trim() || null,
      fingerprint: fp,
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id: data.id, success: true }, { status: 201 })
}
