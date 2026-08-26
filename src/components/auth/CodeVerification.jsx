import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Six-box one-time-code entry, shared by the two places a code is asked for:
 * confirming a new resident's email address, and the second factor at sign-in.
 *
 * Phone-first, because that is where residents are:
 *   · `autoComplete="one-time-code"` + `inputMode="numeric"` so iOS and Android
 *     offer the code straight from the notification instead of making someone
 *     switch apps, memorise six digits and switch back.
 *   · Boxes are 48px tall — a real target, and big enough to read outdoors.
 *   · Paste fills all six at once, and typing over a filled box replaces it,
 *     because that is what people actually do with these.
 *
 * The component never decides anything: it collects six digits and calls
 * `onSubmit`. Validity, expiry and attempt limits are the Edge Function's.
 */
export default function CodeVerification({
  email,
  title = 'Check your email',
  blurb,
  submitLabel = 'Verify',
  onSubmit,
  onResend,
  onBack,
  backLabel = 'Use a different email',
  /** Show the "remember this device" option (sign-in only). */
  offerTrust = false,
  trustDays = 30,
  expiresInMinutes = 10,
}) {
  const LEN = 6
  const [digits, setDigits] = useState(() => Array(LEN).fill(''))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [trust, setTrust] = useState(false)
  const [cooldown, setCooldown] = useState(60)
  const inputs = useRef([])
  const submittedFor = useRef('')

  const code = useMemo(() => digits.join(''), [digits])
  const complete = code.length === LEN && digits.every(Boolean)

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  // "Resend" opens after a minute — the server enforces the same cooldown, so
  // showing it earlier would only produce a rejection.
  useEffect(() => {
    if (cooldown <= 0) return undefined
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  const submit = useCallback(async (value) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await onSubmit(value, trust)
    } catch (err) {
      setError(err.message || 'That did not work. Please try again.')
      setDigits(Array(LEN).fill(''))
      submittedFor.current = ''
      inputs.current[0]?.focus()
    } finally {
      setBusy(false)
    }
  }, [busy, onSubmit, trust])

  // Auto-submit once the sixth digit lands. Guarded so a failed code is not
  // resubmitted on every re-render, and so the same value is only tried once.
  useEffect(() => {
    if (complete && !busy && submittedFor.current !== code) {
      submittedFor.current = code
      submit(code)
    }
  }, [complete, code, busy, submit])

  function setAt(i, val) {
    setDigits((d) => {
      const next = [...d]
      next[i] = val
      return next
    })
  }

  function handleChange(i, raw) {
    const only = raw.replace(/\D/g, '')
    if (!only) { setAt(i, ''); return }
    if (only.length > 1) { fill(only, i); return }
    setAt(i, only)
    if (i < LEN - 1) inputs.current[i + 1]?.focus()
  }

  /** Spread a multi-character string across the boxes from `start`. */
  function fill(text, start = 0) {
    const only = text.replace(/\D/g, '').slice(0, LEN - start)
    if (!only) return
    setDigits((d) => {
      const next = [...d]
      for (let k = 0; k < only.length; k++) next[start + k] = only[k]
      return next
    })
    const last = Math.min(start + only.length, LEN - 1)
    inputs.current[last]?.focus()
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace') {
      if (digits[i]) { setAt(i, ''); return }
      // Empty box: step back and clear the previous one, which is what a
      // second backspace is nearly always meant to do.
      if (i > 0) {
        e.preventDefault()
        setAt(i - 1, '')
        inputs.current[i - 1]?.focus()
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault(); inputs.current[i - 1]?.focus()
    } else if (e.key === 'ArrowRight' && i < LEN - 1) {
      e.preventDefault(); inputs.current[i + 1]?.focus()
    }
  }

  async function handleResend() {
    if (cooldown > 0 || busy) return
    setBusy(true)
    setError('')
    try {
      await onResend()
      setNotice(`A new code is on its way to ${email}.`)
      setCooldown(60)
      setDigits(Array(LEN).fill(''))
      submittedFor.current = ''
      inputs.current[0]?.focus()
    } catch (err) {
      setError(err.message || 'Could not send another code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="otp">
      <div className="otp-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>

      <h2 className="otp-title">{title}</h2>
      <p className="otp-blurb">
        {blurb || <>We sent a {LEN}-digit code to</>}
        {' '}
        <b className="otp-email">{email}</b>. It expires in {expiresInMinutes} minutes.
      </p>

      {error && <div className="otp-error" role="alert">{error}</div>}
      {notice && !error && <div className="otp-notice" role="status">{notice}</div>}

      <div className="otp-boxes" onPaste={(e) => {
        e.preventDefault()
        fill(e.clipboardData.getData('text'))
      }}>
        {digits.map((d, i) => (
          <input
            /* eslint-disable-next-line react/no-array-index-key */
            key={i}
            ref={(el) => { inputs.current[i] = el }}
            className={`otp-box ${d ? 'filled' : ''}`.trim()}
            type="text"
            inputMode="numeric"
            /* Only the first box carries this: the OS fills the whole code
               into it and the paste handler spreads it across the rest. */
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={LEN}
            value={d}
            disabled={busy}
            aria-label={`Digit ${i + 1} of ${LEN}`}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>

      {offerTrust && (
        <label className="otp-trust">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
          <span>
            Trust this device for {trustDays} days
            <small>Skip this step next time on this phone. Do not tick it on a shared device.</small>
          </span>
        </label>
      )}

      <button
        type="button"
        className="btn btn-navy btn-full otp-submit"
        disabled={!complete || busy}
        onClick={() => submit(code)}
      >
        {busy ? 'Checking…' : submitLabel}
      </button>

      <div className="otp-actions">
        <button type="button" className="link-inline" onClick={handleResend} disabled={cooldown > 0 || busy}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        </button>
        {onBack && (
          <button type="button" className="link-inline otp-back" onClick={onBack} disabled={busy}>
            {backLabel}
          </button>
        )}
      </div>

      <p className="otp-foot">
        Not seeing it? Check your spam or promotions folder. CDRRMO will never ask
        you for this code by phone or message.
      </p>
    </div>
  )
}
