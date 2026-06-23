import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LEVEL_META: Record<string, { color: string; label: string }> = {
  high:     { color: '#C0181B', label: 'HIGH ALERT' },
  moderate: { color: '#D97706', label: 'ADVISORY' },
  safe:     { color: '#16A34A', label: 'ALL CLEAR' },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not set in Supabase secrets.' }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { level = 'moderate', title, message, barangay, fromEmail } = await req.json()
    const meta = LEVEL_META[level] ?? LEVEL_META.moderate
    const from = fromEmail || 'CDRRMO Alerts <onboarding@resend.dev>'

    // Pull active staff + operator + officer accounts that have emails
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: accounts } = await supabase
      .from('accounts')
      .select('email, full_name, role')
      .in('role', ['admin', 'operator', 'officer', 'staff'])
      .eq('status', 'active')
      .not('email', 'is', null)

    const toList: string[] = (accounts ?? [])
      .map((a: { email: string }) => a.email)
      .filter(Boolean)

    if (!toList.length) {
      return new Response(JSON.stringify({ sent: 0, info: 'No active staff accounts with emails found.' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const barangayLabel = barangay && barangay !== 'All' ? `Barangay ${barangay} · ` : ''
    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
        <div style="background:${meta.color};color:#fff;padding:20px 24px">
          <div style="font-size:12px;letter-spacing:.08em;font-weight:600;opacity:.85">🌊 CDRRMO CABUYAO — FLOOD ${meta.label}</div>
          <div style="font-size:11px;margin-top:4px;opacity:.7">${barangayLabel}Cabuyao City, Laguna</div>
        </div>
        <div style="background:#f8fafc;padding:24px">
          <h2 style="margin:0 0 10px;color:#1e293b;font-size:17px">${title ?? '(no title)'}</h2>
          <p style="color:#475569;line-height:1.6;margin:0 0 20px">${message ?? ''}</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px">
          <p style="color:#94a3b8;font-size:11px;margin:0">
            This alert was issued via CDRRMO FloodRoute. Do not reply to this email.<br>
            For emergencies contact the CDRRMO 24/7 hotline.
          </p>
        </div>
      </div>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: toList,
        subject: `[CDRRMO] ${meta.label}: ${title ?? 'Flood Alert'}`,
        html,
      }),
    })

    const resData = await res.json()
    if (!res.ok) throw new Error(resData.message ?? 'Resend API error')

    return new Response(JSON.stringify({ sent: toList.length, id: resData.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
