/* ============================================================
   smsAlert.js — the browser's side of the emergency SMS channel.

   Every call goes to the `sms-alert` Edge Function. Nothing here holds a
   provider key, and nothing here ever receives an unmasked phone number other
   than the one the person using the screen just typed in themselves.

   Setup (one-time, by CDRRMO IT):
     1. Run supabase/migrations/20260827120000_sms_emergency_alerts.sql
     2. npx supabase functions deploy sms-alert
     3. npx supabase secrets set SEMAPHORE_API_KEY=…  SEMAPHORE_SENDER_NAME=CDRRMO
     4. Settings → API Integrations → SMS Gateway → enable
   Until step 3, the channel runs in SIMULATION: messages are recorded and
   labelled, and no handset is reached.
   ============================================================ */

import supabase from './supabase.js'
import { loadAlertSettings } from '../context/AdminDataContext.jsx'
import { isDrillActive } from './drillMode.js'

/**
 * The SMS service could not be reached at all — not deployed, or the network
 * is down. Deliberately one class covering both: from the caller's side they
 * are the same actionable state ("this channel cannot be used right now"),
 * and guessing which one it is would put a wrong explanation on the screen.
 */
export class SmsFunctionUnavailable extends Error {
  constructor(message) {
    super(message || 'The SMS service could not be reached.')
    this.name = 'SmsFunctionUnavailable'
  }
}

async function call(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('sms-alert', {
    body: { action, ...payload },
  })
  if (error) {
    /* supabase-js reports a non-2xx as a FunctionsHttpError whose body holds
       the real message. Without digging it out, every validation failure would
       reach the resident as "Edge Function returned a non-2xx status code". */
    let detail = ''
    try {
      const body = await error.context?.json?.()
      detail = body?.error || ''
    } catch {
      /* no JSON body — fall through to the generic message */
    }
    const status = error.context?.status
    /* No status at all means the request never got an HTTP answer: the
       function is not deployed (so the CORS preflight 404s and the browser
       reports only a blocked fetch), or the device is offline. Either way
       there is no SMS channel right now, and a card that invites someone to
       type their number into it would be lying. */
    if (status === 404 || status == null) throw new SmsFunctionUnavailable()
    throw new Error(detail || error.message || 'SMS request failed.')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/** Which provider is live, and is it actually delivering? */
export function smsConfig() {
  return call('config')
}

/** True when the operator has switched the SMS channel on in Alert Settings. */
export function isSmsEnabled() {
  return Boolean(loadAlertSettings().sms)
}

/* ── Resident opt-in ─────────────────────────────────────────────────────── */

/** Start an opt-in: records the number and texts a confirmation code. */
export function subscribeSms({ phone, barangay, fullName, accountId, source }) {
  return call('subscribe', { phone, barangay, fullName, accountId, source })
}

/** Finish an opt-in with the code from the text. */
export function verifySms({ phone, code }) {
  return call('verify', { phone, code })
}

/** Is this number already covered? */
export function smsStatus(phone) {
  return call('status', { phone })
}

/** Opt out. Emergencies included — this is the resident's call, not ours. */
export function unsubscribeSms(phone) {
  return call('unsubscribe', { phone })
}

/* ── CDRRMO dispatch ─────────────────────────────────────────────────────── */

/**
 * Text an alert to every verified subscriber in its area.
 *
 * Silent no-op when the channel is switched off, and blocked outright during a
 * drill — a drill exists to make the system act on its own, so the guard has to
 * sit where the message would actually leave the building rather than in each
 * of the several places that can raise an alert.
 */
export async function sendAlertSms({ level, title, message, barangay, alertId } = {}) {
  if (isDrillActive()) {
    console.info('[drill] outbound SMS blocked:', title)
    return { skipped: true, blockedByDrill: true }
  }
  if (!isSmsEnabled()) return { skipped: true, reason: 'channel-off' }
  return call('broadcast', { level, title, message, barangay, alertId })
}

/** Send one test message, to prove the provider works before it is needed. */
export function sendTestSms(phone) {
  return call('test', { phone })
}

/** Recent sends, phone numbers masked — the operator's audit panel. */
export function smsOutbox(limit = 30) {
  return call('outbox', { limit })
}

/** Subscriber counts, overall and per barangay. */
export function smsStats() {
  return call('stats')
}

/* ── Display helpers ─────────────────────────────────────────────────────── */

/** Normalise the way a resident types their number, for display and for send. */
export function normalisePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '')
  let d = digits.replace(/^\+/, '')
  if (d.startsWith('63')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)
  if (!/^9\d{9}$/.test(d)) return null
  return `+63${d}`
}

/** "+639171234567" → "0917 123 4567", which is how people read their own number. */
export function formatPhone(e164) {
  const d = String(e164 ?? '').replace(/\D/g, '')
  const local = d.startsWith('63') ? d.slice(2) : d
  if (local.length !== 10) return e164 || ''
  return `0${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}

export default {
  smsConfig, isSmsEnabled, subscribeSms, verifySms, smsStatus, unsubscribeSms,
  sendAlertSms, sendTestSms, smsOutbox, smsStats, normalisePhone, formatPhone,
}
