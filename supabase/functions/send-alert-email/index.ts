/* ============================================================
   send-alert-email — flood-alert email for Cabuyao CDRRMO FloodRoute.

   WHY AN EDGE FUNCTION
   Same two reasons as sms-alert. The provider API key must never reach a
   browser, and the recipient list must never be bulk-readable — the anon key
   the deployed site ships with would otherwise hand anyone every registered
   resident's email address. So the audience is assembled here, under the
   service role, and every address that leaves this function is MASKED
   (j•••••@gmail.com) in the audit responses.

   Actions
     send    → email the alert to its audience (default when no action given,
               so every existing caller keeps working unchanged)
     test    → email ONE address, to prove the provider works end to end
     config  → which provider is configured, without revealing the key

   AUDIENCE
   Honours the same two Alert Settings toggles SMS already honours:

     toStaff      CDRRMO command centre (city-wide) AND the barangay official
                  for the barangay the alert names.
     toResidents  Registered residents of that barangay.

   Two things were wrong with the audience before, and both were silent:

     1. Residents were excluded outright — the function selected staff roles
        only, and alertDispatch's header still reads "email the staff, text
        the residents". That split made sense when SMS was the resident
        channel and stopped making sense the moment SMS turned out to cost
        money this office does not have. Email is free.
     2. So were the barangay officials. The role list was
        ['admin','operator','officer','staff'], but the live roles are admin,
        barangay and resident — so all 22 Punong Barangay matched nothing and
        received no alert email at all.

   A city-wide alert now reaches 51 accounts where it used to reach 11.

   PROVIDERS  (auto-detected, mirroring sms-alert's activeProvider())
     resend    3,000/month free, but will only deliver to addresses other than
               your own once you have verified a DOMAIN you control. The right
               choice once cdrrmo-something.ph (or a student .me) exists.
     brevo     300/day free and needs NO domain: when the sender is a free
               address (gmail.com), Brevo substitutes a compliant sender of its
               own so the mail still reaches strangers. That is the difference
               that matters here — it makes the channel real before anyone owns
               a domain.
     simulation
               No key configured. Nothing is sent, and the response says
               `simulated: true` with the full recipient count, so the pipeline
               is demonstrable without an account and nobody is misled into
               believing an inbox was reached.

   Deploy:  npx supabase functions deploy send-alert-email
   Secrets: EMAIL_PROVIDER=resend|brevo   (default: auto-detect, else simulation)
            RESEND_API_KEY
            BREVO_API_KEY
            ALERT_FROM_EMAIL   e.g. "CDRRMO Alerts <alerts@example.ph>"
                               Brevo: your own verified address is fine.
                               Resend: must be on a domain you have verified.
   ============================================================ */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/* A send bigger than this is refused rather than half-delivered — the same
   guard MAX_BROADCAST gives SMS. A runaway loop burns a daily quota in the
   middle of the emergency it was meant to serve. */
const MAX_RECIPIENTS = 900

/* EVERY level the database can hold. `emergency` and `low` were missing, so an
   EMERGENCY alert fell through to the default and went out subject-lined
   "ADVISORY" — the most serious message in the system labelled as the mildest.
   Kept in sync with the alerts.level CHECK constraint. */
const LEVEL_META: Record<string, { color: string; label: string }> = {
  emergency: { color: '#7F1D1D', label: 'EMERGENCY — ACT NOW' },
  high:      { color: '#C0181B', label: 'HIGH ALERT' },
  moderate:  { color: '#D97706', label: 'ADVISORY' },
  low:       { color: '#2563EB', label: 'INFORMATION' },
  safe:      { color: '#16A34A', label: 'ALL CLEAR' },
}

/* CDRRMO command centre — the whole city is their responsibility, so they get
   every alert regardless of which barangay it names.

   'operator', 'officer' and 'staff' are kept for accounts created under the
   older role vocabulary. They currently match nothing: the live roles are
   admin (11), barangay (22) and resident (23). That is worth stating plainly,
   because this list USED to be the entire audience — which meant every one of
   the 22 Punong Barangay was silently left off every alert email. */
const CITYWIDE_ROLES = ['admin', 'operator', 'officer', 'staff']

/* Barangay officials are scoped like residents: a Marinig alert goes to the
   Marinig official, not to all eighteen. */
const BARANGAY_ROLE = 'barangay'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* An alert's title and message are operator-typed free text and go straight
   into an HTML document. Without this, a "<" in "water <1m" silently eats the
   rest of the paragraph, and a pasted "<img onerror=…>" would be worse. */
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** j•••••@gmail.com — enough to recognise your own address, not to harvest it. */
function mask(email: string): string {
  const [user, domain] = String(email ?? '').split('@')
  if (!domain) return '•••'
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(3, user.length - 1))}@${domain}`
}

/* ── Providers ─────────────────────────────────────────────────────────── */

type SendResult = { ok: boolean; provider: string; id?: string; error?: string }

function activeProvider(): 'resend' | 'brevo' | 'simulation' {
  const forced = (Deno.env.get('EMAIL_PROVIDER') || '').toLowerCase()
  if (forced === 'resend' && Deno.env.get('RESEND_API_KEY')) return 'resend'
  if (forced === 'brevo' && Deno.env.get('BREVO_API_KEY')) return 'brevo'
  if (forced === 'simulation') return 'simulation'
  // Auto-detect. Resend first: if both are configured, the one that can use a
  // real verified domain is the one to prefer.
  if (Deno.env.get('RESEND_API_KEY')) return 'resend'
  if (Deno.env.get('BREVO_API_KEY')) return 'brevo'
  return 'simulation'
}

/** "CDRRMO Alerts <a@b.c>" → { name, email }, which is the shape Brevo wants. */
function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1] || 'CDRRMO Alerts', email: m[2] }
  return { name: 'CDRRMO Alerts', email: from.trim() }
}

async function sendResend(
  to: string[], subject: string, html: string, from: string,
): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    /* `bcc`, not `to`: a flood alert to 300 residents must not print all 300
       addresses in every inbox. Resend requires a `to`, so the sender gets the
       visible copy and everyone else is blind-copied. */
    body: JSON.stringify({ from, to: [parseFrom(from).email], bcc: to, subject, html }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, provider: 'resend', error: data?.message ?? `HTTP ${res.status}` }
  }
  return { ok: true, provider: 'resend', id: data?.id }
}

async function sendBrevo(
  to: string[], subject: string, html: string, from: string,
): Promise<SendResult> {
  const sender = parseFrom(from)
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': Deno.env.get('BREVO_API_KEY')!,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: sender.email, name: sender.name }],
      bcc: to.map((email) => ({ email })),
      subject,
      htmlContent: html,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, provider: 'brevo', error: data?.message ?? `HTTP ${res.status}` }
  }
  return { ok: true, provider: 'brevo', id: data?.messageId }
}

function dispatch(
  provider: string, to: string[], subject: string, html: string, from: string,
): Promise<SendResult> {
  if (provider === 'resend') return sendResend(to, subject, html, from)
  if (provider === 'brevo') return sendBrevo(to, subject, html, from)
  return Promise.resolve({ ok: true, provider: 'simulation' })
}

/* ── The message ───────────────────────────────────────────────────────── */

function buildHtml(opts: {
  level: string; title: string; message: string; barangay?: string
}): string {
  const meta = LEVEL_META[opts.level] ?? LEVEL_META.moderate
  const scope = opts.barangay && opts.barangay !== 'All'
    ? `Barangay ${esc(opts.barangay)} · `
    : ''
  return `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:${meta.color};color:#fff;padding:20px 24px">
        <div style="font-size:12px;letter-spacing:.08em;font-weight:600;opacity:.85">CDRRMO CABUYAO — FLOOD ${meta.label}</div>
        <div style="font-size:11px;margin-top:4px;opacity:.7">${scope}Cabuyao City, Laguna</div>
      </div>
      <div style="background:#f8fafc;padding:24px">
        <h2 style="margin:0 0 10px;color:#1e293b;font-size:17px">${esc(opts.title) || '(no title)'}</h2>
        <p style="color:#475569;line-height:1.6;margin:0 0 20px">${esc(opts.message)}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px">
        <p style="color:#94a3b8;font-size:11px;margin:0">
          Sent by CDRRMO FloodRoute. Do not reply to this email.<br>
          This is <b>not</b> a national cell broadcast. For a life-threatening
          emergency call <b>911</b>.
        </p>
      </div>
    </div>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const provider = activeProvider()
  const from = Deno.env.get('ALERT_FROM_EMAIL') || 'CDRRMO Alerts <onboarding@resend.dev>'

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* config takes no body */ }
  const action = String(body.action ?? 'send')

  // Which provider is live — answered without ever revealing a key.
  if (action === 'config') {
    /* Both keys set is the trap: adding the second one looks like it should
       help and changes nothing, because only one can win. Say so out loud —
       "I set the Brevo key and email still doesn't work" is otherwise an
       invisible failure with no error anywhere to read. */
    const both = Boolean(Deno.env.get('RESEND_API_KEY') && Deno.env.get('BREVO_API_KEY'))
    const forced = (Deno.env.get('EMAIL_PROVIDER') || '').toLowerCase()
    return json({
      provider,
      configured: provider !== 'simulation',
      from,
      chosenBy: forced ? `EMAIL_PROVIDER=${forced}` : 'auto-detected',
      warning: both && !forced
        ? `RESEND_API_KEY and BREVO_API_KEY are BOTH set; "${provider}" won by auto-detection and the other key is doing nothing. Set EMAIL_PROVIDER to say which you mean.`
        : undefined,
      note: provider === 'simulation'
        ? 'No RESEND_API_KEY or BREVO_API_KEY set. Alerts are counted but not delivered.'
        : provider === 'resend'
          ? 'Resend delivers to other people only from a domain you have verified.'
          : 'Brevo needs no domain; it substitutes a compliant sender for free addresses.',
    })
  }

  try {
    const {
      level = 'moderate', title, message, barangay,
      toStaff = true, toResidents = true,
    } = body as {
      level?: string; title?: string; message?: string; barangay?: string
      toStaff?: boolean; toResidents?: boolean
    }
    const meta = LEVEL_META[level] ?? LEVEL_META.moderate
    const subject = `[CDRRMO] ${meta.label}: ${title ?? 'Flood Alert'}`
    const html = buildHtml({ level, title: title as string, message: message as string, barangay })

    // Prove the provider works, to one address, without touching the audience.
    if (action === 'test') {
      const target = String(body.email ?? '').trim()
      if (!target || !target.includes('@')) return json({ error: 'A valid "email" is required.' }, 400)
      const r = await dispatch(provider, [target], `[TEST] ${subject}`, html, from)
      return json({
        ...r,
        to: mask(target),
        simulated: provider === 'simulation',
      }, r.ok ? 200 : 502)
    }

    if (action !== 'send') return json({ error: `Unknown action "${action}".` }, 400)

    /* ── Audience ──────────────────────────────────────────────────────── */
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const recipients = new Set<string>()
    let staffCount = 0
    let officialCount = 0
    let residentCount = 0

    /* Is this alert about one barangay, or the whole city? Everything below
       keys off this, and the two "all" spellings both occur in the data. */
    const scoped = Boolean(barangay) && barangay !== 'All' && barangay !== 'All Barangays'

    if (toStaff) {
      const { data } = await supabase
        .from('accounts')
        .select('email')
        .in('role', CITYWIDE_ROLES)
        .eq('status', 'active')
        .not('email', 'is', null)
      for (const a of data ?? []) {
        if (a.email) { recipients.add(a.email); staffCount++ }
      }

      /* Barangay officials count as staff for the purposes of the toggle, but
         are scoped like residents — the Punong Barangay of Casile does not
         need Marinig's flood warning. */
      let q = supabase
        .from('accounts')
        .select('email')
        .eq('role', BARANGAY_ROLE)
        .eq('status', 'active')
        .not('email', 'is', null)
      if (scoped) q = q.eq('barangay', barangay)
      const { data: officials } = await q
      for (const a of officials ?? []) {
        if (a.email && !recipients.has(a.email)) { recipients.add(a.email); officialCount++ }
      }
    }

    if (toResidents) {
      /* Scoped to the alert's barangay too. A warning that is not about you is
         what teaches people to ignore the next one that is. */
      let q = supabase
        .from('accounts')
        .select('email')
        .eq('role', 'resident')
        .eq('status', 'active')
        .not('email', 'is', null)
      if (scoped) q = q.eq('barangay', barangay)
      const { data } = await q
      for (const a of data ?? []) {
        if (a.email && !recipients.has(a.email)) { recipients.add(a.email); residentCount++ }
      }
    }

    const toList = [...recipients]
    if (!toList.length) {
      return json({
        sent: 0,
        staff: 0,
        officials: 0,
        residents: 0,
        info: toStaff || toResidents
          ? 'No active accounts with an email address matched this alert.'
          : 'Both audiences are switched off in Alert Settings.',
      })
    }
    if (toList.length > MAX_RECIPIENTS) {
      return json({
        error: `Refusing to email ${toList.length} recipients in one send (cap ${MAX_RECIPIENTS}).`,
      }, 413)
    }

    const r = await dispatch(provider, toList, subject, html, from)
    if (!r.ok) return json({ error: r.error, provider: r.provider, attempted: toList.length }, 502)

    return json({
      sent: toList.length,
      staff: staffCount,
      officials: officialCount,
      residents: residentCount,
      provider: r.provider,
      id: r.id,
      /* Never let a caller read "sent: 214" as "214 people were warned" when
         no provider is configured. The SMS channel learned this the hard way. */
      simulated: provider === 'simulation',
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
