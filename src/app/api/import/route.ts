import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { extractPdfText } from '@/lib/pdf/extract-text'
import { parseItauCredit } from '@/lib/pdf/parsers/itau-credit'
import { parseItauDebit } from '@/lib/pdf/parsers/itau-debit'
import { parseAlelo } from '@/lib/pdf/parsers/alelo'
import { classifyTransactions } from '@/lib/claude'
import type { ParsedTransaction } from '@/lib/pdf/parsers/itau-credit'
import { transactionFingerprint, fileHash } from '@/lib/fingerprint'

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

export async function POST(req: Request) {
  const supabaseUser = await createClient()
  const {
    data: { user },
  } = await supabaseUser.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Formulário inválido' }, { status: 400 })
  }

  const file = formData.get('file')
  const bankRaw = formData.get('bank')
  const userIdForm = formData.get('user_id')

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'Arquivo PDF obrigatório' }, { status: 400 })
  }

  const bank = String(bankRaw ?? '') as BankKey
  if (bank !== 'itau_credit' && bank !== 'itau_debit' && bank !== 'alelo') {
    return NextResponse.json({ error: 'Banco inválido' }, { status: 400 })
  }

  if (String(userIdForm ?? '') !== user.id) {
    return NextResponse.json({ error: 'user_id não confere com a sessão' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('budgely_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json(
      {
        error:
          'Perfil não encontrado. Preencha e salve suas informações em Configurações antes de importar.',
      },
      { status: 400 },
    )
  }

  const filename = file instanceof File ? file.name : 'upload.pdf'
  const buffer = Buffer.from(await file.arrayBuffer())
  const pdfHash = fileHash(buffer)

  // Reject re-import of the same PDF
  const { data: existingImport } = await admin
    .from('pdf_imports')
    .select('id, created_at')
    .eq('user_id', user.id)
    .eq('file_hash', pdfHash)
    .eq('status', 'completed')
    .maybeSingle()

  if (existingImport) {
    const when = new Date(existingImport.created_at).toLocaleString('pt-BR')
    return NextResponse.json(
      { error: `Este PDF já foi importado em ${when}. Nenhuma transação foi adicionada.` },
      { status: 409 },
    )
  }

  const { data: pdfRow, error: insertErr } = await admin
    .from('pdf_imports')
    .insert({
      user_id: user.id,
      bank,
      filename,
      file_hash: pdfHash,
      status: 'processing',
    })
    .select('id')
    .single()

  if (insertErr || !pdfRow) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Falha ao criar registro de importação' },
      { status: 500 },
    )
  }

  const importId = pdfRow.id

  try {
    const text = await extractPdfText(buffer)

    let parsed: ParsedTransaction[] = []
    let referenceMonth: string | null = null

    if (bank === 'itau_credit') {
      parsed = parseItauCredit(text)
      if (parsed.length > 0) {
        referenceMonth = monthStartFromIsoDate(parsed[0].date)
      }
    } else if (bank === 'itau_debit') {
      parsed = parseItauDebit(text)
      if (parsed.length > 0) {
        referenceMonth = monthStartFromIsoDate(parsed[0].date)
      }
    } else {
      const alelo = parseAlelo(text)
      parsed = alelo.transactions
      referenceMonth = alelo.reference_month

      await admin.from('alelo_budgets').upsert(
        {
          user_id: user.id,
          month: alelo.reference_month,
          refeicao_budget: alelo.refeicao_budget,
          alimentacao_budget: alelo.alimentacao_budget,
        },
        { onConflict: 'user_id,month' },
      )
    }

    const toClassify = parsed.map(p => ({
      description: p.description,
      merchant: p.merchant,
      amount: p.amount,
      raw_category: p.raw_category,
    }))

    const classifications = await classifyTransactions(toClassify)

    const { data: categories, error: catErr } = await admin.from('categories').select('id, slug')
    if (catErr || !categories?.length) {
      throw new Error(catErr?.message ?? 'Categorias não encontradas no banco')
    }

    const slugToId = new Map(categories.map(c => [c.slug, c.id]))

    const src = sourceForBank(bank)
    const bankCol = bankLabel(bank)

    const rows = parsed.map((p, i) => {
      const slug = classifications[i]?.category_slug ?? 'outros'
      const category_id = slugToId.get(slug) ?? slugToId.get('outros') ?? null
      const fp = transactionFingerprint(
        user.id,
        p.date,
        p.amount,
        p.merchant ?? p.description,
      )

      return {
        user_id: user.id,
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
      }
    })

    // Pre-filter: skip rows whose fingerprint already exists for this user
    let duplicates_skipped = 0
    let newRows = rows
    if (rows.length > 0) {
      const fps = rows.map(r => r.fingerprint)
      const { data: existing } = await admin
        .from('transactions')
        .select('fingerprint')
        .eq('user_id', user.id)
        .in('fingerprint', fps)
      const existingSet = new Set(existing?.map(e => e.fingerprint) ?? [])
      newRows = rows.filter(r => !existingSet.has(r.fingerprint))
      duplicates_skipped = rows.length - newRows.length
    }

    if (newRows.length > 0) {
      const { error: txErr } = await admin.from('transactions').insert(newRows)
      if (txErr) {
        throw new Error(txErr.message)
      }
    }

    await admin
      .from('pdf_imports')
      .update({
        status: 'completed',
        total_transactions: parsed.length,
        imported_count: newRows.length,
        reference_month: referenceMonth,
        error_message: null,
      })
      .eq('id', importId)

    return NextResponse.json({
      import_id: importId,
      imported_count: newRows.length,
      total_transactions: parsed.length,
      duplicates_skipped,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin
      .from('pdf_imports')
      .update({
        status: 'failed',
        error_message: msg,
      })
      .eq('id', importId)

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
