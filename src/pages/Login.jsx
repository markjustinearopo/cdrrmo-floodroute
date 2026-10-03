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
import LanguageToggle from '../components/LanguageToggle.jsx'
import PasswordReset from '../components/auth/PasswordReset.jsx'
import api, { authApi, getRoleForRedirect } from '../services/api.js'
import GoogleSignInButton from '../components/GoogleSignInButton.jsx'
import GoogleBarangayStep from '../components/GoogleBarangayStep.jsx'
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

/* Which accounts.role values belong to which login panel. Mirrors ROLE_GROUP
   in components/RequireAuth.jsx — the route guard and the login screen have to
   agree on what "an admin account" means, or one will admit someone the other
   turns away. */
const ROLE_GROUP = {
  admin: 'admin', staff: 'admin', operator: 'admin', viewer: 'admin',
  barangay: 'barangay', officer: 'barangay',
  resident: 'resident',
}

const PANEL_LABEL = {
  admin: 'CDRRMO Admin',
  barangay: 'Barangay Official',
  resident: 'Resident',
}

const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

export default function Login() {
  const navigate = useNavigate()
  const [role, setRole] = useState('admin')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /* Google sign-in. `googleSignup` holds the signed ten-minute ticket for a
     first-time resident who still has to name a barangay; null the rest of
     the time. */
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleSignup, setGoogleSignup] = useState(null)

  // form fields
  const [adminId, setAdminId] = useState('')
  const [adminPw, setAdminPw] = useState('')
  const [brgy, setBrgy] = useState('')
  const [staffId, setStaffId] = useState('')
  const [brgyPw, setBrgyPw] = useState('')
  const [resEmail, setResEmail] = useState('')
  const [resPw, setResPw] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [modal, setModal] = useState(null) // active popup, or null

  /* Second-factor / verification step. `challenge.kind` is 'mfa' or 'verify'. */
  const [challenge, setChallenge] = useState(null)

  /* Password reset lives on this screen too — a person who cannot sign in
     should not have to go anywhere else to fix that. */
  const [reset, setReset] = useState(null)

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
      if (!brgy) {
        setError('Please select your barangay to continue.')
        return
      }
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
        setChallenge({ kind: 'mfa', email: res.email, role, brgy, mfaTicket: res.mfaTicket })
        return
      }
      if (res.unverified) {
        setChallenge({ kind: 'verify', email: res.email, role, brgy })
        return
      }
      finishLogin(res.user, role, brgy)
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Common tail for every route into a session — password-only, after the
   * second factor, or after a late email verification.
   *
   * The panel the person chose has to MATCH the account they signed in with.
   * It did not before: the three role tabs only decided which fields were
   * drawn, and the redirect was taken from the account's own role, so a
   * resident could type their address into the CDRRMO Admin panel, be let
   * through, and land on the resident dashboard. Nothing was exposed — the
   * route guards and RLS are keyed to the real role — but it made the tabs
   * look decorative, and "why did the admin login accept me?" is not a
   * question a government portal should raise.
   *
   * Jurisdiction stays server-authoritative: the barangay dropdown below is
   * checked against the barangay ON THE ACCOUNT, never trusted in its place.
   */
  function finishLogin(user, forRole, chosenBrgy) {
    const group = ROLE_GROUP[user.role]

    if (group !== forRole) {
      authApi.logout()
      setChallenge(null)
      setError(`This account is not a ${PANEL_LABEL[forRole]} account. Use the ${PANEL_LABEL[group] || 'correct'} tab to sign in.`)
      return
    }

    if (forRole === 'barangay') {
      /* Deliberately does NOT name the account's real barangay. The earlier
         version said "This Staff ID belongs to Barangay X", which told anyone
         holding a Staff ID which barangay it was for. */
      if (chosenBrgy && user.barangay && user.barangay !== chosenBrgy) {
        authApi.logout()
        setChallenge(null)
        setError('That Staff ID does not belong to the barangay you selected.')
        return
      }
      localStorage.setItem(OFFICIAL_BRGY_KEY, user.barangay || chosenBrgy || '')
    }
    if (user.role === 'resident' && user.barangay) {
      localStorage.setItem(OFFICIAL_BRGY_KEY, user.barangay)
    }
    navigate(getRoleForRedirect(user.role))
  }

  /**
   * Google handed back a credential.
   *
   * Two outcomes. A known address signs straight in — no code, no password,
   * because Google has already proven the address and that is stronger
   * evidence than anything this office can currently mail. An unknown one
   * comes back needing a barangay, because Google can say who someone is but
   * never where they live, and every scope in this system — RLS, alert
   * targeting, their own map — is keyed to a barangay.
   */
  async function handleGoogle(credential) {
    setError('')
    setGoogleBusy(true)
    try {
      const res = await authApi.googleSignIn(credential)
      if (res?.needsBarangay) {
        setGoogleSignup({ ticket: res.ticket, email: res.email, fullName: res.fullName })
        return
      }
      if (res?.user) finishLogin(res.user, 'resident')
    } catch (err) {
      setError(err.message || 'That Google sign-in did not work. Try your email and password.')
    } finally {
      setGoogleBusy(false)
    }
  }

  /** First-time Google resident: they picked a barangay, create the account. */
  async function handleGoogleBarangay(barangay) {
    setError('')
    setGoogleBusy(true)
    try {
      const res = await authApi.completeGoogleSignUp(googleSignup.ticket, barangay)
      setGoogleSignup(null)
      if (res?.user) finishLogin(res.user, 'resident')
    } catch (err) {
      setError(err.message || 'Could not finish creating your account.')
    } finally {
      setGoogleBusy(false)
    }
  }

  /** Second factor: the emailed code, plus the optional trusted-device tick. */
  async function handleMfa(code, trustDevice) {
    const user = await authApi.completeMfa(challenge.email, code, trustDevice, challenge.mfaTicket)
    finishLogin(user, challenge.role, challenge.brgy)
  }

  /** Late email verification for an account that never finished sign-up. */
  async function handleVerify(code) {
    const res = await authApi.verifyEmail(challenge.email, code)
    if (res?.user) finishLogin(res.user, challenge.role, challenge.brgy)
  }

  return (
    <>
      <div className="page-bg" />

      <div className="page-wrapper">
        <BrandPanel />

        {/* ── Right: Login Card ── */}
        <div className="login-card">
          {reset ? (
            <PasswordReset
              onDone={() => {
                /* confirmReset already started the session, so read the role
                   off the stored user rather than assuming a panel. */
                const u = api.getUser()
                setReset(null)
                navigate(getRoleForRedirect(u?.role))
              }}
              onCancel={() => { setReset(null); setError('') }}
            />
          ) : challenge ? (
            challenge.kind === 'mfa' ? (
              <CodeVerification
                email={challenge.email}
                title="Two-step verification"
                blurb={<>Your password was correct. Enter the 6-digit code we sent to</>}
                submitLabel="Sign in"
                offerTrust
                onSubmit={handleMfa}
                onResend={() => authApi.resendCode(challenge.email, 'login_mfa', challenge.mfaTicket)}
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

          {/* Language, before sign-in. The switch used to live only in admin
              System Configuration, so a resident — the person most likely to
              want Filipino — could never reach it. */}
          <div className="login-lang-row">
            <LanguageToggle className="on-light" />
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
          <div className={`error-msg ${error ? 'show' : ''}`} role="alert" aria-live="assertive">{error}</div>

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
                {/* Restored at the client's request. It is NOT the source of
                    jurisdiction — that is the `barangay` claim in the signed
                    token, enforced by RLS — but it is a useful second thing to
                    know: a stolen Staff ID alone no longer gets you in unless
                    you also know which barangay it belongs to. The mismatch
                    message in finishLogin() deliberately does not name the
                    real barangay, which is what the old version leaked. */}
                <div className="field-group">
                  <label htmlFor="brgy-select">Barangay</label>
                  <select
                    id="brgy-select"
                    value={brgy}
                    onChange={(e) => setBrgy(e.target.value)}
                  >
                    <option value="" disabled>Select Barangay ▾</option>
                    {BARANGAYS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </div>
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

                {/* Residents only. Staff and barangay officials are issued
                    accounts by CDRRMO against a Staff ID, so letting a Google
                    address into those panels would be a second, unmanaged way
                    into a privileged account. Renders nothing at all unless
                    VITE_GOOGLE_CLIENT_ID is set. */}
                <GoogleSignInButton
                  disabled={submitting || googleBusy}
                  onCredential={handleGoogle}
                  onError={setError}
                />

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
            {/* Before this existed, a forgotten password meant a developer
                editing the database by hand. */}
            <p className="support-link">
              <button
                type="button"
                className="link-inline"
                onClick={() => { setReset({ step: 'ask', identifier: '' }); setError('') }}
              >
                Forgot your password?
              </button>
            </p>
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

      {/* First-time Google resident: the one thing Google cannot tell us. */}
      {googleSignup && (
        <GoogleBarangayStep
          email={googleSignup.email}
          fullName={googleSignup.fullName}
          barangays={BARANGAYS}
          busy={googleBusy}
          error={error}
          onSubmit={handleGoogleBarangay}
          onCancel={() => { setGoogleSignup(null); setError('') }}
        />
      )}

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
