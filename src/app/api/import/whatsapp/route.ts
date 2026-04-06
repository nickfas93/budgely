/**
 * POST /api/import/whatsapp (NIC-83)
 *
 * Endpoint interno chamado pelo Whatsario para processar PDFs enviados via WhatsApp.
 * Autentica via header X-Whatsapp-Import-Secret (shared secret nos .env dos dois projetos).
 *
 * Body: multipart/form-data
 *   file     → Buffer do PDF
 *   bank     → 'itau_credit' | 'itau_debit' | 'alelo'
 *   phone    → número do usuário (lookup via budgely_users.whatsapp_phone)
 *
 * Reutiliza o mesmo pipeline do /api/import: parsers → Claude classify → INSERT transactions.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { extractPdfText } from '@/lib/pdf/extract-text'
import { parseItauCredit } from '@/lib/pdf/parsers/itau-credit'
import { parseItauDebit } from '@/lib/pdf/parsers/itau-debit'
import { parseAlelo } from '@/lib/pdf/parsers/alelo'
import { classifyTransactions } from '@/lib/claude'
import type { ParsedTransaction } from '@/lib/pdf/parsers/itau-credit'
import { transactionFingerprint } from '@/lib/fingerprint'

export const runtime = 'nodejs'

type BankKey = 'itau_credit' | 'itau_debit' | 'alelo'

function monthStartFromIsoDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})/)
  if (!m) return `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
  return `${m[1]}-${m[2]}-01`
}

function sourceForBank(bank: BankKey): 'pdf_credit' | 'pdf_debit' | 'pdf_alelo' {
  if (bank === 'itau_credit') return 'pdf_credit'
  if (bank === 'itau_debit') return 'pdf_debit'
  return 'pdf_alelo'
}

function bankLabel(bank: BankKey): 'itau' | 'alelo' {
  return bank === 'alelo' ? 'alelo' : 'itau'
}

export async function POST(req: NextRequest) {
  // Auth via shared secret
  const secret = req.headers.get('x-whatsapp-import-secret')
  if (!secret || secret !== process.env.WHATSAPP_IMPORT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Formulário inválido' }, { status: 400 })
  }

  const file = formData.get('file')
  const bankRaw = formData.get('bank')
  const phone = String(formData.get('phone') ?? '')

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'Arquivo PDF obrigatório' }, { status: 400 })
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Arquivo muito grande (máximo 10MB)' }, { status: 400 })
  }

  const bank = String(bankRaw ?? '') as BankKey
  if (bank !== 'itau_credit' && bank !== 'itau_debit' && bank !== 'alelo') {
    return NextResponse.json({ error: 'Banco inválido' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Resolve user_id via whatsapp_phone
  const normalized = phone.replace(/\D/g, '')
  const withCountry = normalized.startsWith('55') ? normalized : `55${normalized}`
  const { data: budgelyUser } = await admin
    .from('budgely_users')
    .select('id')
    .or(`whatsapp_phone.eq.${withCountry},whatsapp_phone.eq.${normalized}`)
    .maybeSingle()

  if (!budgelyUser) {
    return NextResponse.json({ error: 'Usuário Budgetly não encontrado para este número' }, { status: 404 })
  }

  const userId = budgelyUser.id
  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = `whatsapp_${bank}_${Date.now()}.pdf`

  const { data: pdfRow, error: insertErr } = await admin
    .from('pdf_imports')
    .insert({ user_id: userId, bank, filename, status: 'processing' })
    .select('id')
    .single()

  if (insertErr || !pdfRow) {
    return NextResponse.json({ error: insertErr?.message ?? 'Falha ao criar registro de importação' }, { status: 500 })
  }

  const importId = pdfRow.id

  try {
    const text = await extractPdfText(buffer)

    let parsed: ParsedTransaction[] = []
    let referenceMonth: string | null = null

    if (bank === 'itau_credit') {
      parsed = parseItauCredit(text)
      if (parsed.length > 0) referenceMonth = monthStartFromIsoDate(parsed[0].date)
    } else if (bank === 'itau_debit') {
      parsed = parseItauDebit(text)
      if (parsed.length > 0) referenceMonth = monthStartFromIsoDate(parsed[0].date)
    } else {
      const alelo = parseAlelo(text)
      parsed = alelo.transactions
      referenceMonth = alelo.reference_month
      await admin.from('alelo_budgets').upsert(
        { user_id: userId, month: alelo.reference_month, refeicao_budget: alelo.refeicao_budget, alimentacao_budget: alelo.alimentacao_budget },
        { onConflict: 'user_id,month' },
      )
    }

    const toClassify = parsed.map(p => ({
      description: p.description,
      merchant: p.merchant,
      amount: p.amount,
      raw_category: p.raw_category,
    }))

    const classifications = parsed.length > 0 ? await classifyTransactions(toClassify) : []

    const { data: categories } = await admin.from('categories').select('id, slug')
    const slugToId = new Map((categories ?? []).map(c => [c.slug, c.id]))

    const src = sourceForBank(bank)
    const bankCol = bankLabel(bank)

    const rows = parsed.map((p, i) => {
      const slug = classifications[i]?.category_slug ?? 'outros'
      const category_id = slugToId.get(slug) ?? slugToId.get('outros') ?? null
      const fp = transactionFingerprint(userId, p.date, p.amount, p.merchant ?? p.description, p.installment_current)
      return {
        user_id: userId,
        date: p.date,
        amount: p.amount,
        description: p.description,
        merchant: p.merchant,
        category_id,
        raw_category: p.raw_category,
        source: src,
        bank: bankCol,
        card_last4: p.card_last4,
        alelo_wallet_type: p.alelo_wallet_type ?? null,
        import_id: importId,
        is_installment: p.is_installment,
        installment_current: p.installment_current,
        installment_total: p.installment_total,
        fingerprint: fp,
        status: 'pending',
      }
    })

    let newRows = rows
    if (rows.length > 0) {
      const fps = rows.map(r => r.fingerprint)
      const { data: existing } = await admin
        .from('transactions')
        .select('fingerprint')
        .eq('user_id', userId)
        .in('fingerprint', fps)
      const existingSet = new Set(existing?.map(e => e.fingerprint) ?? [])
      const seenInBatch = new Set<string>()
      newRows = rows.filter(r => {
        if (existingSet.has(r.fingerprint) || seenInBatch.has(r.fingerprint)) return false
        seenInBatch.add(r.fingerprint)
        return true
      })
    }

    if (newRows.length > 0) {
      await admin.from('transactions').insert(newRows)
    }

    await admin
      .from('pdf_imports')
      .update({ status: 'completed', total_transactions: parsed.length, imported_count: newRows.length, reference_month: referenceMonth })
      .eq('id', importId)

    // Cálculo do total importado
    const totalAmount = parsed.reduce((sum, p) => sum + p.amount, 0)
    const refLabel = referenceMonth
      ? new Date(`${referenceMonth}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : 'período desconhecido'

    return NextResponse.json({ imported_count: rows.length, reference_month: refLabel, total_amount: totalAmount })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin.from('pdf_imports').update({ status: 'failed', error_message: msg }).eq('id', importId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
