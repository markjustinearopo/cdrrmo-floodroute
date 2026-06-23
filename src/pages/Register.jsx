import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import BrandPanel from '../components/BrandPanel.jsx'
import Modal from '../components/Modal.jsx'
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
import './auth.css'
import './Register.css'

/**
 * Create Account — React port of the original register.html.
 * Residents self-register; includes a live password-strength meter.
 */

// The 18 barangays of Cabuyao City (same list as the Barangay login dropdown).
const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

const STRENGTH = {
  colors: ['#EF4444', '#F97316', '#EAB308', '#22C55E'],
  labels: ['Weak', 'Fair', 'Good', 'Strong'],
  labelColors: ['#991B1B', '#9A3412', '#854D0E', '#166534'],
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

  useEffect(() => {
    document.body.classList.add('auth-body')
    return () => document.body.classList.remove('auth-body')
  }, [])

  const score = scorePassword(password)
  const strengthLabel = password.length > 0 ? STRENGTH.labels[score - 1] || '' : ''
  const strengthColor = password.length > 0 ? STRENGTH.labelColors[score - 1] || '' : ''

  async function handleRegister(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)

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

    setSubmitting(true)
    const fullName = `${firstName.trim()} ${lastName.trim()}`
    try {
      await authApi.registerResident({ email, password, fullName, barangay })
      // Scope the resident portal to the barangay chosen at sign-up (the
      // backend also stores it on the user record for when auth is live).
      localStorage.setItem(OFFICIAL_BRGY_KEY, barangay)
      setSuccess(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="page-bg" />

      <div className="page-wrapper">
        <BrandPanel />

        {/* ── Right: Register Card ── */}
        <div className="register-card">
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
          <div className={`success-msg ${success ? 'show' : ''}`}>
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
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Account registered successfully! Redirecting to login...
          </div>

          <form onSubmit={handleRegister}>
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
                        i < score ? STRENGTH.colors[score - 1] : 'var(--color-border)',
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
            <label className="terms-row">
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
              />
              I accept the{' '}
              <button
                type="button"
                className="link-inline"
                style={{ margin: '0 3px' }}
                onClick={() => setModal('terms')}
              >
                Terms of Service
              </button>{' '}
              and{' '}
              <button
                type="button"
                className="link-inline"
                style={{ margin: '0 3px' }}
                onClick={() => setModal('privacy')}
              >
                Privacy Policy
              </button>
            </label>

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-navy btn-full"
              disabled={submitting}
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
              {submitting ? 'Registering...' : 'Register Account'}
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
