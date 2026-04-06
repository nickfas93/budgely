/**
 * GET /api/import/[importId]/transactions
 * Returns all pending transactions for a given import (for review modal).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { importId } = await params

  // Validate ownership of the import
  const { data: imp } = await supabase
    .from('pdf_imports')
    .select('id')
    .eq('id', importId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!imp) return NextResponse.json({ error: 'Import não encontrado' }, { status: 404 })

  const { data, error } = await supabase
    .from('transactions')
    .select('id, date, description, merchant, amount, category_id, bank, source, alelo_wallet_type, status')
    .eq('import_id', importId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ transactions: data ?? [] })
}
