import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { accountStatus } from '../_shared/accountStatus.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const result = await accountStatus(req, db, Deno.env.get('SESSION_JWT_SECRET') || '')
    return new Response(JSON.stringify(result.body), { status: result.code, headers })
  } catch {
    return new Response(JSON.stringify({ error: 'Account status is temporarily unavailable.' }), { status: 503, headers })
  }
})
