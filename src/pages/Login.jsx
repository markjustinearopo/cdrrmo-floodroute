import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import BrandPanel from '../components/BrandPanel.jsx'
import Modal from '../components/Modal.jsx'
import {
  DocIcon,
  SupportIcon,
  TermsContent,
  PrivacyContent,
  ContactContent,
} from '../components/policyContent.jsx'
import CodeVerification from '../components/auth/CodeVerification.jsx'
import { authApi, getRoleForRedirect } from '../services/api.js'
import { OFFICIAL_BRGY_KEY } from '../data/barangay.js'
import './auth.css'
import './Login.css'
import '../components/auth/codeVerification.css'

/**
 * Login / System Access. Three role panels (CDRRMO Admin, Brgy. Officials,
 * Resident) with a password-visibility toggle and credential validation.
 *
 * The password is only the first factor. `authApi.login` can come back three
 * ways and this screen has a state for each:
 *   · signed in            — 2FA is off for the account, or this device is
 *                            already trusted
 *   · `mfaRequired`        — a code has been mailed; show the code step
 *   · `unverified`         — the address was never confirmed (a resident who
 *                            abandoned sign-up). A fresh code goes out and the
 *                            same code step finishes the job, rather than
 *                            dead-ending them on an error.
 */

export default function Login() {
  const navigate = useNavigate()
  const [role, setRole] = useState('admin')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // form fields
  const [adminId, setAdminId] = useState('')
  const [adminPw, setAdminPw] = useState('')
  const [staffId, setStaffId] = useState('')
  const [brgyPw, setBrgyPw] = useState('')
  const [resEmail, setResEmail] = useState('')
  const [resPw, setResPw] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [modal, setModal] = useState(null) // active popup, or null

  /* Second-factor / verification step. `challenge.kind` is 'mfa' or 'verify'. */
  const [challenge, setChallenge] = useState(null)

  // keep the dark red backdrop only while this page is mounted
  useEffect(() => {
    document.body.classList.add('auth-body')
    return () => document.body.classList.remove('auth-body')
  }, [])

  function switchRole(next) {
    setRole(next)
    setError('')
  }

  async function handleLogin(e) {
    e.preventDefault()
    let email = ''
    let password = ''

    if (role === 'admin') {
      email = adminId.trim()
      password = adminPw.trim()
    } else if (role === 'barangay') {
      email = staffId.trim()
      password = brgyPw.trim()
      // No barangay to collect: jurisdiction comes from the account itself.
    } else {
      email = resEmail.trim()
      password = resPw.trim()
      if (!acceptTerms) {
        setError('Please accept the Terms & Privacy Policy to continue.')
        return
      }
    }

    if (!email || !password) {
      setError('Please fill in all required fields.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      const res = await authApi.login(email, password)

      if (res.mfaRequired) {
        setChallenge({ kind: 'mfa', email: res.email, role })
        return
      }
      if (res.unverified) {
        setChallenge({ kind: 'verify', email: res.email, role })
        return
      }
      finishLogin(res.user, role)
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Common tail for every route into a session — password-only, after the
   * second factor, or after a late email verification. Jurisdiction is
   * server-authoritative: an official is scoped to the barangay on their own
   * account, which travels as a signed claim and is enforced by RLS.
   */
  function finishLogin(user, forRole) {
    if (forRole === 'barangay') {
      localStorage.setItem(OFFICIAL_BRGY_KEY, user.barangay || '')
    }
    if (user.role === 'resident' && user.barangay) {
      localStorage.setItem(OFFICIAL_BRGY_KEY, user.barangay)
    }
    navigate(getRoleForRedirect(user.role))
  }

  /** Second factor: the emailed code, plus the optional trusted-device tick. */
  async function handleMfa(code, trustDevice) {
    const user = await authApi.completeMfa(challenge.email, code, trustDevice)
    finishLogin(user, challenge.role)
  }

  /** Late email verification for an account that never finished sign-up. */
  async function handleVerify(code) {
    const res = await authApi.verifyEmail(challenge.email, code)
    if (res?.user) finishLogin(res.user, challenge.role)
  }

  return (
    <>
      <div className="page-bg" />

      <div className="page-wrapper">
        <BrandPanel />

        {/* ── Right: Login Card ── */}
        <div className="login-card">
          {challenge ? (
            challenge.kind === 'mfa' ? (
              <CodeVerification
                email={challenge.email}
                title="Two-step verification"
                blurb={<>Your password was correct. Enter the 6-digit code we sent to</>}
                submitLabel="Sign in"
                offerTrust
                onSubmit={handleMfa}
                onResend={() => authApi.resendCode(challenge.email, 'login_mfa')}
                onBack={() => { setChallenge(null); setError('') }}
                backLabel="Cancel"
              />
            ) : (
              <CodeVerification
                email={challenge.email}
                title="Confirm your email"
                blurb={<>This account was never activated. Enter the 6-digit code we just sent to</>}
                submitLabel="Verify & sign in"
                onSubmit={handleVerify}
                onResend={() => authApi.resendCode(challenge.email, 'verify_email')}
                onBack={() => { setChallenge(null); setError('') }}
                backLabel="Cancel"
              />
            )
          ) : (
          <>
          <div className="card-header-row">
            <div className="header-icon">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div className="header-text">
              <h2>System Access</h2>
              <p>Cabuyao CDRRMO Portal</p>
            </div>
          </div>

          {/* Role tabs */}
          <div className="section-label">Access Role</div>
          <div className="role-tabs">
            <RoleTab active={role === 'admin'} onClick={() => switchRole('admin')}>
              CDRRMO Admin
            </RoleTab>
            <RoleTab active={role === 'barangay'} onClick={() => switchRole('barangay')}>
              Barangay Officials
            </RoleTab>
            <RoleTab active={role === 'resident'} onClick={() => switchRole('resident')}>
              Resident
            </RoleTab>
          </div>

          {/* Error message */}
          <div className={`error-msg ${error ? 'show' : ''}`}>{error}</div>

          <form onSubmit={handleLogin}>
            {/* PANEL 1: CDRRMO Admin */}
            {role === 'admin' && (
              <div className="login-panel active">
                <div className="field-group">
                  <label htmlFor="admin-id">Admin ID</label>
                  <input
                    type="text"
                    id="admin-id"
                    placeholder="Enter your Admin ID"
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                  />
                </div>
                <PasswordField
                  id="admin-pw"
                  label="Password"
                  value={adminPw}
                  onChange={setAdminPw}
                />
                <LoginButton submitting={submitting} />
              </div>
            )}

            {/* PANEL 2: Barangay Official */}
            {role === 'barangay' && (
              <div className="login-panel active">
                {/* The barangay dropdown that used to sit here is gone.
                    Jurisdiction now comes from the `barangay` claim inside the
                    signed session token and is enforced by RLS in Postgres, so
                    asking the official to pick it added no security — it only
                    added a way to be turned away with the correct password for
                    picking the wrong entry, and the rejection message named
                    the barangay the Staff ID belonged to. */}
                <div className="field-group">
                  <label htmlFor="staff-id">Staff ID</label>
                  <input
                    type="text"
                    id="staff-id"
                    placeholder="Enter your Staff ID"
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                  />
                </div>
                <PasswordField
                  id="brgy-pw"
                  label="Password"
                  value={brgyPw}
                  onChange={setBrgyPw}
                />
                <LoginButton submitting={submitting} />
              </div>
            )}

            {/* PANEL 3: Resident */}
            {role === 'resident' && (
              <div className="login-panel active">
                <div className="field-group">
                  <label htmlFor="res-email">Email Address</label>
                  <input
                    type="email"
                    id="res-email"
                    placeholder="Enter your email address"
                    value={resEmail}
                    onChange={(e) => setResEmail(e.target.value)}
                  />
                </div>
                <PasswordField
                  id="res-pw"
                  label="Password"
                  value={resPw}
                  onChange={setResPw}
                />
                {/* One <span> for the sentence — see the note on the same row
                    in Register.jsx: .terms-row is flex, so loose text nodes
                    become non-wrapping flex items and overflow on a phone. */}
                <label className="terms-row">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                  />
                  <span className="terms-text">
                    Accept{' '}
                    <button
                      type="button"
                      className="link-inline"
                      onClick={() => setModal('legal')}
                    >
                      Terms &amp; Privacy Policy
                    </button>
                  </span>
                </label>
                <LoginButton submitting={submitting} />
                <div className="card-footer mt-4">
                  <p className="footer-link">
                    Don't have an account? <Link to="/register">Sign up</Link>
                  </p>
                </div>
              </div>
            )}
          </form>

          {/* Footer (shared) */}
          <div
            className="card-footer"
            style={{
              marginTop: 20,
              borderTop: '1px solid var(--color-border)',
              paddingTop: 16,
            }}
          >
            <div className="secure-badge">Secure Government Portal</div>
            <p className="support-link">
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
      {modal === 'legal' && (
        <Modal
          title="Terms & Privacy Policy"
          icon={<DocIcon />}
          onClose={() => setModal(null)}
        >
          <h4>Terms of Service</h4>
          <TermsContent />
          <h4 style={{ marginTop: 22 }}>Privacy Policy</h4>
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

/* ---------- small sub-components ---------- */

function RoleTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`role-tab ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PasswordField({ id, label, value, onChange }) {
  const [show, setShow] = useState(false)
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <input
          type={show ? 'text' : 'password'}
          id={id}
          placeholder="Enter your password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="toggle-pw"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  )
}

function LoginButton({ submitting }) {
  return (
    <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <polyline points="10 17 15 12 10 7" />
        <line x1="15" y1="12" x2="3" y2="12" />
      </svg>
      {submitting ? 'Signing in...' : 'Login'}
    </button>
  )
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
