/* ============================================================
   sms-alert — emergency SMS for Cabuyao CDRRMO FloodRoute.

   WHY AN EDGE FUNCTION
   Two reasons, both non-negotiable. First, the provider API key must never
   reach a browser — anyone holding it can send from the city's sender ID.
   Second, residents' mobile numbers must never be bulk-readable, and the anon
   key that the deployed site ships with would make them exactly that. So the
   subscriber table is locked to the service role and every number that leaves
   this function is MASKED (+63 9•• ••• 1234).

   Actions
     subscribe    → opt a number in, text it a 6-digit confirmation code
     verify       → check that code, activate the subscription
     status       → is this number subscribed / verified? (single number only)
     unsubscribe  → opt out; the row is kept so the opt-out is provable
     broadcast    → text every verified number in a barangay (an alert)
     test         → text one number, to prove the provider works
     outbox       → recent sends, numbers masked (the admin audit panel)
     stats        → subscriber counts per barangay
     config       → which provider is configured, without revealing the key
     account-code → mint + text a code for ACCOUNT verification
     deliver      → SERVICE-ROLE ONLY: text a message another function composed
                    (auth-otp uses this so account codes keep living in one
                    store instead of two)

   PROVIDERS
     semaphore   Philippine gateway. Delivers to any PH number, sender IDs are
                 approved per account, ~P0.56/text. The right choice for a
                 funded Cabuyao deployment, and preferred whenever its key is
                 set.
     textbee     An Android phone with a PH SIM, driven over HTTP. Free to
                 300 messages/month. Chosen because every cloud API that
                 reaches PH numbers costs money and this office had none — it
                 makes the channel real today. Depends on that handset staying
                 charged and in signal, and sends from a mobile number rather
                 than a sender ID, so it suits verification codes better than
                 citywide alerts. See sendTextBee().
     twilio      Works anywhere, but a trial account can only text numbers you
                 have verified in its console — a demo channel, not a city one.
     simulation  No key configured. Every message is still written to
                 sms_messages, with status='simulated', and the admin panel
                 labels it as not delivered. The pipeline is testable without
                 spending a centavo; nobody is misled into thinking a handset
                 was reached.

   Deploy:  npx supabase functions deploy sms-alert
   Secrets: SMS_PROVIDER=semaphore|textbee|twilio  (default: auto-detect, else simulation)
            SEMAPHORE_API_KEY, SEMAPHORE_SENDER_NAME
            TEXTBEE_API_KEY, TEXTBEE_DEVICE_ID (device id optional)
            TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
   ============================================================ */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/* ── Tunables ──────────────────────────────────────────────────────────── */
const CODE_TTL_MIN = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_S = 60
const MAX_CODES_PER_HOUR = 5
/* A broadcast bigger than this is refused rather than half-sent. A runaway
   loop against a paid gateway is a bill; against a free trial it is an outage
   in the middle of the emergency it was meant to serve. */
const MAX_BROADCAST = 2000
/* SMS is billed per 160-character part. Alerts are trimmed so one warning is
   one message — a truncated second part that never arrives is worse than a
   shorter first one that does. */
const MAX_BODY = 300

const enc = new TextEncoder()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomCode(): string {
  const a = new Uint32Array(1)
  do { crypto.getRandomValues(a) } while (a[0] >= 4294000000)
  return String(a[0] % 1000000).padStart(6, '0')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/* ── Philippine mobile numbers ─────────────────────────────────────────────
   Residents type 09171234567, 0917 123 4567, +639171234567 or 639171234567,
   and every one of those is the same phone. Normalise to E.164 once, here, so
   the unique index on `phone` actually means one row per person. */
function normalisePH(raw: string): string | null {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '')
  let d = digits.replace(/^\+/, '')
  if (d.startsWith('63')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  // A PH mobile subscriber number is 10 digits and always starts with 9.
  if (!/^9\d{9}$/.test(d)) return null
  return `+63${d}`
}

/** +639171234567 → "+63 9•• ••• 4567". Enough to recognise your own number. */
function mask(phone: string): string {
  const d = phone.replace(/\D/g, '')
  const last4 = d.slice(-4)
  return `+63 9•• ••• ${last4}`
}

/* ── Providers ─────────────────────────────────────────────────────────── */
/* `queued` means the provider ACCEPTED the message but has not sent it yet, so
   it is not evidence a handset was reached. textbee is the case that forced
   this distinction: it answers HTTP 200 "SMS added to queue for processing"
   and only later hands the message to the phone, which can then fail on its
   own — the gateway handset losing cellular service is the normal way this
   happens, and it happened here. Recording that 200 as 'sent' would put a
   confident "resident warned" row in the outbox for a text that never left the
   building, which is the one failure this system cannot afford. */
type SendResult = {
  ok: boolean
  provider: string
  error?: string
  simulated?: boolean
  queued?: boolean
}

function activeProvider(): 'semaphore' | 'textbee' | 'twilio' | 'simulation' {
  const forced = (Deno.env.get('SMS_PROVIDER') || '').toLowerCase()
  if (forced === 'semaphore' && Deno.env.get('SEMAPHORE_API_KEY')) return 'semaphore'
  if (forced === 'textbee' && Deno.env.get('TEXTBEE_API_KEY')) return 'textbee'
  if (forced === 'twilio' && Deno.env.get('TWILIO_ACCOUNT_SID')) return 'twilio'
  if (forced === 'simulation') return 'simulation'
  /* Nothing forced: use whatever is actually configured. Semaphore outranks
     textbee when both are set — a telco gateway does not depend on a handset
     staying charged, which matters more the worse the flood gets. */
  if (Deno.env.get('SEMAPHORE_API_KEY')) return 'semaphore'
  if (Deno.env.get('TEXTBEE_API_KEY')) return 'textbee'
  if (Deno.env.get('TWILIO_ACCOUNT_SID') && Deno.env.get('TWILIO_AUTH_TOKEN')) return 'twilio'
  return 'simulation'
}

async function sendSemaphore(to: string, body: string): Promise<SendResult> {
  const apikey = Deno.env.get('SEMAPHORE_API_KEY')!
  const sendername = Deno.env.get('SEMAPHORE_SENDER_NAME') || 'SEMAPHORE'
  // Semaphore takes the local 09… form as happily as E.164; send E.164 minus
  // the plus, which it accepts and which keeps our records unambiguous.
  const number = to.replace(/^\+/, '')
  const res = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey, number, message: body, sendername }),
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, provider: 'semaphore', error: `${res.status} ${text.slice(0, 200)}` }
  /* Semaphore answers 200 with a per-message array even when it rejected the
     message (insufficient credit, unapproved sender). Read the status rather
     than trusting the HTTP code. */
  try {
    const parsed = JSON.parse(text)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    const status = String(first?.status ?? '').toLowerCase()
    if (status === 'failed' || status === 'refunded') {
      return { ok: false, provider: 'semaphore', error: `provider said "${status}"` }
    }
  } catch {
    /* Unparseable 200 — treat as sent; the outbox records the raw outcome. */
  }
  return { ok: true, provider: 'semaphore' }
}

async function sendTwilio(to: string, body: string): Promise<SendResult> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from = Deno.env.get('TWILIO_FROM') || ''
  const form = new URLSearchParams({ To: to, From: from, Body: body })
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 200)
    try { msg = JSON.parse(text).message ?? msg } catch { /* keep the raw text */ }
    return { ok: false, provider: 'twilio', error: `${res.status} ${msg}` }
  }
  return { ok: true, provider: 'twilio' }
}

/* textbee — an Android handset with a Philippine SIM, driven over HTTP.

   Why it is here: every cloud SMS API that reaches PH numbers is paid, and
   this office had no budget to start one. textbee sends through a phone the
   CDRRMO already owns, on a normal load promo, so the channel can be switched
   on today instead of after a procurement cycle.

   What that costs, stated plainly rather than discovered during a typhoon:
     · The phone has to stay charged, unlocked enough to run the app, and in
       signal. It is a single point of failure sitting in the same city as the
       flood being warned about.
     · Messages arrive from a personal mobile number, not a "CDRRMO" sender
       ID, so they carry less authority than an official alert should.
     · PH telcos throttle bulk sending from consumer SIMs under anti-spam
       rules. Fine for verification codes; a citywide blast can get the SIM
       flagged.

   So this is the right provider for OTPs and small barangay-level warnings,
   and Semaphore is the right one for citywide alerts — which is why
   activeProvider() prefers Semaphore whenever it is configured. */
async function sendTextBee(to: string, body: string): Promise<SendResult> {
  const apikey = Deno.env.get('TEXTBEE_API_KEY')!
  const deviceId = Deno.env.get('TEXTBEE_DEVICE_ID') || ''
  /* textbee wants E.164 WITH the leading plus — the opposite of Semaphore.
     normalisePH() already produced exactly that, so it goes out untouched. */
  const payload: Record<string, unknown> = { recipients: [to], message: body }
  if (deviceId) payload.deviceId = deviceId

  const res = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
    method: 'POST',
    headers: { 'x-api-key': apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text.slice(0, 200)
    try {
      const parsed = JSON.parse(text)
      msg = parsed?.message ?? parsed?.error ?? msg
      if (Array.isArray(msg)) msg = msg.join('; ')
    } catch { /* keep the raw text */ }
    /* The failure people actually hit: the phone is off, offline, unpaired, or
       the app was killed by battery optimisation, so no device has sent a
       heartbeat. Matched on the message rather than the status code —
       textbee answers 400 for "no enabled device" and 404 for an unknown
       deviceId, and an operator reading the delivery log needs the same
       actionable sentence either way. */
    const noDevice = /no\s+(enabled\s+)?device/i.test(String(msg)) || res.status === 404
    if (noDevice) {
      return {
        ok: false,
        provider: 'textbee',
        error: 'No textbee gateway phone is paired and online. Open the textbee app on the CDRRMO handset, confirm the device is enabled in the dashboard, and exempt the app from battery optimisation.',
      }
    }
    return { ok: false, provider: 'textbee', error: `${res.status} ${msg}` }
  }
  /* Accepted, NOT delivered — textbee's 200 body says "SMS added to queue for
     processing". The phone sends it afterwards and can fail there (no
     cellular service, no load, SMS permission revoked), which the outbox has
     to reflect. Reconcile real outcomes from
     GET /api/v1/gateway/messages, where each message carries
     status=dispatched|sent|failed with an errorMessage. */
  return { ok: true, provider: 'textbee', queued: true }
}

async function sendSms(to: string, body: string): Promise<SendResult> {
  const provider = activeProvider()
  const trimmed = body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body
  try {
    if (provider === 'semaphore') return await sendSemaphore(to, trimmed)
    if (provider === 'textbee') return await sendTextBee(to, trimmed)
    if (provider === 'twilio') return await sendTwilio(to, trimmed)
    return { ok: true, provider: 'simulation', simulated: true }
  } catch (e) {
    return { ok: false, provider, error: (e as Error).message }
  }
}

/* Send + record, in one place, so nothing can be sent without an outbox row. */
// deno-lint-ignore no-explicit-any
async function dispatch(db: any, opts: {
  phone: string
  body: string
  purpose: 'alert' | 'verify' | 'test'
  alertId?: number | null
  barangay?: string | null
  level?: string | null
}): Promise<SendResult> {
  const result = await sendSms(opts.phone, opts.body)
  await db.from('sms_messages').insert({
    phone: opts.phone,
    body: opts.body.length > MAX_BODY ? `${opts.body.slice(0, MAX_BODY - 1)}…` : opts.body,
    purpose: opts.purpose,
    alert_id: opts.alertId ?? null,
    barangay: opts.barangay ?? null,
    level: opts.level ?? null,
    provider: result.provider,
    status: result.simulated ? 'simulated'
      : result.queued ? 'queued'
      : result.ok ? 'sent'
      : 'failed',
    error: result.error ?? null,
  })
  return result
}

/* ── Code lifecycle ────────────────────────────────────────────────────── */
// deno-lint-ignore no-explicit-any
async function issuePhoneCode(db: any, phone: string, purpose: string, intro: string) {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { data: recent } = await db
    .from('sms_codes')
    .select('id, created_at')
    .eq('phone', phone)
    .gte('created_at', hourAgo)
    .order('created_at', { ascending: false })

  if ((recent?.length ?? 0) >= MAX_CODES_PER_HOUR) {
    throw new Error('Too many codes requested for this number. Please wait an hour.')
  }
  if (recent?.length) {
    const since = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000
    if (since < RESEND_COOLDOWN_S) {
      throw new Error(`Please wait ${Math.ceil(RESEND_COOLDOWN_S - since)}s before requesting another code.`)
    }
  }

  // A new code invalidates any older live one, so two are never valid at once.
  await db.from('sms_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('phone', phone).eq('purpose', purpose).is('consumed_at', null)

  const code = randomCode()
  const salt = randomHex(16)
  const { error } = await db.from('sms_codes').insert({
    phone,
    purpose,
    code_hash: await sha256Hex(salt + code),
    code_salt: salt,
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  })
  if (error) throw new Error(error.message)

  const body = `${intro} ${code}. Valid for ${CODE_TTL_MIN} minutes. Never share this code. — CDRRMO Cabuyao`
  const res = await dispatch(db, { phone, body, purpose: 'verify' })
  return { sent: true, simulated: Boolean(res.simulated), delivered: res.ok, error: res.error }
}

// deno-lint-ignore no-explicit-any
async function consumePhoneCode(db: any, phone: string, purpose: string, code: string) {
  const { data: rows } = await db
    .from('sms_codes')
    .select('*')
    .eq('phone', phone).eq('purpose', purpose).is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const row = rows?.[0]
  if (!row) return { ok: false, error: 'No active code for that number. Request a new one.' }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'That code has expired. Request a new one.' }
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.from('sms_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
    return { ok: false, error: 'Too many wrong attempts. Request a new code.' }
  }

  const given = await sha256Hex(row.code_salt + String(code ?? '').trim())
  if (!timingSafeEqual(given, row.code_hash)) {
    await db.from('sms_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return { ok: false, error: `That code is not right. ${MAX_ATTEMPTS - row.attempts - 1} attempt(s) left.` }
  }

  await db.from('sms_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
  return { ok: true }
}

/* ── Alert copy ────────────────────────────────────────────────────────────
   Written for a 160-character screen on a feature phone. The level and the
   barangay come first because those are what decide whether the reader keeps
   reading, and the sender identifies itself because an unattributed emergency
   text is indistinguishable from a scam. */
const LEVEL_PREFIX: Record<string, string> = {
  emergency: 'EMERGENCY',
  high: 'RED ALERT',
  moderate: 'ADVISORY',
  low: 'ADVISORY',
  safe: 'ALL CLEAR',
}

function alertBody(level: string, title: string, message: string, barangay?: string): string {
  const prefix = LEVEL_PREFIX[level] ?? 'ADVISORY'
  const where = barangay && barangay !== 'All' && barangay !== 'All Barangays'
    ? ` Brgy. ${barangay}:`
    : ''
  const tail = level === 'safe' ? '' : ' Follow your barangay officials.'
  return `[CDRRMO CABUYAO] ${prefix}.${where} ${title}. ${message}${tail}`.replace(/\s+/g, ' ').trim()
}

/* A plain operator-written text — no alert record, no severity, no siren.
   "Relief goods at the covered court from 8am", "the Sala centre is open now".

   It still carries the [CDRRMO CABUYAO] prefix, and that is not decoration:
   on the phone gateway these arrive from an ordinary mobile number the
   resident has never seen, so the prefix is the only thing distinguishing an
   official message from a stranger's text. It is prepended here rather than
   left to the operator, because the one time somebody forgets is the time it
   matters. */
function noticeBody(message: string): string {
  return `[CDRRMO CABUYAO] ${message}`.replace(/\s+/g, ' ').trim()
}

/* ── Handler ───────────────────────────────────────────────────────────── */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400)
  }
  const action = String(body.action ?? '')

  try {
    /* ── Internal relay ───────────────────────────────────────────────────
       auth-otp mints account-verification codes into auth_codes and needs
       them TEXTED. Duplicating the provider credentials into that function
       would mean two places to rotate a key and two places to get it wrong,
       so it calls in here instead.

       This is the one action that will send text a caller supplies verbatim,
       which makes it an open SMS relay if it is not locked down. It is gated
       on the service-role key: the browser bundle ships the anon key, so no
       visitor can reach this branch. */
    if (action === 'deliver') {
      const auth = req.headers.get('authorization') || ''
      const token = auth.replace(/^Bearer\s+/i, '').trim()
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      if (!serviceKey || token !== serviceKey) {
        return json({ error: 'Not authorised.' }, 403)
      }
      const phone = normalisePH(String(body.phone ?? ''))
      const text = String(body.body ?? '').trim()
      if (!phone) return json({ error: 'invalid-phone' }, 400)
      if (!text) return json({ error: 'Nothing to send.' }, 400)
      const purpose = body.purpose === 'alert' ? 'alert' : body.purpose === 'test' ? 'test' : 'verify'
      const res = await dispatch(db, { phone, body: text, purpose })
      if (!res.ok) return json({ error: res.error || 'Delivery failed.', provider: res.provider }, 502)
      return json({ sent: true, provider: res.provider, simulated: Boolean(res.simulated) })
    }

    /* ── Broadcast and test are CDRRMO-only ───────────────────────────────
       Texting every resident in the city is the most consequential thing this
       system does, and until now `broadcast` was reachable with the anon key —
       which ships inside the browser bundle, so any visitor who opened dev
       tools could have done it. Same for `test`, which burns real credits and
       texts a number the caller picks.

       HOW STRONG THIS IS, STATED PLAINLY. The app does not use Supabase Auth:
       sign-in goes through the app_login RPC and the session token is the
       literal string `local-<id>`, which proves nothing. So there is no JWT
       here to verify, and this check looks the claimed actor up in `accounts`
       and requires role='admin' AND status='active'. That stops every casual
       caller and every barangay or resident account, including one driving the
       API by hand. It does NOT stop someone who knows an administrator's
       numeric id and crafts a request, because nothing in the current session
       model can. Closing that last gap means real signed sessions — see
       README — and this gate is written so it becomes a JWT check in one place
       when they arrive, rather than a rule scattered across call sites. */
    if (action === 'broadcast' || action === 'notice' || action === 'test') {
      const auth = req.headers.get('authorization') || ''
      const token = auth.replace(/^Bearer\s+/i, '').trim()
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
      // The service role (AutoAlertWatcher, cron, our own tooling) always passes.
      const isService = Boolean(serviceKey) && token === serviceKey
      if (!isService) {
        const actorId = Number(body.actorId)
        if (!Number.isInteger(actorId)) {
          return json({ error: 'Only CDRRMO administrators can send SMS alerts.' }, 403)
        }
        const { data: actor } = await db
          .from('accounts').select('id, role, status').eq('id', actorId).maybeSingle()
        if (!actor || actor.role !== 'admin' || actor.status !== 'active') {
          return json({ error: 'Only CDRRMO administrators can send SMS alerts.' }, 403)
        }
      }
    }

    /* ── What is configured? (no secrets leave this function) ─────────── */
    if (action === 'config') {
      const provider = activeProvider()
      return json({
        provider,
        simulation: provider === 'simulation',
        senderName: provider === 'semaphore'
          ? (Deno.env.get('SEMAPHORE_SENDER_NAME') || 'SEMAPHORE')
          : provider === 'twilio' ? (Deno.env.get('TWILIO_FROM') || '')
          /* textbee sends from whatever SIM is in the phone, and this function
             never sees that number. Saying "CDRRMO" here would tell the
             operator a sender ID is in use when residents will actually see a
             mobile number they do not recognise. */
          : provider === 'textbee' ? 'the CDRRMO gateway phone'
          : 'CDRRMO',
        note: provider === 'simulation'
          ? 'No SMS provider key is set. Messages are recorded but NOT delivered to handsets.'
          : null,
      })
    }

    /* ── Opt in ───────────────────────────────────────────────────────── */
    if (action === 'subscribe') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) {
        return json({ error: 'Enter a Philippine mobile number, e.g. 0917 123 4567.' }, 400)
      }
      const barangay = body.barangay ? String(body.barangay) : null
      const fullName = body.fullName ? String(body.fullName).slice(0, 120) : null
      const accountId = Number.isInteger(body.accountId) ? Number(body.accountId) : null

      const { data: existing } = await db
        .from('sms_subscribers').select('id, verified_at').eq('phone', phone).maybeSingle()

      if (existing) {
        await db.from('sms_subscribers').update({
          barangay, full_name: fullName, account_id: accountId,
          opted_out_at: null, updated_at: new Date().toISOString(),
        }).eq('id', existing.id)
        /* Already confirmed on this number: re-texting a code would be a
           pointless message to someone who is already covered. */
        if (existing.verified_at) {
          return json({ subscribed: true, verified: true, phone: mask(phone) })
        }
      } else {
        const { error } = await db.from('sms_subscribers').insert({
          phone, barangay, full_name: fullName, account_id: accountId,
          source: body.source === 'registration' ? 'registration' : 'resident',
        })
        if (error) return json({ error: error.message }, 500)
      }

      const res = await issuePhoneCode(
        db, phone, 'verify_phone',
        'Your CDRRMO FloodRoute confirmation code is',
      )
      return json({
        subscribed: true,
        verified: false,
        phone: mask(phone),
        expiresInMinutes: CODE_TTL_MIN,
        ...res,
      })
    }

    /* ── Confirm the number ───────────────────────────────────────────── */
    if (action === 'verify') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) return json({ error: 'Enter a valid Philippine mobile number.' }, 400)
      const res = await consumePhoneCode(db, phone, 'verify_phone', String(body.code ?? ''))
      if (!res.ok) return json({ error: res.error }, 400)

      await db.from('sms_subscribers').update({
        verified_at: new Date().toISOString(),
        opted_out_at: null,
        updated_at: new Date().toISOString(),
      }).eq('phone', phone)

      const { data: sub } = await db
        .from('sms_subscribers').select('barangay').eq('phone', phone).maybeSingle()

      await dispatch(db, {
        phone,
        body: `[CDRRMO CABUYAO] You are now registered for EMERGENCY flood alerts${sub?.barangay ? ` for Brgy. ${sub.barangay}` : ''}. Emergencies only. Reply STOP to opt out.`,
        purpose: 'verify',
        barangay: sub?.barangay ?? null,
      })

      return json({ verified: true, phone: mask(phone), barangay: sub?.barangay ?? null })
    }

    /* ── Is this number covered? ──────────────────────────────────────── */
    if (action === 'status') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) return json({ subscribed: false, verified: false })
      const { data: sub } = await db
        .from('sms_subscribers')
        .select('barangay, verified_at, opted_out_at, created_at')
        .eq('phone', phone).maybeSingle()
      return json({
        subscribed: Boolean(sub && !sub.opted_out_at),
        verified: Boolean(sub?.verified_at && !sub.opted_out_at),
        barangay: sub?.barangay ?? null,
        phone: mask(phone),
      })
    }

    /* ── Opt out ──────────────────────────────────────────────────────── */
    if (action === 'unsubscribe') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) return json({ error: 'Enter a valid Philippine mobile number.' }, 400)
      // The row is kept, not deleted: an opt-out you cannot prove is an
      // opt-out you will eventually violate.
      await db.from('sms_subscribers').update({
        opted_out_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('phone', phone)
      return json({ unsubscribed: true, phone: mask(phone) })
    }

    /* ── Broadcast an alert ───────────────────────────────────────────── */
    /* One path for both, because they differ only in what the text says and
       who it reaches — the batching, the outbox row, the opt-out filter and
       the recipient cap are things neither is allowed to skip. A second copy
       of this loop is a second place for "sent" to start meaning something
       different. */
    if (action === 'broadcast' || action === 'notice') {
      const isNotice = action === 'notice'
      const level = String(body.level ?? 'moderate')
      const title = String(body.title ?? '').trim()
      const message = String(body.message ?? '').trim()
      const barangay = body.barangay ? String(body.barangay) : null
      const alertId = Number.isInteger(body.alertId) ? Number(body.alertId) : null
      /* A notice is only its message; an alert may carry either field. */
      if (isNotice ? !message : (!title && !message)) {
        return json({ error: 'Nothing to send.' }, 400)
      }

      let q = db.from('sms_subscribers')
        .select('phone, barangay')
        .not('verified_at', 'is', null)
        .is('opted_out_at', null)
        .limit(MAX_BROADCAST + 1)

      /* A city-wide alert goes to everyone; a barangay alert goes to that
         barangay AND to numbers with no barangay recorded — a resident who did
         not say where they live is better over-warned than missed.

         EMERGENCY IGNORES THE SCOPE ENTIRELY. At that tier the message is
         "leave now", and the boundary of a flood is not the boundary of a
         barangay: the people on the next street over are in the water too, and
         the roads out of an emergency barangay run through its neighbours.
         Over-warning the city costs a text; under-warning the street outside
         the line costs more than this system is allowed to cost. So the
         severity, not the operator's dropdown, decides the reach. */
      /* A notice never claims emergency reach — the operator picked its
         audience deliberately, and silently widening a "relief goods at 8am"
         text to the whole city would be the same lie in the other direction. */
      const cityWide = !isNotice && level === 'emergency'
      if (!cityWide && barangay && barangay !== 'All' && barangay !== 'All Barangays') {
        q = q.or(`barangay.eq.${barangay},barangay.is.null`)
      }

      const { data: subs, error } = await q
      if (error) return json({ error: error.message }, 500)
      const recipients = subs ?? []
      if (recipients.length > MAX_BROADCAST) {
        return json({ error: `Refusing to send to more than ${MAX_BROADCAST} numbers in one call.` }, 400)
      }
      if (!recipients.length) {
        return json({ sent: 0, failed: 0, simulated: 0, info: 'No verified subscribers for that area yet.' })
      }

      const text = isNotice
        ? noticeBody(message)
        : alertBody(level, title, message, barangay ?? undefined)
      let sent = 0
      let failed = 0
      let simulated = 0
      let queued = 0
      const provider = activeProvider()

      /* Sent in small batches rather than all at once: every gateway rate
         limits, and a 429 halfway through a city-wide warning is the failure
         mode that matters most. */
      const BATCH = 8
      for (let i = 0; i < recipients.length; i += BATCH) {
        const slice = recipients.slice(i, i + BATCH)
        const results = await Promise.all(slice.map((s: { phone: string }) => dispatch(db, {
          /* purpose stays 'alert' — the column's CHECK allows only
             alert|verify|test, and a notice is closer to an alert than to
             either of the others. `level` is null so the outbox does not
             attribute a severity the operator never chose. */
          phone: s.phone, body: text, purpose: 'alert', alertId,
          barangay, level: isNotice ? null : level,
        })))
        for (const r of results) {
          if (r.simulated) simulated++
          else if (r.queued) queued++
          else if (r.ok) sent++
          else failed++
        }
      }

      await db.from('sms_subscribers')
        .update({ last_sent_at: new Date().toISOString() })
        .in('phone', recipients.map((r: { phone: string }) => r.phone))

      return json({
        sent, failed, simulated, queued, provider,
        recipients: recipients.length,
        preview: text,
      })
    }

    /* ── Test one number ──────────────────────────────────────────────── */
    if (action === 'test') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) return json({ error: 'Enter a Philippine mobile number to test, e.g. 0917 123 4567.' }, 400)
      const res = await dispatch(db, {
        phone,
        body: '[CDRRMO CABUYAO] Test message from FloodRoute. Your SMS alert channel is working. No action needed.',
        purpose: 'test',
      })
      return json({
        ok: res.ok,
        provider: res.provider,
        simulated: Boolean(res.simulated),
        error: res.error ?? null,
        phone: mask(phone),
      })
    }

    /* ── Audit trail (numbers masked) ─────────────────────────────────── */
    if (action === 'outbox') {
      const limit = Math.min(100, Math.max(1, Number(body.limit ?? 30)))
      const { data, error } = await db
        .from('sms_messages')
        .select('id, phone, body, purpose, barangay, level, provider, status, error, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) return json({ error: error.message }, 500)
      return json({
        messages: (data ?? []).map((m: { phone: string }) => ({ ...m, phone: mask(m.phone) })),
      })
    }

    /* ── Who is covered ───────────────────────────────────────────────── */
    if (action === 'stats') {
      const { data, error } = await db
        .from('sms_subscribers')
        .select('barangay, verified_at, opted_out_at')
        .limit(5000)
      if (error) return json({ error: error.message }, 500)
      const rows = data ?? []
      const byBarangay: Record<string, number> = {}
      let verified = 0
      let pending = 0
      let optedOut = 0
      for (const r of rows) {
        if (r.opted_out_at) { optedOut++; continue }
        if (r.verified_at) {
          verified++
          const k = r.barangay || 'Unspecified'
          byBarangay[k] = (byBarangay[k] || 0) + 1
        } else pending++
      }
      return json({
        total: rows.length, verified, pending, optedOut, byBarangay,
        provider: activeProvider(),
      })
    }

    /* ── Account verification by SMS ──────────────────────────────────────
       Called by auth-otp when a resident registers with a mobile number. It is
       here rather than there because this is where the provider credentials
       live, and duplicating them into a second function would mean two places
       to get wrong. */
    if (action === 'account-code') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) return json({ error: 'Enter a valid Philippine mobile number.' }, 400)
      const res = await issuePhoneCode(
        db, phone, 'verify_account',
        'Your CDRRMO FloodRoute account code is',
      )
      return json({ ...res, phone: mask(phone), expiresInMinutes: CODE_TTL_MIN })
    }

    if (action === 'account-verify') {
      const phone = normalisePH(String(body.phone ?? ''))
      if (!phone) return json({ error: 'Enter a valid Philippine mobile number.' }, 400)
      const res = await consumePhoneCode(db, phone, 'verify_account', String(body.code ?? ''))
      if (!res.ok) return json({ error: res.error }, 400)
      return json({ verified: true, phone: mask(phone) })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: (e as Error).message || 'SMS request failed.' }, 500)
  }
})
