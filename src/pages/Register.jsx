import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import BrandPanel from '../components/BrandPanel.jsx'
import Modal from '../components/Modal.jsx'
import CodeVerification from '../components/auth/CodeVerification.jsx'
import '../components/auth/codeVerification.css'
import {
  DocIcon,
  ShieldIcon,
  SupportIcon,
  TermsContent,
  PrivacyContent,
  ContactContent,
} from '../components/policyContent.jsx'
import { EyeIcon, EyeOffIcon } from './Login.jsx'
import { authApi } from '../services/api.js'
import { OFFICIAL_BRGY_KEY } from '../data/barangay.js'
import { getSystemConfig, loadSystemConfigRemote } from '../services/systemConfig.js'
import { normalisePhone, formatPhone } from '../services/smsAlert.js'
import './auth.css'
import './Register.css'

/**
 * Create Account — resident self-registration.
 *
 * Two steps, because an address nobody proved is not an identity:
 *   1. the form (with a live password-strength meter and a silent human check)
 *   2. a six-digit code mailed to the address, which activates the account
 *
 * The human check has three parts and none of them ask the reader to do
 * anything: a honeypot field, how long the form took to fill, and a
 * proof-of-work puzzle solved in the background while they type. A hosted
 * CAPTCHA was rejected on purpose — it needs a third-party script and key, it
 * ships the visitor's data to that third party, and image puzzles routinely
 * lock out exactly the residents this system exists for.
 *
 * Everything here is a convenience for a real person; every one of these
 * controls is re-checked server-side in the auth-otp Edge Function, which is
 * where they are actually enforced.
 */

// The 18 barangays of Cabuyao City (same list as the Barangay login dropdown).
const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

/* Indexed BY SCORE (0-4), not by score-1.

   scorePassword returns 0 for a password that meets none of the four
   criteria — the weakest input possible. The arrays were four long and read
   with `labels[score - 1]`, so score 0 hit labels[-1] → undefined → the
   `|| ''` fallback rendered nothing. The one password that most needed a
   warning was the only one that got none, while "a" plus a capital showed a
   reassuring "Weak". Five entries now, read directly by score. */
const STRENGTH = {
  colors: ['#EF4444', '#EF4444', '#F97316', '#EAB308', '#22C55E'],
  labels: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'],
  labelColors: ['#991B1B', '#991B1B', '#9A3412', '#854D0E', '#166534'],
}

function scorePassword(val) {
  let score = 0
  if (val.length >= 8) score++
  if (/[A-Z]/.test(val)) score++
  if (/[0-9]/.test(val)) score++
  if (/[^A-Za-z0-9]/.test(val)) score++
  return score
}

export default function Register() {
  const navigate = useNavigate()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  // Optional, and the most useful field on this form. It is how the
  // verification code reaches a resident whose email we cannot deliver to,
  // and how an emergency alert reaches them at 2 a.m. when nobody is on a
  // website. Optional because requiring it would exclude anyone without a
  // mobile from having an account at all.
  const [mobile, setMobile] = useState('')
  const [barangay, setBarangay] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [terms, setTerms] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [modal, setModal] = useState(null) // active popup, or null
  // New-account creation can be closed by an admin on System Configuration.
  const [registrationOpen, setRegistrationOpen] = useState(getSystemConfig().allowRegistration)

  /* ── Step 2: verification ── */
  const [step, setStep] = useState('form') // 'form' | 'verify'
  // Which channel carried the code, so the screen can point at the right
  // inbox — telling someone to "check your email" when it went to their
  // phone is how a verification step becomes a dead end.
  const [channel, setChannel] = useState(null) // 'sms' | 'email' | null
  const [maskedPhone, setMaskedPhone] = useState(null)
  // Set when the server could deliver on neither channel and activated the
  // account anyway. The reader is told, in as many words.
  const [fallbackNotice, setFallbackNotice] = useState('')

  /* ── Human check ──
     `human.state` is 'pending' while the proof-of-work runs, 'ok' once solved,
     'failed' if the challenge could not be fetched. The honeypot and the
     elapsed-time reading are collected silently alongside it. */
  const [human, setHuman] = useState({ state: 'pending', challenge: null, solution: null, bits: 16 })
  const [honeypot, setHoneypot] = useState('')
  const startedAt = useRef(Date.now())

  useEffect(() => {
    document.body.classList.add('auth-body')
    return () => document.body.classList.remove('auth-body')
  }, [])

  /* Fetch and solve the proof-of-work as soon as the form mounts, so it is
     long finished by the time anyone has typed a password. Solving is chunked
     (see solveChallenge) so the form never stops responding. */
  const runHumanCheck = useCallback(async () => {
    setHuman({ state: 'pending', challenge: null, solution: null, bits: 16 })
    try {
      const { challenge, bits } = await authApi.requestChallenge()
      const solution = await authApi.solveChallenge(challenge, bits)
      setHuman({ state: 'ok', challenge, solution, bits })
    } catch (err) {
      // 'unavailable' = the auth-otp function is not deployed yet. Sign-up
      // still works (api.js falls back to the legacy RPC) but without the
      // human check or the email gate, so the form says so plainly rather
      // than either blocking everyone or pretending it verified something.
      const unavailable = err?.name === 'AuthFunctionUnavailable'
      setHuman({ state: unavailable ? 'unavailable' : 'failed', challenge: null, solution: null, bits: 16 })
    }
  }, [])

  useEffect(() => {
    runHumanCheck()
  }, [runHumanCheck])

  // Confirm against the shared backend whether self-registration is open.
  useEffect(() => {
    let alive = true
    loadSystemConfigRemote().then((c) => { if (alive) setRegistrationOpen(c.allowRegistration) })
    return () => { alive = false }
  }, [])

  const score = scorePassword(password)
  const strengthLabel = password.length > 0 ? STRENGTH.labels[score] : ''
  const strengthColor = password.length > 0 ? STRENGTH.labelColors[score] : ''

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (!registrationOpen) {
      setError('New account registration is currently closed by the CDRRMO administrator. Please contact your barangay office.')
      return
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name.')
      return
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!barangay) {
      setError('Please select your barangay.')
      return
    }
    if (mobile.trim() && !normalisePhone(mobile)) {
      setError('Enter your mobile number as 0917 123 4567, or leave it blank.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirmPw) {
      setError('Passwords do not match.')
      return
    }
    if (!terms) {
      setError('Please accept the Terms of Service and Privacy Policy.')
      return
    }
    if (human.state === 'failed') {
      setError('Human verification could not run. Check your connection and reload the page.')
      return
    }
    if (human.state === 'pending') {
      setError('Still running the security check — this takes a moment. Please try again.')
      return
    }

    setSubmitting(true)
    const fullName = `${firstName.trim()} ${lastName.trim()}`
    try {
      const res = await authApi.registerResident({
        email,
        password,
        fullName,
        barangay,
        phone: mobile.trim() ? normalisePhone(mobile) : null,
        challenge: human.challenge,
        solution: human.solution,
        elapsedMs: Date.now() - startedAt.current,
        website: honeypot, // honeypot — a real person leaves this empty
      })
      if (res?.degraded) {
        // The verification service is not deployed, so no code was sent —
        // asking for one would strand the user on a screen they cannot pass.
        localStorage.setItem(OFFICIAL_BRGY_KEY, barangay)
        setSuccess(true)
        setTimeout(() => navigate('/login'), 1800)
        return
      }
      if (res?.unverifiedFallback) {
        /* No channel could carry a code, so the server activated the account
           and signed us in rather than creating another resident who can
           never open their own account. Say what happened — a silent
           success here is how the previous failure went unnoticed. */
        localStorage.setItem(OFFICIAL_BRGY_KEY, barangay)
        setFallbackNotice(res.notice || 'Your account was activated without a verification code.')
        setSuccess(true)
        setTimeout(() => navigate(res.user ? '/resident/dashboard' : '/login'), 3200)
        return
      }
      // The account exists but is PENDING. It cannot sign in until the code
      // sent to this address (or phone) is entered, so nothing is scoped or
      // stored yet.
      setChannel(res?.channel || 'email')
      setMaskedPhone(res?.phone || null)
      setStep('verify')
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
      // A challenge is single-use on the server side, so a retry needs a new
      // one — otherwise the second attempt fails the check rather than the
      // reason the first one failed.
      runHumanCheck()
    } finally {
      setSubmitting(false)
    }
  }

  /** Code entered — activates the account and signs the resident straight in. */
  async function handleVerify(code) {
    const res = await authApi.verifyEmail(email, code)
    // Scope the resident portal to the barangay chosen at sign-up. Only now,
    // once the address is proven and a session exists.
    localStorage.setItem(OFFICIAL_BRGY_KEY, barangay)
    setSuccess(true)
    setTimeout(() => navigate(res?.user ? '/resident/dashboard' : '/login'), 900)
  }

  return (
    <>
      <div className="page-bg" />

      <div className="page-wrapper">
        <BrandPanel />

        {/* ── Right: Register Card ── */}
        <div className="register-card">
          {step === 'verify' ? (
            <>
              <CodeVerification
                email={channel === 'sms' && maskedPhone ? maskedPhone : email}
                title={channel === 'sms' ? 'Confirm your mobile number' : 'Confirm your email'}
                blurb={channel === 'sms'
                  ? <>Your account is created but not active yet. Enter the 6-digit code we <b>texted</b> to</>
                  : <>Your account is created but not active yet. Enter the 6-digit code we sent to</>}
                submitLabel="Verify & continue"
                onSubmit={handleVerify}
                onResend={() => authApi.resendCode(email, 'verify_email')}
                onBack={() => { setStep('form'); setError(''); runHumanCheck() }}
                backLabel={channel === 'sms' ? 'Use different details' : 'Use a different email'}
              />
              {success && (
                <div className="success-msg show" style={{ marginTop: 14 }}>
                  Email verified — taking you to your dashboard…
                </div>
              )}
            </>
          ) : (
          <>
          <div className="card-header-row">
            <div className="header-icon">
              <svg viewBox="0 0 24 24">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div className="header-text">
              <h2>Create Account</h2>
              <p>Cabuyao CDRRMO Portal</p>
            </div>
          </div>

          {/* Error / Success messages */}
          <div className={`error-msg ${error ? 'show' : ''}`}>{error}</div>
          <form onSubmit={handleRegister}>
            {/* Honeypot. Off-screen and hidden from assistive tech, so no real
                person is ever shown it; automated fillers populate every field
                they find and give themselves away. */}
            <div className="hp-field" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                type="text"
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            {/* Name row */}
            <div className="name-row">
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label htmlFor="first-name">First Name</label>
                <input
                  type="text"
                  id="first-name"
                  placeholder="Juan"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="field-group" style={{ marginBottom: 0 }}>
                <label htmlFor="last-name">Last Name</label>
                <input
                  type="text"
                  id="last-name"
                  placeholder="Dela Cruz"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            {/* Email */}
            <div className="field-group" style={{ marginTop: 16 }}>
              <label htmlFor="email">Email Address</label>
              <input
                type="email"
                id="email"
                placeholder="juan@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {/* Mobile number — optional, and doing real work: it carries the
                verification code when email cannot, and it is the address an
                emergency alert is sent to. */}
            <div className="field-group">
              <label htmlFor="mobile">
                Mobile Number <span className="label-hint">optional, recommended</span>
              </label>
              <input
                type="tel"
                id="mobile"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0917 123 4567"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
              <p className="field-note">
                Used to text you emergency flood alerts for your barangay, and to
                send your verification code. Emergencies only — never advertising,
                and you can stop them any time from your Alerts screen.
                {normalisePhone(mobile) && (
                  <span className="field-note-ok"> Reads as {formatPhone(normalisePhone(mobile))}.</span>
                )}
              </p>
            </div>

            {/* Barangay */}
            <div className="field-group">
              <label htmlFor="barangay">Barangay</label>
              <select
                id="barangay"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
              >
                <option value="" disabled>
                  Select your barangay ▾
                </option>
                {BARANGAYS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Password */}
            <div className="field-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper">
                <input
                  type={showPw ? 'text' : 'password'}
                  id="password"
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-pw"
                  tabIndex={-1}
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {/* Strength bar */}
              <div className="strength-bar-wrap">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="strength-seg"
                    style={{
                      background:
                        i < score ? STRENGTH.colors[score] : 'var(--color-border)',
                    }}
                  />
                ))}
              </div>
              <div className="strength-label" style={{ color: strengthColor }}>
                {strengthLabel}
              </div>
            </div>

            {/* Confirm Password */}
            <div className="field-group">
              <label htmlFor="confirm-pw">Confirm Password</label>
              <div className="input-wrapper">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  id="confirm-pw"
                  placeholder="Re-enter your password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                />
                <button
                  type="button"
                  className="toggle-pw"
                  tabIndex={-1}
                  onClick={() => setShowConfirm((s) => !s)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            {/* Terms */}
            {/* The sentence is one <span>, not loose text nodes: .terms-row is
                a flex container, so bare text and buttons became separate flex
                items on a single non-wrapping line — which ran "Privacy Policy"
                off the right edge of the card on a phone. As one child it wraps
                like the sentence it is. */}
            <label className="terms-row">
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
              />
              <span className="terms-text">
                I accept the{' '}
                <button
                  type="button"
                  className="link-inline"
                  onClick={() => setModal('terms')}
                >
                  Terms of Service
                </button>{' '}
                and{' '}
                <button
                  type="button"
                  className="link-inline"
                  onClick={() => setModal('privacy')}
                >
                  Privacy Policy
                </button>
              </span>
            </label>

            {/* Human check. Nothing to solve — this only reports what already
                ran in the background, so the reader knows why the button was
                briefly unavailable rather than thinking the form is broken. */}
            <div className={`human-check ${human.state === 'ok' ? 'ok' : ''} ${human.state === 'failed' ? 'failed' : ''}`.replace(/\s+/g, ' ').trim()}>
              <span className="human-check-icon">
                {human.state === 'pending' && <span className="human-spinner" />}
                {human.state === 'ok' && (
                  <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
                )}
                {(human.state === 'failed' || human.state === 'unavailable') && (
                  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                )}
              </span>
              <span>
                {human.state === 'pending' && <><b>Running security check…</b><small>No puzzle to solve — keep filling in the form.</small></>}
                {human.state === 'ok' && <><b>Security check passed</b><small>Verified without a CAPTCHA.</small></>}
                {human.state === 'unavailable' && (
                  <>
                    <b>Verification service is offline</b>
                    <small>
                      Account creation may be unavailable until CDRRMO IT deploys
                      it. Existing accounts can still sign in normally.
                    </small>
                  </>
                )}
                {human.state === 'failed' && (
                  <>
                    <b>Security check could not run</b>
                    <small>
                      Check your connection, then{' '}
                      <button type="button" className="link-inline" onClick={runHumanCheck}>try again</button>.
                    </small>
                  </>
                )}
              </span>
            </div>

            {success && (
              <div className="success-msg show" style={{ marginBottom: 12 }}>
                {fallbackNotice || 'Account created. Taking you to the sign-in page…'}
              </div>
            )}

            {!registrationOpen && (
              <div className="error-msg show" role="alert" aria-live="assertive" style={{ marginBottom: 12 }}>
                New account registration is currently closed by the CDRRMO administrator.
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-navy btn-full"
              disabled={submitting || !registrationOpen || human.state === 'pending'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
              {submitting ? 'Creating account…'
                : !registrationOpen ? 'Registration Closed'
                : human.state === 'pending' ? 'Security check…'
                : 'Create Account'}
            </button>
          </form>

          {/* Footer */}
          <div className="card-footer">
            <div className="secure-badge">Secure Government Portal</div>
            <p className="footer-link">
              Already have an account? <Link to="/login">Sign in</Link>
            </p>
            <p className="footer-link mt-2">
              Having trouble?{' '}
              <button
                type="button"
                className="link-inline"
                onClick={() => setModal('contact')}
              >
                Contact CDRRMO IT Support
              </button>
            </p>
            <p className="system-version">Cabuyao City DRRMO © 2026 · v1</p>
          </div>
          </>
          )}
        </div>
      </div>

      {/* ── Popups ── */}
      {modal === 'terms' && (
        <Modal title="Terms of Service" icon={<DocIcon />} onClose={() => setModal(null)}>
          <TermsContent />
        </Modal>
      )}

      {modal === 'privacy' && (
        <Modal title="Privacy Policy" icon={<ShieldIcon />} onClose={() => setModal(null)}>
          <PrivacyContent />
        </Modal>
      )}

      {modal === 'contact' && (
        <Modal
          title="Contact CDRRMO IT Support"
          icon={<SupportIcon />}
          onClose={() => setModal(null)}
        >
          <ContactContent />
        </Modal>
      )}
    </>
  )
}
