import { useEffect, useRef, useState } from 'react'
import api from '../../services/api.js'
import db from '../../services/db.js'
import { notifyAvatarChange } from '../Avatar.jsx'

/** Downscale a chosen image to a small square-ish JPEG data URL so it stores
 *  cheaply on the account row and in the session cache (avatars are tiny). */
function fileToAvatarDataUrl(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Account modal for the CDRRMO portal — Profile + Settings in one popup.
 * The gear icon opens it on Settings; the avatar opens it on Profile.
 *
 * Wired to the signed-in account (api.getUser): the profile form loads from /
 * saves to the `accounts` table, preferences persist to `app_settings`, and
 * "Change Password" verifies the current password and sets a new one (bcrypt,
 * via the app_change_password RPC). `identity` only drives the header chrome
 * and the ID-field label so the same modal serves the admin + barangay portals.
 */
const ADMIN_IDENTITY = {
  name: 'CDRRMO Admin',
  role: 'Cabuyao City — Command Center',
  initials: 'CA',
  idLabel: 'Admin ID',
}

export default function AccountModal({ tab, onTabChange, onClose, identity = ADMIN_IDENTITY }) {
  const me = api.getUser() || {}
  const meId = me.id

  const [profile, setProfile] = useState({
    name: me.fullName || me.name || '', username: me.username || '',
    email: me.email || '', phone: '', position: '', avatar: me.avatar || '',
  })
  const fileRef = useRef(null)
  const [prefs, setPrefs] = useState({ emailNotif: true, smsNotif: false, language: 'en' })
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  // Load the full profile (phone/position aren't in the session) + saved prefs.
  useEffect(() => {
    if (!meId) return undefined
    let alive = true
    db.users.profile(meId)
      .then((p) => { if (alive && p) setProfile({ name: p.name, username: p.username, email: p.email, phone: p.phone, position: p.position, avatar: p.avatar || '' }) })
      .catch((e) => console.error('[Account] profile load failed', e))
    db.appSettings.get(`user_prefs:${meId}`)
      .then((p) => { if (alive && p) setPrefs((cur) => ({ ...cur, ...p })) })
      .catch(() => {})
    return () => { alive = false }
  }, [meId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked later
    if (!file) return
    if (!file.type.startsWith('image/')) return flash('Please choose an image file.')
    if (file.size > 2 * 1024 * 1024) return flash('Image must be under 2 MB.')
    try {
      const dataUrl = await fileToAvatarDataUrl(file)
      setProfile((p) => ({ ...p, avatar: dataUrl }))
      flash('Photo ready — click Save Changes to apply.')
    } catch {
      flash('Could not read that image.')
    }
  }

  async function handleProfileSave(e) {
    e.preventDefault()
    if (!meId) return flash('You are not signed in.')
    setBusy(true)
    try {
      await db.users.update(meId, {
        name: profile.name, email: profile.email,
        phone: profile.phone, position: profile.position, avatar: profile.avatar,
      })
      api.setUser({ ...me, fullName: profile.name, email: profile.email, avatar: profile.avatar }) // refresh cached session
      notifyAvatarChange(profile.avatar) // repaint every topbar across the system
      flash('Profile saved.')
    } catch (err) {
      flash(err.message || 'Could not save profile.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePreferencesSave(e) {
    e.preventDefault()
    if (!meId) return flash('You are not signed in.')
    setBusy(true)
    try {
      await db.appSettings.set(`user_prefs:${meId}`, prefs)
      flash('Preferences saved.')
    } catch {
      flash('Could not save preferences.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePasswordSave(e) {
    e.preventDefault()
    if (!meId) return flash('You are not signed in.')
    if (!pw.current || !pw.next) return flash('Enter your current and new password.')
    if (pw.next.length < 6) return flash('New password must be at least 6 characters.')
    if (pw.next !== pw.confirm) return flash('New passwords do not match.')
    setBusy(true)
    try {
      await db.auth.changePassword(meId, pw.current, pw.next)
      setPw({ current: '', next: '', confirm: '' })
      flash('Password updated.')
    } catch (err) {
      flash(err.message || 'Could not update password.')
    } finally {
      setBusy(false)
    }
  }

  const initials = (profile.name || identity.name || '?').trim().slice(0, 2).toUpperCase() || identity.initials

  return (
    <div className="account-overlay" onMouseDown={onClose}>
      <div
        className="account-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="account-head">
          <div className="account-id">
            <div className="account-avatar">
              {profile.avatar ? <img src={profile.avatar} alt="Profile" /> : initials}
            </div>
            <div>
              <div className="account-name">{profile.name || identity.name}</div>
              <div className="account-role">{identity.role}</div>
            </div>
          </div>
          <button className="account-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* Tabs */}
        <div className="account-tabs">
          <button
            className={`account-tab ${tab === 'profile' ? 'active' : ''}`}
            onClick={() => onTabChange('profile')}
            type="button"
          >
            Profile
          </button>
          <button
            className={`account-tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => onTabChange('settings')}
            type="button"
          >
            Settings
          </button>
        </div>

        {/* Body */}
        <div className="account-body">
          {tab === 'profile' ? (
            <form className="account-form" onSubmit={handleProfileSave}>
              <div className="photo-row">
                <div className="photo-ph">
                  {profile.avatar ? <img src={profile.avatar} alt="Profile" /> : initials}
                </div>
                <div>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhoto} />
                  <button className="btn-soft" type="button" onClick={() => fileRef.current?.click()}>
                    {profile.avatar ? 'Change photo' : 'Upload photo'}
                  </button>
                  {profile.avatar && (
                    <button
                      className="btn-soft"
                      type="button"
                      style={{ marginLeft: 8 }}
                      onClick={() => setProfile((p) => ({ ...p, avatar: '' }))}
                    >
                      Remove
                    </button>
                  )}
                  <div className="photo-hint">PNG or JPG, up to 2 MB. Saved when you click “Save Changes”.</div>
                </div>
              </div>

              <div className="acc-grid">
                <label>
                  Full Name
                  <input
                    type="text"
                    placeholder="Enter full name"
                    value={profile.name}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                  />
                </label>
                <label>
                  {identity.idLabel}
                  <input type="text" value={profile.username} disabled title="Your login ID cannot be changed here." />
                </label>
              </div>

              <div className="acc-grid">
                <label>
                  Email Address
                  <input
                    type="email"
                    placeholder="name@cabuyao.gov.ph"
                    value={profile.email}
                    onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                  />
                </label>
                <label>
                  Phone Number
                  <input
                    type="tel"
                    placeholder="+63"
                    value={profile.phone}
                    onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                  />
                </label>
              </div>

              <label>
                Position / Designation
                <input
                  type="text"
                  placeholder="e.g. Operations Officer"
                  value={profile.position}
                  onChange={(e) => setProfile((p) => ({ ...p, position: e.target.value }))}
                />
              </label>

              <div className="account-actions">
                <button className="btn-soft" type="button" onClick={onClose}>Cancel</button>
                <button className="btn-primary-sm" type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          ) : (
            <div className="account-settings">
              {/* Preferences */}
              <form className="account-form" onSubmit={handlePreferencesSave}>
                <div className="settings-group-title">Preferences</div>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">Email notifications</div>
                    <div className="setting-sub">Receive alerts and reports by email.</div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={prefs.emailNotif}
                      onChange={(e) => setPrefs((p) => ({ ...p, emailNotif: e.target.checked }))}
                    />
                    <span className="switch-slider" />
                  </label>
                </div>

                <label>
                  Language
                  <select
                    value={prefs.language}
                    onChange={(e) => setPrefs((p) => ({ ...p, language: e.target.value }))}
                  >
                    <option value="en">English</option>
                    <option value="fil">Filipino</option>
                  </select>
                </label>

                <div className="account-actions">
                  <button className="btn-primary-sm" type="submit" disabled={busy}>
                    {busy ? 'Saving…' : 'Save Preferences'}
                  </button>
                </div>
              </form>

              <div className="settings-divider" />

              {/* Security */}
              <form className="account-form" onSubmit={handlePasswordSave}>
                <div className="settings-group-title">Change Password</div>
                <label>
                  Current Password
                  <input
                    type="password"
                    placeholder="Enter current password"
                    value={pw.current}
                    onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                  />
                </label>
                <div className="acc-grid">
                  <label>
                    New Password
                    <input
                      type="password"
                      placeholder="Enter new password"
                      value={pw.next}
                      onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                    />
                  </label>
                  <label>
                    Confirm New Password
                    <input
                      type="password"
                      placeholder="Re-enter new password"
                      value={pw.confirm}
                      onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="account-actions">
                  <button className="btn-primary-sm" type="submit" disabled={busy}>
                    {busy ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
