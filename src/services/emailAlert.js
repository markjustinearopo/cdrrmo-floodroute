/* ============================================================
   emailAlert.js — send flood-alert emails via the Supabase Edge Function
   (send-alert-email), which picks its provider at run time.

   Usage:
     import { sendAlertEmail, isEmailEnabled } from './emailAlert.js'
     sendAlertEmail({ level, title, message, barangay }).catch(console.warn)

   WHO GETS THE EMAIL is decided server-side from the two Alert Settings
   toggles this module forwards — `toStaff` and `toResidents`, the same pair
   the SMS channel honours. The recipient list itself is never assembled in the
   browser: the anon key the deployed site ships with would otherwise make
   every registered resident's address bulk-readable.

   SETUP — pick ONE provider, set ONE secret.

     Brevo (no domain needed, 300/day free) — fastest:
       1. Sign up at https://brevo.com and create an SMTP & API key.
       2. Supabase → Edge Functions → Secrets: BREVO_API_KEY.
       3. Set ALERT_FROM_EMAIL, e.g. "CDRRMO Alerts <you@gmail.com>".
          Brevo substitutes a compliant sender for free addresses, so mail to
          strangers still arrives.

     Resend (3,000/month free) — needs a domain you control:
       1. Sign up at https://resend.com, verify a DOMAIN at resend.com/domains.
          Without that it will only ever deliver to your own address, which is
          the error this project hit.
       2. Supabase → Edge Functions → Secrets: RESEND_API_KEY.
       3. ALERT_FROM_EMAIL must be on that verified domain.

     Neither: the function runs in SIMULATION. Nothing is delivered, and the
     result carries `simulated: true` so no screen can claim otherwise.

   Then: npx supabase functions deploy send-alert-email
   And enable "Email" in Settings → Alerts.
   ============================================================ */

import supabase from './supabase.js'
import { loadAlertSettings } from '../context/AdminDataContext.jsx'
import { isDrillActive } from './drillMode.js'

/** True when the email channel is enabled in AlertSettings. */
export function isEmailEnabled() {
  return Boolean(loadAlertSettings().email)
}

/**
 * Invoke the Supabase Edge Function to email an alert to its audience:
 * CDRRMO command centre city-wide, plus the barangay official and the
 * registered residents of whichever barangay the alert names.
 *
 * Silent no-op if the email channel is disabled, or if both audience toggles
 * are off — reported as a `reason` rather than a bare `skipped`, so the caller
 * can tell "switched off" apart from "nothing to send".
 *
 * @param {{ level: string, title: string, message: string, barangay?: string }} alert
 */
export async function sendAlertEmail({ level, title, message, barangay } = {}) {
  /* Drill mode blocks outbound mail HERE, at the send itself, rather than
     asking each caller to remember. A drill exists precisely to make the
     system act on its own — the auto-alert watcher issuing a real alert is the
     whole point of it — so the guard has to sit where the message would
     actually leave the building, past every caller that might not know a drill
     is running. */
  if (isDrillActive()) {
    console.info('[drill] outbound email blocked:', title)
    return { skipped: true, blockedByDrill: true }
  }
  if (!isEmailEnabled()) return { skipped: true, reason: 'email-off' }

  /* The audience toggles are read HERE and forwarded, rather than being read
     inside the function, for the same reason SMS does it: they live in
     app_settings alongside the rest of Alert Settings, and one screen owning
     them is what keeps "who gets warned" answerable from one place. */
  const cfg = loadAlertSettings()
  const toStaff = cfg.toStaff !== false
  const toResidents = cfg.toResidents !== false
  if (!toStaff && !toResidents) return { skipped: true, reason: 'no-audience' }

  const { data, error } = await supabase.functions.invoke('send-alert-email', {
    body: { level, title, message, barangay, toStaff, toResidents },
  })
  if (error) throw error
  return data
}

/**
 * Which provider the deployed function is actually using — asked of the
 * function itself rather than inferred from settings, because a key set in
 * Supabase secrets is invisible to the browser and the two drift.
 * Returns { provider, configured, from, note }.
 */
export async function emailConfig() {
  const { data, error } = await supabase.functions.invoke('send-alert-email', {
    body: { action: 'config' },
  })
  if (error) throw error
  return data
}

/**
 * Send one test email, to prove the provider works end to end.
 * Blocked during a drill like every other outbound message.
 */
export async function sendTestEmail(email) {
  if (isDrillActive()) return { skipped: true, blockedByDrill: true }
  const { data, error } = await supabase.functions.invoke('send-alert-email', {
    body: {
      action: 'test',
      email,
      level: 'moderate',
      title: 'CDRRMO FloodRoute test message',
      message: 'If you are reading this, alert email is working. No action is needed.',
    },
  })
  if (error) throw error
  return data
}
