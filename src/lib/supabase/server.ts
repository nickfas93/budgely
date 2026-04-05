/**
 * Supabase Client — Server
 *
 * Use em Server Components, API Routes e middleware.
 * Lê/escreve cookies via next/headers para manter sessão entre
 * requests server-side sem expor a service role key ao browser.
 */
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components não podem setar cookies diretamente.
            // O middleware trata isso automaticamente.
          }
        },
      },
    }
  )
}

/**
 * Supabase Admin Client — Service Role
 *
 * Usa a service_role key — bypassa RLS.
 * Use APENAS em API Routes server-side que precisam de acesso admin
 * (ex: webhook do WhatsApp recebendo dados sem sessão de usuário).
 * NUNCA exponha ao browser.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
