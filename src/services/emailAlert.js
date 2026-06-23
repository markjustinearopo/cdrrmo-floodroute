/* ============================================================
   emailAlert.js — send flood-alert emails via the Supabase
   Edge Function (send-alert-email) which uses Resend internally.

   Usage:
     import { sendAlertEmail, isEmailEnabled } from './emailAlert.js'
     sendAlertEmail({ level, title, message, barangay }).catch(console.warn)

   Setup (one-time):
     1. Sign up at https://resend.com (free, no credit card).
     2. Get your API key.
     3. In Supabase dashboard → Edge Functions → Secrets: add RESEND_API_KEY.
     4. Deploy the function: npx supabase functions deploy send-alert-email
     5. In Integrations screen: configure "Email Alerts (Resend)" and enable it.
   ============================================================ */

import supabase from './supabase.js'
import { loadAlertSettings } from '../context/AdminDataContext.jsx'

/** True when the email channel is enabled in AlertSettings. */
export function isEmailEnabled() {
  return Boolean(loadAlertSettings().email)
}

/**
 * Invoke the Supabase Edge Function to send alert emails to all active
 * CDRRMO staff accounts. Silent no-op if the email channel is disabled.
 *
 * @param {{ level: string, title: string, message: string, barangay?: string }} alert
 */
export async function sendAlertEmail({ level, title, message, barangay } = {}) {
  if (!isEmailEnabled()) return { skipped: true }
  const { data, error } = await supabase.functions.invoke('send-alert-email', {
    body: { level, title, message, barangay },
  })
  if (error) throw error
  return data
}
