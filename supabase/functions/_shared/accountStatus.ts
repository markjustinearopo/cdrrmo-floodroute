import { verifySessionToken } from './operatorAuth.ts'

// Only the signed caller's status is returned. This lookup deliberately works
// after RLS blocks private records; no profile or other account is exposed.
export async function accountStatus(req: Request, db: any, secret: string) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const claims = await verifySessionToken(token, secret)
  if (!claims) return { code: 401, body: { error: 'Please sign in again.' } }
  const { data, error } = await db.from('accounts')
    .select('status,role,barangay,session_version').eq('id', Number(claims.account_id)).maybeSingle()
  if (error) return { code: 503, body: { error: 'Account status is temporarily unavailable.' } }
  const sessionCurrent = !!data && data.status === 'active'
    && data.role === claims.app_role
    && (data.barangay ?? null) === (claims.barangay ?? null)
    && Number(data.session_version ?? 0) === Number(claims.session_version ?? 0)
  return { code: 200, body: { status: data?.status || 'unavailable', sessionCurrent } }
}
