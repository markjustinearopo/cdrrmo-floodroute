/* ============================================================
   alertDispatch.js — the one place an alert leaves the building.

   WHY THIS EXISTS
   Raising an alert is not one action, it is several: write the record, email
   everyone the alert concerns, text the residents who opted in. (Email was
   staff-only until SMS turned out to cost money this office does not have;
   it now reaches CDRRMO, the barangay official and the barangay's registered
   residents — see send-alert-email.) Those were spread across the four screens that
   can raise one — the admin Alerts page, the admin Dashboard, the barangay
   Alerts page and the automatic threshold watcher — and they had already
   drifted apart. Issuing a HIGH alert from the Dashboard emailed nobody,
   because that call site simply never got the line the Alerts page has. Nothing
   on screen said so; the operator saw "alert issued" either way.

   For a warning system that is the defining failure: not a crash, but a
   confident report that the city was warned when it was not. So every
   outbound channel is fanned out from here, and every screen that raises an
   alert calls this instead of remembering the list itself.

   Failures are swallowed on purpose — an email provider being down must never
   stop the SMS, and neither must stop the alert from being recorded — but they
   are RETURNED, so a caller that wants to tell the operator the truth can.
   ============================================================ */

import { sendAlertEmail } from './emailAlert.js'
import { sendAlertSms } from './smsAlert.js'

/**
 * Fan one alert out to every enabled channel.
 *
 * Scheduled alerts are skipped: they are dispatched when the store promotes
 * them at their due time, not when the operator writes them.
 *
 * @param {{level, title, message, barangay, status?, id?}} alert
 * @returns {Promise<{email: object|null, sms: object|null, errors: string[]}>}
 *          Never rejects.
 */
export async function dispatchAlert(alert = {}) {
  const out = { email: null, sms: null, errors: [] }
  if (!alert || alert.status === 'scheduled') return out
  if (alert.drill || String(alert.title).startsWith('[DRILL] ')) {
    return { ...out, email: { blockedByDrill: true, skipped: true }, sms: { blockedByDrill: true, skipped: true } }
  }

  const payload = {
    level: alert.level,
    title: alert.title,
    message: alert.message,
    barangay: alert.barangay,
    barangays: alert.barangays,
  }

  const [email, sms] = await Promise.allSettled([
    sendAlertEmail(payload),
    sendAlertSms({ ...payload, alertId: Number.isInteger(alert.id) ? alert.id : undefined }),
  ])

  if (email.status === 'fulfilled') out.email = email.value
  else out.errors.push(`Email: ${email.reason?.message || email.reason}`)

  if (sms.status === 'fulfilled') out.sms = sms.value
  else out.errors.push(`SMS: ${sms.reason?.message || sms.reason}`)

  if (out.errors.length) console.warn('[alertDispatch]', out.errors.join(' · '))
  return out
}

/**
 * One line an operator can read, describing what actually happened — not what
 * was attempted. "Alert issued" is the easy sentence to write and the one that
 * hides a channel that silently failed.
 */
export function describeDispatch(result) {
  if (!result) return ''
  const parts = []
  const sms = result.sms
  if (sms && !sms.skipped) {
    const delivered = sms.sent ?? 0
    const simulated = sms.simulated ?? 0
    const queued = sms.queued ?? 0
    if (simulated > 0) parts.push(`${simulated} SMS simulated (no provider key)`)
    if (delivered > 0) parts.push(`${delivered} SMS sent`)
    /* Deliberately NOT worded as "sent". The phone gateway accepts a message
       into a queue and sends it afterwards, so this number is what was handed
       over — not what reached anyone. Saying "sent" here would be the system
       telling an operator the city was warned on the strength of an HTTP 200. */
    if (queued > 0) parts.push(`${queued} SMS queued on the gateway phone (not yet confirmed)`)
    if (sms.failed) parts.push(`${sms.failed} SMS failed`)
    if (!delivered && !simulated && !queued && !sms.failed) parts.push('no SMS subscribers yet')
  } else if (sms?.reason === 'channel-off') {
    parts.push('SMS channel off')
  } else if (sms?.reason === 'not-authorised') {
    /* Said out loud rather than left blank. A barangay official who raises an
       alert and reads only "alert issued" would reasonably assume residents
       were texted; they were not, and knowing that is what lets them phone
       CDRRMO if the situation needs the siren. */
    parts.push('no SMS — texting residents is CDRRMO-only')
  } else if (sms?.reason === 'residents-off') {
    /* Named separately from 'channel-off' on purpose: the fix is a different
       switch, and "SMS channel off" would send the operator to the wrong one
       while residents keep going unwarned. */
    parts.push('residents NOT texted — "Registered residents" is off in Alert Settings')
  }
  const email = result.email
  if (email && !email.skipped) {
    if (typeof email.sent === 'number') {
      /* Same rule the SMS branch follows: never let a count read as "people
         were warned" when no provider is configured. The function returns
         simulated:true in that case and this is where it has to show. */
      if (email.simulated) {
        parts.push(`${email.sent} email${email.sent === 1 ? '' : 's'} simulated (no provider key)`)
      } else {
        /* Broken down because the three audiences fail differently: a resident
           count of 0 on a barangay alert means nobody there registered an
           address, which is a recruitment problem, not an outage. */
        const who = []
        if (email.staff) who.push(`${email.staff} CDRRMO`)
        if (email.officials) who.push(`${email.officials} barangay`)
        if (email.residents) who.push(`${email.residents} resident${email.residents === 1 ? '' : 's'}`)
        parts.push(`${email.sent} email${email.sent === 1 ? '' : 's'} sent${who.length ? ` (${who.join(', ')})` : ''}`)
      }
    }
  } else if (email?.reason === 'no-audience') {
    // Distinct from 'email channel off' — a different switch fixes it.
    parts.push('email sent to NOBODY — both audiences are off in Alert Settings')
  } else if (email?.skipped && !email.blockedByDrill) {
    parts.push('email channel off')
  }
  if (result.email?.blockedByDrill || result.sms?.blockedByDrill) {
    return 'Drill mode — no messages left the building.'
  }
  if (result.errors?.length) parts.push(result.errors.join(' · '))
  return parts.join(' · ')
}

export default { dispatchAlert, describeDispatch }
