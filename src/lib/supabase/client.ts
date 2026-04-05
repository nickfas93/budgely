/**
 * Supabase Client — Browser
 *
 * Use em componentes client-side ('use client').
 * Cria uma instância singleton do cliente Supabase para o browser,
 * com suporte a cookies via @supabase/ssr para manter sessão SSR-safe.
 */
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
