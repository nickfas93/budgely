/**
 * GET /api/investments/quotes?tickers=PETR4,ITUB4,...
 *
 * Fetches real-time B3 quotes from Brapi.dev and benchmark data (CDI, IBOV).
 * Results are cached in-memory for 15 minutes to avoid rate limits.
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

interface BrapiQuote {
  symbol: string
  shortName: string | null
  regularMarketPrice: number
  regularMarketChangePercent: number
  regularMarketPreviousClose: number
}

interface BrapiResponse {
  results: BrapiQuote[]
  error?: string
}

// In-memory cache: ticker → { price, changePercent, cachedAt }
const cache = new Map<string, { price: number; changePercent: number; cachedAt: number }>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 min

// IBOV index cache
let ibovCache: { changePercent: number; cachedAt: number } | null = null

// Selic/CDI cache
let selicCache: { annualRate: number; cachedAt: number } | null = null

async function fetchQuotes(tickers: string[]): Promise<Map<string, { price: number; changePercent: number }>> {
  const now = Date.now()
  const stale = tickers.filter(t => {
    const c = cache.get(t)
    return !c || now - c.cachedAt > CACHE_TTL_MS
  })

  if (stale.length > 0) {
    const token = process.env.BRAPI_TOKEN
    const url = token
      ? `https://brapi.dev/api/quote/${stale.join(',')}?token=${token}`
      : `https://brapi.dev/api/quote/${stale.join(',')}`

    try {
      const res = await fetch(url, { cache: 'no-store' })
      const data = (await res.json()) as BrapiResponse & { error?: boolean; message?: string }
      if (!res.ok || data.error) {
        console.error('[Brapi] quote error:', res.status, data.message ?? JSON.stringify(data))
      } else {
        for (const q of data.results ?? []) {
          cache.set(q.symbol, {
            price: q.regularMarketPrice,
            changePercent: q.regularMarketChangePercent,
            cachedAt: now,
          })
        }
      }
    } catch (err) {
      console.error('[Brapi] fetch failed:', err)
    }
  }

  const result = new Map<string, { price: number; changePercent: number }>()
  for (const t of tickers) {
    const c = cache.get(t)
    if (c) result.set(t, { price: c.price, changePercent: c.changePercent })
  }
  return result
}

async function fetchIbov(): Promise<number | null> {
  const now = Date.now()
  if (ibovCache && now - ibovCache.cachedAt < CACHE_TTL_MS) {
    return ibovCache.changePercent
  }
  try {
    const token = process.env.BRAPI_TOKEN
    const url = token
      ? `https://brapi.dev/api/quote/%5EBVSP?token=${token}`
      : `https://brapi.dev/api/quote/%5EBVSP`
    const res = await fetch(url, { cache: 'no-store' })
    const data = (await res.json()) as BrapiResponse & { error?: boolean; message?: string }
    if (!res.ok || data.error) {
      console.error('[Brapi] ibov error:', res.status, data.message)
      return null
    }
    const pct = data.results?.[0]?.regularMarketChangePercent ?? null
    if (pct !== null) ibovCache = { changePercent: pct, cachedAt: now }
    return pct
  } catch {
    return null
  }
}

async function fetchSelic(): Promise<number | null> {
  const now = Date.now()
  if (selicCache && now - selicCache.cachedAt < CACHE_TTL_MS) {
    return selicCache.annualRate
  }
  try {
    const token = process.env.BRAPI_TOKEN
    const url = token
      ? `https://brapi.dev/api/v2/prime-rate?token=${token}`
      : `https://brapi.dev/api/v2/prime-rate`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { 'prime-rate'?: { type: string; annualRate: string }[] }
    const entry = data['prime-rate']?.find(r => r.type === 'Selic' || r.type === 'CDI')
    const rate = entry ? parseFloat(entry.annualRate) : null
    if (rate !== null) selicCache = { annualRate: rate, cachedAt: now }
    return rate
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = tickersParam
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(Boolean)

  if (tickers.length === 0) {
    return NextResponse.json({ quotes: {}, ibov: null })
  }

  try {
    const [quotes, ibov, selic] = await Promise.all([fetchQuotes(tickers), fetchIbov(), fetchSelic()])

    const quotesObj: Record<string, { price: number; changePercent: number }> = {}
    for (const [t, v] of quotes.entries()) {
      quotesObj[t] = v
    }

    return NextResponse.json({ quotes: quotesObj, ibov, selic })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
