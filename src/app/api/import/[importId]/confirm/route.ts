/**
 * POST /api/import/[importId]/confirm
 * Confirms all pending (non-deleted) transactions for this import.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { importId } = await params

  // Validate ownership
  const { data: imp } = await supabase
    .from('pdf_imports')
    .select('id')
    .eq('id', importId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!imp) return NextResponse.json({ error: 'Import não encontrado' }, { status: 404 })

  const { error, count } = await supabase
    .from('transactions')
    .update({ status: 'confirmed' })
    .eq('import_id', importId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ confirmed_count: count ?? 0 })
}
