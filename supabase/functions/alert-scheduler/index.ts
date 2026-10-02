import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authorizeOperator } from '../_shared/operatorAuth.ts'
import { deliveryOutcome } from '../_shared/scheduledDelivery.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL') || ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return json({ error: 'Server configuration unavailable.' }, 503)
  const db = createClient(url, key)
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* cron has no required payload */ }
  try {
    const actor = await authorizeOperator(req, db, ['admin', 'staff'])
    if (!actor) return json({ error: 'An active operator session is required.' }, 403)
    if (body.action === 'status') {
      const { data, error } = await db.from('app_settings').select('value').eq('key', 'alert_scheduler_status').maybeSingle()
      if (error) throw error
      const jobs = await db.from('alert_delivery_jobs').select('id,alert_id,channel,status,finished_at').order('id', { ascending: false }).limit(20)
      if (jobs.error) throw jobs.error
      return json({ lastRun: data?.value?.lastRun || null, jobs: jobs.data })
    }
    if (actor.role !== 'service_role') return json({ error: 'Only the server scheduler may process deliveries.' }, 403)
    const promoted = await db.rpc('promote_due_alerts')
    if (promoted.error) throw promoted.error
    const cfg = await db.from('app_settings').select('value').eq('key', 'alert_settings').maybeSingle()
    if (cfg.error) throw cfg.error
    // No settings record means no authorization to send through either channel.
    const settings = cfg.data?.value || {}
    const claimed = await db.rpc('claim_scheduled_alert_deliveries')
    if (claimed.error) throw claimed.error
    for (const job of claimed.data || []) {
      let status = 'skipped'
      let result: Record<string, unknown> = { reason: 'Channel disabled' }
      if (settings[job.channel] === true) {
        const record = await db.from('alerts').select('*').eq('id', job.alert_id).maybeSingle()
        if (record.error) throw record.error
        const alert = record.data
        if (alert?.status === 'active' && !String(alert.title).startsWith('[DRILL] ')) {
          const scopes = Array.isArray(alert.barangays) && alert.barangays.length ? alert.barangays : ['All']
          const payload = {
            action: job.channel === 'sms' ? 'broadcast' : 'send', alertId: alert.id,
            level: alert.level, title: alert.title, message: alert.message,
            barangay: scopes[0], barangays: scopes,
            toStaff: settings.toStaff !== false, toOfficials: settings.toOfficials !== false, toResidents: settings.toResidents !== false,
          }
          if (job.channel === 'sms' && settings.toResidents === false) result = { reason: 'Resident audience disabled' }
          else {
            try {
              const response = await fetch(`${url}/functions/v1/${job.channel === 'sms' ? 'sms-alert' : 'send-alert-email'}`, {
                method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload), signal: AbortSignal.timeout(90_000),
              })
              result = await response.json()
              status = deliveryOutcome(result, response.ok)
            } catch {
              status = 'uncertain'
              result = { error: 'Provider acknowledgement unavailable; inspect provider records before resending.' }
            }
          }
        } else result = { reason: 'Alert is inactive or a drill' }
      }
      const saved = await db.from('alert_delivery_jobs').update({ status, result, finished_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'processing')
      if (saved.error) throw saved.error
    }
    const heartbeat = await db.from('app_settings').upsert({ key: 'alert_scheduler_status', value: { lastRun: new Date().toISOString() } }, { onConflict: 'key' })
    if (heartbeat.error) throw heartbeat.error
    return json({ processed: claimed.data?.length || 0 })
  } catch {
    return json({ error: 'Scheduled delivery could not complete. Check backend health and delivery records.' }, 503)
  }
})
