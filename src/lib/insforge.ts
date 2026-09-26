'use client'

import { createClient } from '@insforge/sdk'

/**
 * One client for the whole app.
 *
 * There are no player accounts: identity is a secret token that the database
 * checks inside each SECURITY DEFINER function. This client therefore only ever
 * uses the public anon key.
 */
export const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
})

export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_INSFORGE_URL && process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY)
}
