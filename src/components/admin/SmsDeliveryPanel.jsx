import { useCallback, useEffect, useState } from 'react'
import { smsOutbox, smsStats, smsConfig, SmsFunctionUnavailable } from '../../services/smsAlert.js'
import './smsDeliveryPanel.css'

/* ============================================================
   SmsDeliveryPanel — did the text actually go out?

   An alerting system's most dangerous property is that "issued" and
   "delivered" look identical from the operator's chair. This panel is the
   difference. It answers three questions, in the order an operator asks them
   during an incident:

     Can we reach anyone?   → the provider state and the confirmed-number count
     Who did we reach?      → coverage per barangay
     What actually went?    → the outbox, per message, with its outcome

   Phone numbers arrive already masked from the Edge Function — an operator
   auditing a dispatch needs to know a message went out and to how many people,
   not a downloadable list of every resident's mobile number.
   ============================================================ */

const STATUS_LABEL = {
  sent: 'Delivered',
  simulated: 'Simulated',
  failed: 'Failed',
  queued: 'Queued',
}

function timeLabel(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Manila',
  })
}

export default function SmsDeliveryPanel() {
  const [cfg, setCfg] = useState(null)
  const [stats, setStats] = useState(null)
  const [messages, setMessages] = useState([])
  const [state, setState] = useState('loading') // loading | ready | offline | error
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [c, s, o] = await Promise.all([smsConfig(), smsStats(), smsOutbox(25)])
      setCfg(c)
      setStats(s)
      setMessages(o.messages || [])
      setState('ready')
    } catch (e) {
      if (e instanceof SmsFunctionUnavailable) {
        setState('offline')
      } else {
        setError(e.message || 'Could not read the SMS channel state.')
        setState('error')
      }
    }
  }, [])

  useEffect(() => {
    load()
    /* Slow poll. During an incident the operator wants the delivery count to
       move without them reloading; outside one, this is a page nobody is
       watching, so 20 s rather than the 6 s the operational tables use. */
    const id = setInterval(load, 20000)
    return () => clearInterval(id)
  }, [load])

  if (state === 'loading') {
    return (
      <section className="smsp">
        <div className="smsp-loading"><span className="smsp-spinner" /> Checking the SMS channel…</div>
      </section>
    )
  }

  if (state === 'offline') {
    return (
      <section className="smsp smsp--offline">
        <div className="smsp-head">
          <PhoneIcon />
          <div>
            <h3>Emergency SMS</h3>
            <p>
              <b>Unreachable.</b> Either the service is not deployed or this
              machine is offline. To deploy it: apply{' '}
              <code>supabase/migrations/20260827120000_sms_emergency_alerts.sql</code>,
              then run <code>npx supabase functions deploy sms-alert</code>.
              Until it responds, alerts reach only people who already have
              this site open.
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (state === 'error') {
    return (
      <section className="smsp smsp--offline">
        <div className="smsp-head">
          <PhoneIcon />
          <div>
            <h3>Emergency SMS</h3>
            <p>{error}</p>
          </div>
        </div>
      </section>
    )
  }

  const sim = cfg?.simulation
  const barangays = Object.entries(stats?.byBarangay || {}).sort((a, b) => b[1] - a[1])

  return (
    <section className={`smsp ${sim ? 'smsp--sim' : 'smsp--live'}`}>
      <div className="smsp-head">
        <PhoneIcon />
        <div className="smsp-head-text">
          <h3>
            Emergency SMS
            <span className={`smsp-pill ${sim ? 'sim' : 'live'}`}>
              {sim ? 'Simulation' : `Live · ${cfg.provider}`}
            </span>
          </h3>
          <p>
            {sim
              ? 'No provider key is configured. Every alert is recorded below but NOT delivered to a handset. Add SEMAPHORE_API_KEY to the Supabase secrets to go live.'
              : `Alerts are texted to confirmed numbers through ${cfg.provider}${cfg.senderName ? ` as "${cfg.senderName}"` : ''}.`}
          </p>
        </div>
        <button type="button" className="smsp-refresh" onClick={load} title="Refresh now">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" /></svg>
        </button>
      </div>

      <div className="smsp-stats">
        <div className="smsp-stat">
          <span className="smsp-stat-val">{stats?.verified ?? 0}</span>
          <span className="smsp-stat-lbl">confirmed numbers</span>
        </div>
        <div className="smsp-stat">
          <span className="smsp-stat-val">{stats?.pending ?? 0}</span>
          <span className="smsp-stat-lbl">awaiting confirmation</span>
        </div>
        <div className="smsp-stat">
          <span className="smsp-stat-val">{stats?.optedOut ?? 0}</span>
          <span className="smsp-stat-lbl">opted out</span>
        </div>
        <div className="smsp-stat">
          <span className="smsp-stat-val">{barangays.length}</span>
          <span className="smsp-stat-lbl">barangays covered</span>
        </div>
      </div>

      {stats?.verified === 0 && (
        <div className="smsp-warn">
          <b>No confirmed numbers yet.</b> An SMS alert issued right now would reach
          nobody. Residents opt in from their Alerts screen; you can also point
          them at it during a barangay assembly.
        </div>
      )}

      {barangays.length > 0 && (
        <div className="smsp-coverage">
          {barangays.map(([name, n]) => (
            <span key={name} className="smsp-chip">
              {name}<b>{n}</b>
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        className="smsp-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className={open ? 'open' : ''}><polyline points="6 9 12 15 18 9" /></svg>
        {open ? 'Hide' : 'Show'} recent messages ({messages.length})
      </button>

      {open && (
        messages.length === 0 ? (
          <div className="smsp-empty">Nothing sent yet.</div>
        ) : (
          <ul className="smsp-list">
            {messages.map((m) => (
              <li key={m.id} className={`smsp-msg ${m.status}`}>
                <div className="smsp-msg-top">
                  <span className={`smsp-status ${m.status}`}>{STATUS_LABEL[m.status] || m.status}</span>
                  <span className="smsp-msg-to">{m.phone}</span>
                  {m.barangay && <span className="smsp-msg-brgy">{m.barangay}</span>}
                  <span className="smsp-msg-time">{timeLabel(m.created_at)}</span>
                </div>
                <div className="smsp-msg-body">{m.body}</div>
                {m.error && <div className="smsp-msg-error">{m.error}</div>}
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  )
}

function PhoneIcon() {
  return (
    <svg className="smsp-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      <line x1="10" y1="18.5" x2="14" y2="18.5" />
    </svg>
  )
}
