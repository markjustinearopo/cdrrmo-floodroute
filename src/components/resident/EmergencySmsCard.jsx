import { useCallback, useEffect, useRef, useState } from 'react'
import {
  subscribeSms, verifySms, smsStatus, unsubscribeSms, smsConfig,
  normalisePhone, formatPhone, SmsFunctionUnavailable,
} from '../../services/smsAlert.js'
import { getResidentBarangay, residentBarangayLabel } from '../../data/resident.js'
import { authApi } from '../../services/api.js'
import './emergencySmsCard.css'

/* ============================================================
   EmergencySmsCard — "text me when it floods".

   The premise of this whole system is that people act on warnings. The premise
   fails if the warning lives on a website nobody has open at 2 a.m. So a
   resident gives one thing — their mobile number — and from then on a CDRRMO
   emergency alert for their barangay reaches them on the lock screen.

   Three commitments, stated on the card itself rather than in a policy page
   nobody opens:

     EMERGENCIES ONLY. There is no other message this channel can carry. The
     server records a `purpose` on every send and will only send 'alert',
     'verify' and 'test'; there is no code path that could grow this into a
     mailing list.

     CONFIRMED, NOT ASSUMED. Nothing is sent until a code texted to the number
     is typed back. Someone typing a stranger's number cannot sign them up.

     REVERSIBLE IN ONE TAP. Opting out is a button on the same card, not an
     email to an office.

   The number is remembered in this browser only so the card can show its own
   state on the next visit. The authoritative record is the server's.
   ============================================================ */

const PHONE_KEY = 'cdrrmo_resident_sms_phone'

function rememberPhone(e164) {
  try {
    if (e164) localStorage.setItem(PHONE_KEY, e164)
    else localStorage.removeItem(PHONE_KEY)
  } catch {
    /* private mode — the card just starts blank next visit */
  }
}

function recallPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) || ''
  } catch {
    return ''
  }
}

export default function EmergencySmsCard({ compact = false }) {
  const barangay = getResidentBarangay()
  const brgyLabel = residentBarangayLabel()

  // 'loading' | 'idle' | 'code' | 'done' | 'offline'
  const [stage, setStage] = useState('loading')
  const [phone, setPhone] = useState('')
  const [saved, setSaved] = useState('')      // E.164 of the confirmed number
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [provider, setProvider] = useState(null)
  const codeRef = useRef(null)

  /* On mount: what does the server think, and is a provider actually wired up?
     Both matter — a card that offers to text someone when nothing can send is
     a promise the system cannot keep. */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const cfg = await smsConfig()
        if (!alive) return
        setProvider(cfg)
      } catch (e) {
        if (!alive) return
        if (e instanceof SmsFunctionUnavailable) {
          setStage('offline')
          return
        }
      }
      const remembered = recallPhone()
      if (!remembered) {
        if (alive) setStage('idle')
        return
      }
      try {
        const st = await smsStatus(remembered)
        if (!alive) return
        if (st.verified) {
          setSaved(remembered)
          setStage('done')
        } else {
          setPhone(formatPhone(remembered))
          setStage('idle')
        }
      } catch {
        if (alive) setStage('idle')
      }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus()
  }, [stage])

  const submitPhone = useCallback(async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const e164 = normalisePhone(phone)
    if (!e164) {
      setError('Enter your mobile number as 0917 123 4567 (or +63 917 123 4567).')
      return
    }
    setBusy(true)
    try {
      const user = authApi.getUser?.()
      const res = await subscribeSms({
        phone: e164,
        barangay,
        fullName: user?.fullName || user?.name || null,
        accountId: Number.isInteger(user?.id) ? user.id : null,
        source: 'resident',
      })
      rememberPhone(e164)
      if (res.verified) {
        // Already confirmed on a previous visit or another device.
        setSaved(e164)
        setStage('done')
        setNotice('This number was already registered for emergency alerts.')
      } else {
        setStage('code')
        setNotice(res.simulated
          ? 'The SMS gateway is in simulation mode, so no text was actually sent. Ask CDRRMO IT to add the provider key.'
          : `We texted a 6-digit code to ${formatPhone(e164)}.`)
      }
    } catch (err) {
      setError(err instanceof SmsFunctionUnavailable
        ? 'The SMS service is not switched on yet. Please try again later.'
        : err.message || 'Could not register that number.')
    } finally {
      setBusy(false)
    }
  }, [phone, barangay])

  const submitCode = useCallback(async (e) => {
    e.preventDefault()
    setError('')
    const e164 = normalisePhone(phone) || recallPhone()
    setBusy(true)
    try {
      await verifySms({ phone: e164, code: code.trim() })
      rememberPhone(e164)
      setSaved(e164)
      setCode('')
      setStage('done')
      setNotice('')
    } catch (err) {
      setError(err.message || 'That code did not work.')
    } finally {
      setBusy(false)
    }
  }, [phone, code])

  const resend = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      const e164 = normalisePhone(phone) || recallPhone()
      const res = await subscribeSms({ phone: e164, barangay, source: 'resident' })
      setNotice(res.simulated
        ? 'Simulation mode — no text was sent.'
        : 'A new code is on its way.')
    } catch (err) {
      setError(err.message || 'Could not send another code.')
    } finally {
      setBusy(false)
    }
  }, [phone, barangay])

  const optOut = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      await unsubscribeSms(saved)
      rememberPhone(null)
      setSaved('')
      setPhone('')
      setStage('idle')
      setNotice('You will no longer receive emergency text alerts.')
    } catch (err) {
      setError(err.message || 'Could not opt out. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [saved])

  if (stage === 'loading') {
    return (
      <section className={`esms ${compact ? 'esms--compact' : ''}`}>
        <div className="esms-loading"><span className="esms-spinner" /> Checking your alert settings…</div>
      </section>
    )
  }

  if (stage === 'offline') {
    return (
      <section className={`esms ${compact ? 'esms--compact' : ''} esms--offline`}>
        <div className="esms-head">
          <PhoneIcon />
          <div>
            <h3>Emergency text alerts</h3>
            <p>
              Not available right now — the text-alert service could not be
              reached. Keep checking this page for warnings, and try again later.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className={`esms ${compact ? 'esms--compact' : ''} ${stage === 'done' ? 'esms--on' : ''}`}>
      <div className="esms-head">
        <PhoneIcon />
        <div>
          <h3>
            Emergency text alerts
            {stage === 'done' && <span className="esms-badge">ON</span>}
          </h3>
          <p>
            {stage === 'done'
              ? `We will text ${formatPhone(saved)} when CDRRMO raises an emergency for Brgy. ${brgyLabel}.`
              /* "your barangay, and citywide in an emergency" is the literal
                 rule the broadcast now follows: advisories are scoped, but an
                 EMERGENCY ignores barangay lines because floodwater does. Worth
                 the extra clause — a resident who signs up expecting only local
                 texts should not be surprised by a citywide one, and a resident
                 outside the named barangay should know they are still covered. */
              : 'Get a text the moment CDRRMO raises a flood emergency — for your barangay, and citywide when it is an emergency. Even if you never open this site.'}
          </p>
        </div>
      </div>

      {/* Simulation is stated plainly. A resident who thinks they are covered
          and is not is worse off than one who was never offered the option. */}
      {provider?.simulation && stage !== 'done' && (
        <div className="esms-sim">
          <b>Demonstration mode.</b> No SMS provider key is configured, so codes
          and alerts are recorded but not delivered to a handset.
        </div>
      )}

      {stage === 'idle' && (
        <form className="esms-form" onSubmit={submitPhone}>
          <label htmlFor="esms-phone">Your mobile number</label>
          <div className="esms-row">
            <span className="esms-prefix">+63</span>
            <input
              id="esms-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="0917 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="esms-btn" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
          <p className="esms-fine">
            Emergency alerts only — flood warnings, evacuation calls and
            all-clears for Brgy. {brgyLabel}. Never advertising. You can stop
            them any time from this card. Standard network charges may apply.
          </p>
        </form>
      )}

      {stage === 'code' && (
        <form className="esms-form" onSubmit={submitCode}>
          <label htmlFor="esms-code">Enter the 6-digit code we texted you</label>
          <div className="esms-row">
            <input
              id="esms-code"
              ref={codeRef}
              className="esms-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
            />
            <button type="submit" className="esms-btn" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Confirm'}
            </button>
          </div>
          <div className="esms-actions">
            <button type="button" className="esms-link" onClick={resend} disabled={busy}>
              Send another code
            </button>
            <button
              type="button"
              className="esms-link"
              onClick={() => { setStage('idle'); setCode(''); setError(''); setNotice('') }}
            >
              Use a different number
            </button>
          </div>
        </form>
      )}

      {stage === 'done' && (
        <div className="esms-done">
          <div className="esms-confirm">
            <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
            <span>
              <b>{formatPhone(saved)}</b> is registered for emergency alerts
              {barangay ? <> · Brgy. {brgyLabel}</> : null}
            </span>
          </div>
          <button type="button" className="esms-optout" onClick={optOut} disabled={busy}>
            {busy ? 'Working…' : 'Stop text alerts'}
          </button>
        </div>
      )}

      {error && <div className="esms-error" role="alert">{error}</div>}
      {notice && !error && <div className="esms-notice">{notice}</div>}
    </section>
  )
}

function PhoneIcon() {
  return (
    <svg className="esms-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      <line x1="10" y1="18.5" x2="14" y2="18.5" />
    </svg>
  )
}
