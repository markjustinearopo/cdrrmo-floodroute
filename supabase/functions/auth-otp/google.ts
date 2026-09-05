/* ============================================================
   google.ts — verify a Google ID token, properly.

   WHY THIS IS ITS OWN FILE
   Because the tempting shortcut is a one-liner and it is a complete
   authentication bypass:

       const payload = JSON.parse(atob(idToken.split('.')[1]))   // NEVER

   A JWT is signed, not encrypted. Anyone can craft that middle segment
   claiming any email in the world. Decoding without VERIFYING THE SIGNATURE
   would let a stranger sign in as any resident — or as an admin, since
   accounts are matched by email — by pasting a hand-written string. The whole
   value of this file is the part that is easy to leave out.

   WHAT IS ACTUALLY CHECKED, and why each one matters:

     signature   RS256 against Google's published public keys. Proves Google
                 issued this token and nobody edited it.
     iss         accounts.google.com — proves it came from Google's issuer.
     aud         our own client id. WITHOUT THIS, a token Google minted for
                 SOME OTHER APP would be accepted here: any developer whose
                 app you have ever signed into could replay your token into
                 this system. This is the check people most often skip.
     exp / iat   still valid, not issued in the future (with a little clock
                 skew allowance, because phones are not synchronised).
     email_verified
                 Google itself vouches for the address. This is what lets
                 registration skip the emailed code entirely — the whole
                 reason this feature is worth having, given the office has no
                 verified sending domain to deliver a code from.

   Google's signing keys rotate, so they are fetched from the JWKS endpoint
   and cached for as long as the response says they are good for.
   ============================================================ */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
/* Phone clocks drift. Sixty seconds is enough to forgive that without
   meaningfully widening the window a stolen token stays usable. */
const CLOCK_SKEW_S = 60

export type GoogleProfile = {
  email: string
  emailVerified: boolean
  name: string
  picture: string | null
  sub: string
}

type Jwk = { kid: string; n: string; e: string; kty: string; alg?: string; use?: string }

let cache: { keys: Jwk[]; expiresAt: number } | null = null

async function jwks(): Promise<Jwk[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.keys
  const res = await fetch(JWKS_URL)
  if (!res.ok) throw new Error(`Could not reach Google to verify the sign-in (HTTP ${res.status}).`)
  const body = await res.json()
  const keys: Jwk[] = body.keys ?? []

  /* Honour Cache-Control rather than picking a number: Google rotates these,
     and a stale cache means every sign-in fails until the process restarts. */
  const cc = res.headers.get('cache-control') ?? ''
  const m = cc.match(/max-age=(\d+)/)
  const ttlMs = m ? Number(m[1]) * 1000 : 3600_000
  cache = { keys, expiresAt: Date.now() + ttlMs }
  return keys
}

/** base64url → bytes. Google's JWKs and JWT segments both use this encoding. */
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlToJson(s: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)))
}

/**
 * Verify a Google ID token and return the profile it asserts.
 * Throws with a human-readable message on any failure — the caller turns that
 * into a 401. Never returns unverified data.
 *
 * @param idToken  the credential string from Google Identity Services
 * @param clientId our OAuth client id; the token's `aud` must equal it
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleProfile> {
  const parts = String(idToken ?? '').split('.')
  if (parts.length !== 3) throw new Error('That Google sign-in was not in the expected format.')
  const [headerB64, payloadB64, sigB64] = parts

  const header = b64urlToJson(headerB64) as { alg?: string; kid?: string }
  if (header.alg !== 'RS256') throw new Error(`Unexpected Google token algorithm "${header.alg}".`)
  if (!header.kid) throw new Error('Google token carried no key id.')

  const key = (await jwks()).find((k) => k.kid === header.kid)
  if (!key) throw new Error('Google signed this with a key we do not recognise. Try signing in again.')

  const pub = await crypto.subtle.importKey(
    'jwk',
    { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    pub,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  )
  // Everything below this line is only meaningful because this passed.
  if (!ok) throw new Error('That Google sign-in could not be verified.')

  const p = b64urlToJson(payloadB64) as Record<string, string | number | boolean>

  if (!ISSUERS.has(String(p.iss))) throw new Error('That token did not come from Google.')
  if (String(p.aud) !== clientId) throw new Error('That Google sign-in was issued for a different application.')

  const now = Math.floor(Date.now() / 1000)
  if (Number(p.exp) + CLOCK_SKEW_S < now) throw new Error('That Google sign-in has expired. Please try again.')
  if (Number(p.iat) - CLOCK_SKEW_S > now) throw new Error('That Google sign-in is dated in the future.')

  const email = String(p.email ?? '').trim().toLowerCase()
  if (!email) throw new Error('Google did not share an email address for this account.')

  /* Google can return an unverified address on some Workspace configurations.
     Accepting it would undo the single reason this path exists — that the
     address is proven without us having to mail a code to it. */
  const emailVerified = p.email_verified === true || p.email_verified === 'true'
  if (!emailVerified) {
    throw new Error('That Google account has not confirmed its email address yet.')
  }

  return {
    email,
    emailVerified,
    name: String(p.name ?? '').trim(),
    picture: p.picture ? String(p.picture) : null,
    sub: String(p.sub),
  }
}
