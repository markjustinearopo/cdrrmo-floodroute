/* ============================================================
   authOtp.js — client half of the resident verification / two-factor flow.

   Talks to the `auth-otp` Supabase Edge Function. Everything security-relevant
   happens on that side: this file only collects input, solves the proof-of-work
   challenge, and remembers the trusted-device token. No code, secret or hash is
   ever produced or checked here — a control the browser can grade is not a
   control.

   See supabase/functions/auth-otp/index.ts and the migration
   20260826120000_resident_verification_mfa.sql.
   ============================================================ */

import supabase from './supabase.js'

/** Browser-held opaque token proving this device already passed 2FA. */
const DEVICE_KEY = 'cdrrmo_device_token'

export function getDeviceToken() {
  try { return localStorage.getItem(DEVICE_KEY) || '' } catch { return '' }
}
export function setDeviceToken(token) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token)
    else localStorage.removeItem(DEVICE_KEY)
  } catch { /* private mode — the device simply is not remembered */ }
}

/**
 * A short, human-readable name for this device so a resident can recognise it
 * in a future "signed-in devices" list. Deliberately coarse: no fingerprinting,
 * just what the browser already tells every site it visits.
 */
export function deviceLabel() {
  const ua = navigator.userAgent || ''
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux' : 'Unknown'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox' : 'Browser'
  return `${browser} on ${os}`
}

/**
 * Thrown when the `auth-otp` function is not reachable at all — i.e. it has
 * not been deployed yet. Distinguished from a function that answered with an
 * error, because only the first case is allowed to fall back (see
 * `authApi.login` in services/api.js).
 */
export class AuthFunctionUnavailable extends Error {
  constructor(cause) {
    super('The authentication service is not reachable.')
    this.name = 'AuthFunctionUnavailable'
    this.cause = cause
  }
}

/** Invoke the Edge Function and surface its error text as a thrown Error. */
async function call(action, payload = {}) {
  let res
  try {
    res = await supabase.functions.invoke('auth-otp', { body: { action, ...payload } })
  } catch (err) {
    // invoke() itself threw: DNS, offline, or the function does not exist (a
    // missing function fails CORS preflight, which surfaces as a fetch error).
    throw new AuthFunctionUnavailable(err)
  }

  const { data, error } = res
  if (error) {
    /* supabase-js names three cases:
         FunctionsFetchError — the request never completed. A function that is
           not deployed fails CORS preflight, which lands here.
         FunctionsRelayError — the platform could not run it.
         FunctionsHttpError  — it ran and answered non-2xx; `context` is the
           Response, and the function's own message is in the body.
       Only the first two mean "not reachable"; a real rejection must never be
       downgraded into the fallback path. */
    if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError') {
      throw new AuthFunctionUnavailable(error)
    }
    // 404 is also "not deployed" rather than a rejected request.
    if (error.context?.status === 404) throw new AuthFunctionUnavailable(error)

    let message = error.message || 'Something went wrong. Please try again.'
    try {
      const body = await error.context?.json?.()
      if (body?.error) message = body.error
    } catch { /* keep the generic message */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/* ── Proof of work ──────────────────────────────────────────────────────
   The server issues an HMAC-signed challenge and asks for a nonce whose
   SHA-256 starts with `bits` zero bits. At 16 bits that is ~65,000 hashes:
   about a tenth of a second here, and unnoticeable — but it puts a real CPU
   price on every account, which is what makes bulk registration uneconomic.

   Unlike a hosted CAPTCHA this needs no third-party script, no key, and sends
   nothing about the user anywhere. It also does not fail people using screen
   readers, which is the usual cost of image puzzles.
   ─────────────────────────────────────────────────────────────────────── */

function countLeadingZeroBits(bytes) {
  let bits = 0
  for (const b of bytes) {
    if (b === 0) { bits += 8; continue }
    bits += Math.clz32(b) - 24
    break
  }
  return bits
}

/** Ask the server for a fresh challenge. */
export async function requestChallenge() {
  return call('challenge')
}

/**
 * Find a nonce satisfying the challenge. Yields to the event loop every few
 * thousand tries so the page keeps painting and the form stays responsive —
 * a frozen tab reads as a crash, which is worse than the wait it replaces.
 *
 * @param {(n:number)=>void} [onProgress] called with attempts so far
 */
export async function solveChallenge(challenge, bits = 16, onProgress) {
  const encoder = new TextEncoder()
  const [expStr, nonce] = String(challenge).split('.')
  const prefix = `${expStr}.${nonce}.`
  for (let i = 0; i < 50_000_000; i++) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(prefix + i))
    if (countLeadingZeroBits(new Uint8Array(digest)) >= bits) return String(i)
    if (i % 2000 === 1999) {
      onProgress?.(i + 1)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  throw new Error('Human verification could not be completed. Please reload and try again.')
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Create a resident account. The account is created PENDING and a six-digit
 * code is mailed to the address; it is not usable until `verifyEmail` succeeds.
 *
 * The code goes out by SMS when a mobile number was given and the gateway can
 * carry it, by email otherwise; `channel` in the reply says which, so the
 * screen can tell the resident where to look for it.
 *
 * When NEITHER channel can deliver, the server activates the account instead
 * of stranding it and answers { verified, unverifiedFallback, user, notice }.
 *
 * @returns {Promise<{pending?:true,email:string,channel?:string,expiresInMinutes?:number,
 *                    verified?:true,unverifiedFallback?:true,user?:object,notice?:string}>}
 */
export async function registerResident({
  email, password, fullName, barangay, phone, challenge, solution, elapsedMs, website,
}) {
  return call('register', {
    email, password, fullName, barangay, phone, challenge, solution, elapsedMs, website,
  })
}

/** Activate a pending account with the code from the verification email. */
export async function verifyEmail(email, code) {
  return call('verify-email', { email, code })
}

/** Re-send a code. `purpose` is 'verify_email' (default) or 'login_mfa'. */
export async function resendCode(email, purpose = 'verify_email') {
  return call('resend', { email, purpose })
}

/**
 * Password sign-in. Resolves to one of three shapes:
 *   { user }                    — signed in (2FA off, or a trusted device)
 *   { mfaRequired: true, email }— a code has been mailed; call verifyLogin
 *   { unverified: true, email } — account never confirmed its address
 */
export async function login(identifier, password) {
  return call('login', { identifier, password, deviceToken: getDeviceToken() })
}

/** Finish a 2FA sign-in. Stores the device token when `trustDevice` is set. */
export async function verifyLogin(email, code, trustDevice = false) {
  const data = await call('verify-login', {
    email, code, trustDevice, deviceLabel: deviceLabel(),
  })
  if (data?.deviceToken) setDeviceToken(data.deviceToken)
  return data
}

/**
 * Password reset, step 1 — ask for a code.
 *
 * Always resolves the same way whether or not the account exists: the server
 * deliberately gives one answer so the form cannot be used to discover which
 * addresses belong to real CDRRMO officials.
 *
 * @param {string} identifier email or username/Staff ID
 */
export async function requestReset(identifier) {
  return call('request-reset', { identifier })
}

/**
 * Password reset, step 2 — hand back the code with a new password.
 * Resolves to { reset: true, user, token } and the caller starts the session.
 */
export async function confirmReset(email, code, password) {
  return call('confirm-reset', { email, code, password })
}

/** Stop trusting this device (used on sign-out when the user asks). */
export async function forgetDevice() {
  const token = getDeviceToken()
  setDeviceToken('')
  if (token) {
    try { await call('forget-device', { deviceToken: token }) } catch { /* local clear is what matters */ }
  }
}

/* ── Sign in with Google ──────────────────────────────────────────────────
   The browser's half is deliberately thin: it hands the credential Google
   produced straight to the Edge Function and believes nothing about it. All
   the checking that matters — signature, issuer, audience, expiry,
   email_verified — happens server-side in functions/auth-otp/google.ts,
   because anything verified here could simply be skipped by a caller who
   opened the console.
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Step 1 — exchange a Google credential for a session.
 *
 * Resolves to either:
 *   { user, token }                        known account, signed in
 *   { needsBarangay: true, ticket, email, fullName, picture }
 *                                          first time here; the ticket is an
 *                                          HMAC-signed, ten-minute assertion
 *                                          that Google vouched for `email`.
 *                                          Pass it to completeGoogleSignUp.
 */
export async function googleSignIn(credential) {
  return call('google', { credential })
}

/**
 * Step 2 — finish a first-time Google sign-up by naming a barangay.
 *
 * The email is NOT sent again: it is read out of the signed ticket server-side.
 * A client that could name its own address here could register as anybody.
 */
export async function completeGoogleSignUp(ticket, barangay) {
  return call('google-complete', { ticket, barangay })
}
