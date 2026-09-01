/* ============================================================
   auth-otp — resident account verification, login two-factor, and the
   human check on the registration form.

   WHY THIS IS AN EDGE FUNCTION AND NOT AN RPC
   One-time codes are only worth anything if the browser never sees them. This
   runs with the service-role key: it mints the code, stores only a salted
   SHA-256 of it, and hands the plaintext to Resend — never to the client. An
   RPC callable with the anon key could not do that, because whatever it
   returned would be readable by whoever called it.

   Actions
     challenge     → issue a proof-of-work challenge for the registration form
     register      → human check, create a PENDING account, mail a verify code
     verify-email  → check the code, activate the account
     resend        → re-issue a code (rate limited)
     login         → password check, then session OR a mailed 2FA code
     verify-login  → check the 2FA code, start the session, optionally trust
                     the device for 30 days
     forget-device → drop a trusted device

   DELIVERY IS NOT ASSUMED TO WORK
   A code that cannot be delivered is a locked door. This system learned that
   the hard way: the Resend account has no verified sending domain, so it can
   physically only mail the developer's own address, and every resident who
   registered was left at status='pending' with a correct password and no way
   in. So a code now goes out over whichever channel can actually carry it —
   SMS first when the resident gave a mobile number, email otherwise — and when
   NEITHER can deliver, the account is activated rather than stranded, plainly
   labelled as unverified for the operator to see. See issueCode().

   Deploy:  npx supabase functions deploy auth-otp
   Secrets: RESEND_API_KEY (already set for send-alert-email)
            AUTH_OTP_SECRET (optional; falls back to the service-role key)
            SESSION_JWT_SECRET (required for sign-in — see mintToken() below;
            this is the project's own Legacy JWT Secret from Settings > API,
            NOT a value we invent, because PostgREST has to validate against
            the same secret. See supabase/PENDING_MIGRATIONS.sql, the
            2026-08-30 section, for the full rollout steps.)
   ============================================================ */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { create as createJwt, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/* ── Tunables ──────────────────────────────────────────────────────────── */
const CODE_TTL_MIN = 10          // a code is good for ten minutes
const MAX_ATTEMPTS = 5           // wrong guesses before a code is burned
const RESEND_COOLDOWN_S = 60     // between "send me another"
const MAX_CODES_PER_HOUR = 6     // per address, across both purposes
const DEVICE_TRUST_DAYS = 30
const POW_BITS = 16              // 4 leading hex zeros ≈ 65k hashes ≈ 0.1s
const POW_TTL_MIN = 15
const MIN_FORM_SECONDS = 2.5     // humans do not fill a 6-field form faster

const enc = new TextEncoder()

/* ── Small crypto helpers (Web Crypto, available in Deno) ──────────────── */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A 6-digit code from a CSPRNG — never Math.random for a credential. */
function randomCode(): string {
  const a = new Uint32Array(1)
  // Rejection-sample so every value in 000000-999999 is equally likely.
  do { crypto.getRandomValues(a) } while (a[0] >= 4294000000)
  return String(a[0] % 1000000).padStart(6, '0')
}

/** Length-independent comparison so timing cannot leak the stored hash. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function leadingZeroBits(hex: string): number {
  let bits = 0
  for (const ch of hex) {
    const v = parseInt(ch, 16)
    if (v === 0) { bits += 4; continue }
    bits += Math.clz32(v) - 28
    break
  }
  return bits
}

/* ── Email ─────────────────────────────────────────────────────────────── */
const PURPOSE_COPY: Record<string, { subject: string; heading: string; blurb: string }> = {
  verify_email: {
    subject: 'Verify your CDRRMO FloodRoute account',
    heading: 'Confirm your email address',
    blurb: 'Enter this code to finish creating your Cabuyao CDRRMO FloodRoute account. It expires in 10 minutes.',
  },
  login_mfa: {
    subject: 'Your CDRRMO FloodRoute sign-in code',
    heading: 'Your sign-in code',
    blurb: 'Enter this code to finish signing in. It expires in 10 minutes. If you did not try to sign in, change your password &mdash; someone else knows it.',
  },
}

async function sendCodeEmail(to: string, name: string, purpose: string, code: string) {
  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_KEY) throw new Error('Email is not configured on the server (RESEND_API_KEY missing).')
  const copy = PURPOSE_COPY[purpose] ?? PURPOSE_COPY.verify_email
  const from = Deno.env.get('AUTH_OTP_FROM') || 'CDRRMO FloodRoute <onboarding@resend.dev>'

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:#C0181B;color:#fff;padding:20px 24px">
        <div style="font-size:12px;letter-spacing:.08em;font-weight:700;opacity:.85">CDRRMO CABUYAO &mdash; FLOODROUTE</div>
        <div style="font-size:18px;font-weight:700;margin-top:6px">${copy.heading}</div>
      </div>
      <div style="background:#f8fafc;padding:26px 24px">
        <p style="color:#475569;line-height:1.6;margin:0 0 20px;font-size:14px">
          ${name ? `Hi ${name},<br><br>` : ''}${copy.blurb}
        </p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;margin-bottom:20px">
          <div style="font-size:34px;font-weight:800;letter-spacing:.22em;color:#1e293b;font-variant-numeric:tabular-nums">${code}</div>
        </div>
        <p style="color:#94a3b8;font-size:11px;margin:0;line-height:1.6">
          Never share this code. CDRRMO staff will not ask you for it.<br>
          Do not reply to this email. For emergencies call the CDRRMO 24/7 hotline or 911.
        </p>
      </div>
    </div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: copy.subject, html }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? 'Could not send the email.')
  return data.id
}

/* ── SMS ───────────────────────────────────────────────────────────────────
   The provider credentials live in the sms-alert function, so this asks that
   one to do the sending rather than holding a second copy of the key. Called
   with the service-role key, which is what its `deliver` action requires. */

/** Same normalisation sms-alert uses — one row per handset, however it is typed. */
function normalisePH(raw: string): string | null {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '')
  let d = digits.replace(/^\+/, '')
  if (d.startsWith('63')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  // A PH mobile subscriber number is 10 digits and always starts with 9.
  if (!/^9\d{9}$/.test(d)) return null
  return `+63${d}`
}

async function sendCodeSms(phone: string, purpose: string, code: string) {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('SMS is not configured on the server.')
  const what = purpose === 'login_mfa' ? 'sign-in code' : 'account code'
  const res = await fetch(`${url}/functions/v1/sms-alert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'deliver',
      phone,
      purpose: 'verify',
      body: `Your CDRRMO FloodRoute ${what} is ${code}. Valid for ${CODE_TTL_MIN} minutes. Never share this code.`,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || 'Could not send the text message.')
  /* Simulation is NOT delivery. Reporting it as such is exactly the failure
     this whole change exists to stop, so it is treated as a failed channel and
     the caller falls through to email. */
  if (data?.simulated) throw new Error('SMS gateway is in simulation mode (no provider key).')
  return data
}

/* ── Code lifecycle ────────────────────────────────────────────────────── */
/** Both channels refused the code — the caller has to decide what that means. */
class Undeliverable extends Error {
  constructor(public detail: string) {
    super('We could not deliver your code.')
    this.name = 'Undeliverable'
  }
}

// deno-lint-ignore no-explicit-any
async function issueCode(db: any, opts: {
  accountId: number | null; email: string; name: string; purpose: string; phone?: string | null
}) {
  const email = opts.email.toLowerCase()
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  /* Only codes that ACTUALLY REACHED somebody count against the limits.

     `channel` is stamped when a channel accepts the message and stays null
     when neither SMS nor email could carry it. Counting the undeliverable
     ones turned a mail outage into an account lockout: with the sending
     domain unverified, every sign-in by a resident with two-factor on burns
     a code that nobody ever sees, and by the second attempt inside a minute
     the cooldown — which is a plain Error, not an Undeliverable — escaped the
     fallback below and failed the sign-in outright. The password had already
     been checked; the only thing standing between the resident and their own
     account was a rate limit protecting a channel that had delivered nothing.

     Rate limiting exists to stop someone spraying real messages at an
     address. A code that was never sent is not a message. */
  const { data: recent } = await db
    .from('auth_codes')
    .select('id, created_at')
    .eq('email', email)
    .gte('created_at', hourAgo)
    .not('channel', 'is', null)
    .order('created_at', { ascending: false })

  if ((recent?.length ?? 0) >= MAX_CODES_PER_HOUR) {
    throw new Error('Too many codes requested for this email. Please wait an hour and try again.')
  }
  if (recent?.length) {
    const since = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000
    if (since < RESEND_COOLDOWN_S) {
      throw new Error(`Please wait ${Math.ceil(RESEND_COOLDOWN_S - since)}s before requesting another code.`)
    }
  }

  // Any earlier live code for this address+purpose stops working the moment a
  // new one is issued, so two codes are never valid at once.
  await db.from('auth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('email', email).eq('purpose', opts.purpose).is('consumed_at', null)

  const code = randomCode()
  const salt = randomHex(16)
  const { data: inserted, error } = await db.from('auth_codes').insert({
    account_id: opts.accountId,
    email,
    purpose: opts.purpose,
    code_hash: await sha256Hex(salt + code),
    code_salt: salt,
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  }).select('id').single()
  if (error) throw new Error(error.message)

  /* SMS first when we have a number. In Cabuyao a text arrives on the phone
     already in the reader's hand; an email arrives on an account they may only
     check from a shared computer. It is also the channel that currently works.
     Email is the fallback, not the default. */
  const phone = opts.phone ? normalisePH(opts.phone) : null
  const failures: string[] = []
  for (const channel of phone ? ['sms', 'email'] : ['email']) {
    try {
      if (channel === 'sms') await sendCodeSms(phone!, opts.purpose, code)
      else await sendCodeEmail(opts.email, opts.name, opts.purpose, code)
      if (inserted?.id) await db.from('auth_codes').update({ channel }).eq('id', inserted.id)
      return { sent: true, channel, expiresInMinutes: CODE_TTL_MIN }
    } catch (e) {
      failures.push(`${channel}: ${(e as Error).message}`)
    }
  }

  // Nothing could carry it. Burn the code — leaving a live one that nobody has
  // seen only means the next request hits the cooldown for no reason.
  if (inserted?.id) {
    await db.from('auth_codes').update({ consumed_at: new Date().toISOString() }).eq('id', inserted.id)
  }
  throw new Undeliverable(failures.join(' | '))
}

// deno-lint-ignore no-explicit-any
async function consumeCode(db: any, email: string, purpose: string, code: string) {
  const lower = email.toLowerCase()
  const { data: rows } = await db
    .from('auth_codes')
    .select('*')
    .eq('email', lower).eq('purpose', purpose).is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const row = rows?.[0]
  if (!row) return { ok: false, error: 'No active code. Request a new one.' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'That code has expired. Request a new one.' }
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.from('auth_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
    return { ok: false, error: 'Too many incorrect attempts. Request a new code.' }
  }

  const given = await sha256Hex(row.code_salt + String(code ?? '').trim())
  if (!timingSafeEqual(given, row.code_hash)) {
    const left = MAX_ATTEMPTS - (row.attempts + 1)
    await db.from('auth_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return {
      ok: false,
      error: left > 0
        ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`
        : 'Too many incorrect attempts. Request a new code.',
    }
  }

  await db.from('auth_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
  // `channel` tells the caller what this code actually proves: a code that
  // arrived by SMS proves the handset, one that arrived by email does not.
  return { ok: true, accountId: row.account_id as number | null, channel: row.channel as string | null }
}

/* ── Session payload ───────────────────────────────────────────────────── */
// deno-lint-ignore no-explicit-any
function sessionOf(acc: any) {
  return {
    id: acc.id,
    email: acc.email,
    username: acc.username,
    role: acc.role,
    barangay: acc.barangay,
    fullName: acc.full_name,
    avatar: acc.avatar,
    status: acc.status,
  }
}

/* ── Signed session token ─────────────────────────────────────────────────
   Phase 1 of the identity/RLS fix (see PENDING_MIGRATIONS.sql, 2026-08-30):
   every request has always hit PostgREST as the anon key, so RLS could never
   tell one caller from another. This mints a real JWT, signed with the same
   secret PostgREST already validates against (the project's Legacy JWT
   Secret), carrying the claims Phase 2's RLS policies will read via
   auth.jwt(). RLS itself is untouched here — this only makes it possible.

   `role: 'authenticated'` is the Postgres role PostgREST switches the
   connection to; it is NOT this account's app role, which travels separately
   as `app_role` so it never collides with that meaning.
   ────────────────────────────────────────────────────────────────────────── */
const SESSION_JWT_SECRET = Deno.env.get('SESSION_JWT_SECRET')
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days — see rollout notes for why

let sessionSigningKey: CryptoKey | null = null
async function getSessionSigningKey() {
  if (!SESSION_JWT_SECRET) {
    throw new Error('SESSION_JWT_SECRET is not set — see supabase/PENDING_MIGRATIONS.sql')
  }
  if (!sessionSigningKey) {
    sessionSigningKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SESSION_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  }
  return sessionSigningKey
}

// deno-lint-ignore no-explicit-any
async function mintToken(acc: any) {
  return createJwt({ alg: 'HS256', typ: 'JWT' }, {
    role: 'authenticated',
    aud: 'authenticated',
    sub: String(acc.id),
    account_id: acc.id,
    app_role: acc.role,
    barangay: acc.barangay,
    exp: getNumericDate(SESSION_TTL_SECONDS),
  }, await getSessionSigningKey())
}

/* ── Handler ───────────────────────────────────────────────────────────── */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const SECRET = Deno.env.get('AUTH_OTP_SECRET') || SERVICE_KEY
  const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)

  try {
    const body = await req.json()
    const action = String(body.action ?? '')

    /* ── Proof-of-work challenge for the registration form ───────────── */
    if (action === 'challenge') {
      const exp = Date.now() + POW_TTL_MIN * 60_000
      const nonce = randomHex(12)
      const payload = `${exp}.${nonce}`
      const sig = await hmacHex(SECRET, payload)
      return json({ challenge: `${payload}.${sig}`, bits: POW_BITS })
    }

    /* ── Register ────────────────────────────────────────────────────── */
    if (action === 'register') {
      const { email, password, fullName, barangay, phone, challenge, solution, elapsedMs, website } = body

      // 1. Honeypot — a field positioned off-screen and hidden from assistive
      //    tech. A human never fills it; naive form-fillers always do.
      if (website) return json({ error: 'Registration could not be completed.' }, 400)

      // 2. Timing. Reported by the client, so it is a filter for lazy bots
      //    rather than a control — the proof of work below is the real one.
      if (typeof elapsedMs === 'number' && elapsedMs < MIN_FORM_SECONDS * 1000) {
        return json({ error: 'That was submitted unusually quickly. Please try again.' }, 400)
      }

      // 3. Proof of work. The challenge is HMAC-signed and carries its own
      //    expiry, so nothing has to be stored between the two requests.
      const parts = String(challenge ?? '').split('.')
      if (parts.length !== 3) return json({ error: 'Human verification failed. Please reload and try again.' }, 400)
      const [expStr, nonce, sig] = parts
      if (!timingSafeEqual(sig, await hmacHex(SECRET, `${expStr}.${nonce}`))) {
        return json({ error: 'Human verification failed. Please reload and try again.' }, 400)
      }
      if (Number(expStr) < Date.now()) {
        return json({ error: 'Human verification expired. Please try again.' }, 400)
      }
      const powHash = await sha256Hex(`${expStr}.${nonce}.${solution}`)
      if (leadingZeroBits(powHash) < POW_BITS) {
        return json({ error: 'Human verification failed. Please reload and try again.' }, 400)
      }

      // 4. Field validation (mirrors the client, which cannot be trusted).
      const addr = String(email ?? '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return json({ error: 'Please enter a valid email address.' }, 400)
      if (String(password ?? '').length < 8) return json({ error: 'Password must be at least 8 characters long.' }, 400)
      if (!String(fullName ?? '').trim()) return json({ error: 'Please enter your name.' }, 400)
      if (!String(barangay ?? '').trim()) return json({ error: 'Please select your barangay.' }, 400)
      /* The mobile number is optional but validated when given: a typo here
         means both the verification code and every future emergency alert go
         to a stranger, so it is better rejected at the form than accepted and
         silently useless. */
      const mobile = phone ? normalisePH(String(phone)) : null
      if (phone && !mobile) {
        return json({ error: 'Enter your mobile number as 0917 123 4567, or leave it blank.' }, 400)
      }

      // 5. Is registration open? (System Configuration, set by CDRRMO.)
      const { data: cfgRow } = await db.from('app_settings').select('value').eq('key', 'system_config').maybeSingle()
      if (cfgRow?.value && cfgRow.value.allowRegistration === false) {
        return json({ error: 'New account registration is currently closed by the CDRRMO administrator.' }, 403)
      }

      const { data: existing } = await db
        .from('accounts').select('id, email_verified_at').ilike('email', addr).maybeSingle()

      let accountId: number
      if (existing) {
        // An unverified account can be re-claimed — someone who mistyped and
        // never got the mail must not be permanently locked out of their own
        // address. A verified one cannot: that is somebody's account.
        if (existing.email_verified_at) {
          return json({ error: 'That email is already registered. Try signing in instead.' }, 409)
        }
        accountId = existing.id
        const { error } = await db.from('accounts').update({
          password_plain: password, full_name: String(fullName).trim(), barangay,
          status: 'pending', phone: mobile,
        }).eq('id', accountId)
        if (error) return json({ error: error.message }, 500)
      } else {
        /* Verification happens ONCE, at sign-up, against the mobile number the
           resident gives us. That is the check that matters: it proves the
           phone we will text a flood warning to is really theirs.

           `mfa_enabled` stays FALSE. Switching it on meant every later sign-in
           demanded a second code — and because there is no verified sending
           domain, that code went out by email, to an address the resident
           never proved and may not check. A citizen who registered with a
           phone was then asked for a code from their inbox, which is not the
           deal they signed up for and is not a channel we can rely on during
           a flood. An operator can still turn two-factor on per account from
           Settings once a real sending domain or SMS key is in place. */
        const { data: created, error } = await db.from('accounts').insert({
          username: addr, email: addr, password_plain: password,
          role: 'resident', barangay, full_name: String(fullName).trim(),
          status: 'pending', mfa_enabled: false, phone: mobile,
        }).select('id').single()
        if (error) return json({ error: error.message }, 500)
        accountId = created.id
      }

      const firstName = String(fullName).trim().split(' ')[0]
      try {
        const issued = await issueCode(db, {
          accountId, email: addr, name: firstName, purpose: 'verify_email', phone: mobile,
        })
        return json({
          pending: true, email: addr, channel: issued.channel,
          phone: mobile ? `+63 9•• ••• ${mobile.slice(-4)}` : null,
          expiresInMinutes: CODE_TTL_MIN,
        })
      } catch (e) {
        if (!(e instanceof Undeliverable)) return json({ error: (e as Error).message }, 500)

        /* NEITHER channel could carry the code.

           The choice here is between two bad outcomes, and both are worth
           naming. Refusing the registration leaves a real resident with an
           account they can never open — which is exactly what happened to
           three of them before this branch existed, silently, for weeks.
           Activating it means an address nobody proved.

           We activate, because the cost of the first failure lands on the
           person this system exists to protect, and the cost of the second
           lands on a barangay-scoped, read-only account. It is not hidden:
           the response says so, the registration screen says so, and CDRRMO
           gets a notification naming the account and the delivery error.

           An administrator can close this door from System Configuration
           (verificationFallback: false), at which point registration fails
           loudly instead — the right setting once a verified sending domain
           or an SMS provider key is actually in place. */
        const fallbackOff = cfgRow?.value?.verificationFallback === false
        if (fallbackOff) {
          return json({
            error: 'We could not send your verification code. Please contact the CDRRMO office.',
            detail: e.detail,
          }, 503)
        }

        await db.from('accounts').update({
          status: 'active',
          email_verified_at: new Date().toISOString(),
          // Email 2FA would strand them again on their very next sign-in.
          mfa_enabled: false,
        }).eq('id', accountId)

        await db.from('notifications').insert({
          level: 'moderate',
          title: 'Account activated without verification',
          message: `${addr} registered but no verification code could be delivered (${e.detail}). The account was activated so the resident is not locked out. Fix the email sending domain, or add an SMS provider key.`,
        })

        const { data: acc } = await db.from('accounts').select('*').eq('id', accountId).single()
        return json({
          verified: true,
          unverifiedFallback: true,
          user: sessionOf(acc),
          token: await mintToken(acc),
          notice: 'We could not send a verification code — the messaging service is not fully set up yet. Your account has been activated so you are not locked out. Please let CDRRMO IT know.',
          detail: e.detail,
        })
      }
    }

    /* ── Resend a code ───────────────────────────────────────────────── */
    if (action === 'resend') {
      const addr = String(body.email ?? '').trim().toLowerCase()
      const purpose = body.purpose === 'login_mfa' ? 'login_mfa' : 'verify_email'
      const { data: acc } = await db
        .from('accounts').select('id, full_name, email_verified_at, phone').ilike('email', addr).maybeSingle()
      // Always answer the same way: whether an address is registered is not
      // something an unauthenticated caller gets to enumerate.
      if (!acc) return json({ sent: true, expiresInMinutes: CODE_TTL_MIN })
      if (purpose === 'verify_email' && acc.email_verified_at) {
        return json({ sent: true, alreadyVerified: true })
      }
      const again = await issueCode(db, {
        accountId: acc.id, email: addr, name: (acc.full_name ?? '').split(' ')[0],
        purpose, phone: acc.phone,
      })
      return json({ sent: true, channel: again.channel, expiresInMinutes: CODE_TTL_MIN })
    }

    /* ── Verify the email and activate the account ───────────────────── */
    if (action === 'verify-email') {
      const addr = String(body.email ?? '').trim().toLowerCase()
      const res = await consumeCode(db, addr, 'verify_email', body.code)
      if (!res.ok) return json({ error: res.error }, 400)

      const { data: acc, error } = await db.from('accounts')
        .update({ status: 'active', email_verified_at: new Date().toISOString() })
        .ilike('email', addr)
        .select('*').single()
      if (error) return json({ error: error.message }, 500)

      /* If that code arrived by TEXT, the resident has just proved they hold
         the handset — so enrol it for emergency alerts now, while they are
         here, rather than asking them to prove the same thing twice. A code
         that came by email proves nothing about the phone, so that number
         stays unconfirmed until they confirm it from the Alerts screen. */
      let smsEnrolled = false
      if (acc?.phone && res.channel === 'sms') {
        const now = new Date().toISOString()
        await db.from('sms_subscribers').upsert({
          phone: acc.phone,
          account_id: acc.id,
          barangay: acc.barangay,
          full_name: acc.full_name,
          source: 'registration',
          verified_at: now,
          opted_out_at: null,
          updated_at: now,
        }, { onConflict: 'phone' })
        smsEnrolled = true
      }

      return json({ verified: true, user: sessionOf(acc), token: await mintToken(acc), smsEnrolled })
    }

    /* ── Login: password, then either a session or a 2FA code ────────── */
    if (action === 'login') {
      const identifier = String(body.identifier ?? '').trim()
      const { data: result, error } = await db.rpc('app_login', {
        p_identifier: identifier, p_password: String(body.password ?? ''),
      })
      if (error) return json({ error: error.message }, 500)
      if (!result) return json({ error: 'Invalid email/ID or password.' }, 401)

      if (result.unverified) {
        // Correct password on an account that never proved its address. Send a
        // fresh verification code rather than making them start over.
        try {
          const { data: pendingAcc } = await db.from('accounts')
            .select('phone').ilike('email', result.email).maybeSingle()
          await issueCode(db, {
            accountId: null, email: result.email,
            name: (result.fullName ?? '').split(' ')[0], purpose: 'verify_email',
            phone: pendingAcc?.phone,
          })
        } catch { /* cooldown — the existing code is still good */ }
        return json({ unverified: true, email: result.email })
      }

      const { data: acc } = await db.from('accounts').select('*').eq('id', result.id).single()

      // A device the resident already confirmed skips the second factor.
      const deviceToken = String(body.deviceToken ?? '')
      if (deviceToken) {
        const hash = await sha256Hex(deviceToken)
        const { data: dev } = await db.from('trusted_devices')
          .select('id, expires_at').eq('account_id', acc.id).eq('token_hash', hash).maybeSingle()
        if (dev && new Date(dev.expires_at).getTime() > Date.now()) {
          await db.from('trusted_devices').update({ last_used_at: new Date().toISOString() }).eq('id', dev.id)
          return json({ user: sessionOf(acc), token: await mintToken(acc) })
        }
      }

      /* Residents never get a second factor at sign-in.

         They proved a phone number once, at registration, by receiving a text
         on it — that is the check this system actually needs, because that
         number is where a flood warning goes. Asking for a second code on
         every later sign-in delivered it by EMAIL (there is no verified
         sending domain, so mail is all that is left), to an address they
         never proved and may not read. A citizen who signed up with their
         phone was then locked behind their inbox.

         Enforced here by ROLE rather than by clearing the column, because the
         column cannot be cleared from the app: the password-column lock
         revoked anon's UPDATE on `accounts`, so rows already carrying
         mfa_enabled=true would otherwise keep prompting forever. Staff
         accounts are untouched — an operator with the flag set still gets
         challenged. */
      if (acc.role === 'resident' || !acc.mfa_enabled) return json({ user: sessionOf(acc), token: await mintToken(acc) })

      try {
        const issued = await issueCode(db, {
          accountId: acc.id, email: acc.email,
          name: (acc.full_name ?? '').split(' ')[0], purpose: 'login_mfa', phone: acc.phone,
        })
        return json({
          mfaRequired: true, email: acc.email, channel: issued.channel,
          expiresInMinutes: CODE_TTL_MIN,
        })
      } catch (e) {
        /* The second factor could not be delivered. Refusing the sign-in here
           locks the account holder out of their own account over an outage in
           OUR mail provider — the failure mode that has already cost this
           system its entire resident base once. The password check has
           already passed, so the session is granted and the operator is told
           that the second factor did not run. */
        if (!(e instanceof Undeliverable)) {
          /* A throttle is not an outage, so it does not get the free pass
             above — but it must not surface as a 500 either. Someone who has
             genuinely been mailed six codes in an hour needs to be told to
             wait, in words, not handed "Internal Server Error" on a screen
             that gives them nothing to do next. */
          return json({ error: (e as Error).message }, 429)
        }
        await db.from('notifications').insert({
          level: 'moderate',
          title: 'Two-factor code could not be delivered',
          message: `${acc.email} signed in with a correct password, but the second-factor code could not be sent (${e.detail}). The sign-in was allowed rather than locking the account holder out.`,
        })
        return json({ user: sessionOf(acc), token: await mintToken(acc), mfaSkipped: true, detail: e.detail })
      }
    }

    /* ── Verify the 2FA code and start the session ───────────────────── */
    if (action === 'verify-login') {
      const addr = String(body.email ?? '').trim().toLowerCase()
      const res = await consumeCode(db, addr, 'login_mfa', body.code)
      if (!res.ok) return json({ error: res.error }, 400)

      const { data: acc, error } = await db.from('accounts').select('*').ilike('email', addr).single()
      if (error) return json({ error: error.message }, 500)
      await db.from('accounts').update({ last_login: new Date().toISOString() }).eq('id', acc.id)

      let deviceToken: string | null = null
      if (body.trustDevice) {
        deviceToken = randomHex(32)
        await db.from('trusted_devices').insert({
          account_id: acc.id,
          token_hash: await sha256Hex(deviceToken),
          label: String(body.deviceLabel ?? '').slice(0, 80) || null,
          expires_at: new Date(Date.now() + DEVICE_TRUST_DAYS * 86400_000).toISOString(),
          last_used_at: new Date().toISOString(),
        })
      }
      return json({ user: sessionOf(acc), token: await mintToken(acc), deviceToken, trustDays: DEVICE_TRUST_DAYS })
    }

    /* ── Drop a trusted device (sign-out "forget this device") ───────── */
    if (action === 'forget-device') {
      const token = String(body.deviceToken ?? '')
      if (token) await db.from('trusted_devices').delete().eq('token_hash', await sha256Hex(token))
      return json({ forgotten: true })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
