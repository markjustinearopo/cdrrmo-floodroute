import { useState } from 'react'
import { authApi } from '../../services/api.js'
import './codeVerification.css'

/**
 * Password reset, on the login screen.
 *
 * Two steps in one component because they are one thought: "I forgot my
 * password" → "here is the code and my new one". Splitting them across routes
 * would lose the address between them and make a person who is already locked
 * out type it twice.
 *
 * The first step ALWAYS reports success, whether or not the account exists —
 * the server answers identically by design. A reset form that says "no such
 * account" is an account-enumeration oracle: aim it at a list of addresses and
 * it tells you which ones are real CDRRMO officials.
 */
export default function PasswordReset({ onDone, onCancel }) {
  const [step, setStep] = useState('ask') // 'ask' | 'code'
  const [identifier, setIdentifier] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function sendCode(e) {
    e.preventDefault()
    if (!identifier.trim()) return setError('Enter your email or Staff ID.')
    setError(''); setBusy(true)
    try {
      const res = await authApi.requestReset(identifier.trim())
      setEmail(identifier.trim())
      setNotice(res?.message || 'If that account exists, a reset code is on its way.')
      setStep('code')
    } catch (err) {
      setError(err.message || 'Could not start the reset. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function finish(e) {
    e.preventDefault()
    if (pw.length < 8) return setError('Choose a password of at least 8 characters.')
    if (pw !== pw2) return setError('The two passwords do not match.')
    setError(''); setBusy(true)
    try {
      await authApi.confirmReset(email, code.trim(), pw)
      onDone()
    } catch (err) {
      setError(err.message || 'That code was not accepted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="otp">
      <h2 className="otp-title">Reset your password</h2>

      {step === 'ask' ? (
        <form onSubmit={sendCode}>
          <p className="otp-blurb">
            Enter the email address or Staff ID on your account. If it exists,
            we will send a 6-digit code.
          </p>
          <div className="field-group">
            <label htmlFor="reset-id">Email or Staff ID</label>
            <input
              id="reset-id"
              type="text"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com or BCL-001"
            />
          </div>
          {error && <div className="otp-error" role="alert">{error}</div>}
          <button type="submit" className="otp-submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset code'}
          </button>
          <button type="button" className="otp-back" onClick={onCancel}>
            Back to sign in
          </button>
        </form>
      ) : (
        <form onSubmit={finish}>
          <p className="otp-blurb">{notice}</p>
          <div className="field-group">
            <label htmlFor="reset-code">6-digit code</label>
            <input
              id="reset-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
            />
          </div>
          <div className="field-group">
            <label htmlFor="reset-pw">New password</label>
            <input
              id="reset-pw"
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="field-group">
            <label htmlFor="reset-pw2">Confirm new password</label>
            <input
              id="reset-pw2"
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Type it again"
            />
          </div>
          {error && <div className="otp-error" role="alert">{error}</div>}
          <button type="submit" className="otp-submit" disabled={busy}>
            {busy ? 'Setting…' : 'Set password and sign in'}
          </button>
          <button type="button" className="otp-back" onClick={onCancel}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
