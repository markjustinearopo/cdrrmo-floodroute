function bytes(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}

export async function verifySessionToken(token: string, secret: string, now = Date.now()) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || !secret) return null
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0])))
    if (header.alg !== 'HS256') return null
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    if (!await crypto.subtle.verify('HMAC', key, bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) return null
    const claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])))
    if (claims.role !== 'authenticated' || claims.aud !== 'authenticated'
      || !Number.isFinite(claims.exp) || claims.exp <= now / 1000
      || (claims.nbf != null && claims.nbf > now / 1000)
      || !Number.isInteger(Number(claims.account_id))) return null
    return claims
  } catch { return null }
}

// The active database account is authoritative even if an older JWT names a role.
// deno-lint-ignore no-explicit-any
export async function authorizeOperator(req: Request, db: any, roles: string[]) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (serviceKey && token === serviceKey) return { role: 'service_role', barangay: null }
  const claims = await verifySessionToken(token, Deno.env.get('SESSION_JWT_SECRET') || '')
  if (!claims) return null
  const { data, error } = await db.from('accounts').select('id,role,status,barangay,session_version').eq('id', Number(claims.account_id)).maybeSingle()
  if (error || data?.status !== 'active' || !roles.includes(data.role)
    || data.role !== claims.app_role || (data.barangay ?? null) !== (claims.barangay ?? null)
    || Number(data.session_version ?? 0) !== Number(claims.session_version ?? 0)) return null
  return data
}
