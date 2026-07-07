/* ============================================================
   FirstLoginPasswordPrompt — shown after a first sign-in with a
   temporary password.

   Officials (CDRRMO admins + Punong Barangay) are seeded with a
   shared temporary password and flagged must_change_password. On
   login, app_login returns mustChangePassword; this modal greets them
   and lets them set their OWN private password. Changing it clears the
   flag (app_change_password), so it never appears again.

   "Change later" dismisses it for the session only — it returns on the
   next sign-in until they actually change the password. Mounted once in
   RequireAuth, so it covers all three portals.
   ============================================================ */

import { useState } from 'react'
import api from '../services/api.js'
import db from '../services/db.js'
import './FirstLoginPasswordPrompt.css'

const SKIP_KEY = 'cdrrmo_pw_prompt_skipped'

export default function FirstLoginPasswordPrompt() {
  const user = api.getUser()
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(SKIP_KEY) === '1')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // Only for accounts still holding a temporary password.
  if (!user?.mustChangePassword || dismissed || done) return null

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!current) return setError('Enter your temporary password to confirm it is you.')
    if (next.length < 8) return setError('Your new password must be at least 8 characters.')
    if (next !== confirm) return setError('The new passwords do not match.')
    if (next === current) return setError('Please choose a password different from your temporary one.')
    setSaving(true)
    try {
      await db.auth.changePassword(user.id, current, next)
      api.setUser({ ...user, mustChangePassword: false })
      setDone(true)
    } catch (err) {
      setError(err.message || 'Could not change the password. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function skip() {
    sessionStorage.setItem(SKIP_KEY, '1')
    setDismissed(true)
  }

  const firstName = (user.fullName || '').split(' ')[0] || 'there'

  return (
    <div className="flp-overlay" role="dialog" aria-modal="true" aria-label="Set your own password">
      <div className="flp-card">
        <div className="flp-head">
          <span className="flp-icon">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <h3 className="flp-title">Set your own password</h3>
            <p className="flp-sub">Welcome, {firstName}. You signed in with a temporary password.</p>
          </div>
        </div>

        <div className="flp-body">
          <p className="flp-msg">
            You are now allowed to use your <b>own private password</b>. For your account's security,
            please replace the temporary password given to you with one only you know.
          </p>

          <form className="flp-form" onSubmit={submit}>
            <label className="flp-field">
              <span>Temporary (current) password</span>
              <input
                type={reveal ? 'text' : 'password'}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="The password you just used to sign in"
                autoComplete="current-password"
                autoFocus
              />
            </label>
            <label className="flp-field">
              <span>New password</span>
              <input
                type={reveal ? 'text' : 'password'}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>
            <label className="flp-field">
              <span>Confirm new password</span>
              <input
                type={reveal ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-type your new password"
                autoComplete="new-password"
              />
            </label>

            <label className="flp-reveal">
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
              Show passwords
            </label>

            {error && <div className="flp-error">{error}</div>}

            <div className="flp-actions">
              <button type="button" className="flp-btn flp-btn-ghost" onClick={skip} disabled={saving}>
                Change later
              </button>
              <button type="submit" className="flp-btn flp-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save new password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
