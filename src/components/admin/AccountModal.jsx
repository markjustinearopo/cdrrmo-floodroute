import { useEffect, useState } from 'react'

/**
 * Account modal for the CDRRMO portal — Profile + Settings in one popup.
 * The gear icon opens it on Settings; the avatar opens it on Profile.
 *
 * All fields start empty (none) per the project rule; values will be loaded
 * from / saved to the backend (GET/PUT /me) once the API exists. For now the
 * forms validate and acknowledge with a toast but do not persist.
 *
 * `identity` lets the same modal serve both the admin and the barangay portals
 * (name, sub-role, avatar initials and the ID-field label). It defaults to the
 * CDRRMO Admin so existing callers are unaffected.
 */
const ADMIN_IDENTITY = {
  name: 'CDRRMO Admin',
  role: 'Cabuyao City — Command Center',
  initials: 'CA',
  idLabel: 'Admin ID',
}

export default function AccountModal({ tab, onTabChange, onClose, identity = ADMIN_IDENTITY }) {
  const [toast, setToast] = useState('')

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
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

  function handleProfileSave(e) {
    e.preventDefault()
    flash('Profile saved — will sync once the backend is connected.')
  }
  function handlePreferencesSave(e) {
    e.preventDefault()
    flash('Preferences saved — will sync once the backend is connected.')
  }
  function handlePasswordSave(e) {
    e.preventDefault()
    flash('Password update queued — will apply once the backend is connected.')
  }

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
            <div className="account-avatar">{identity.initials}</div>
            <div>
              <div className="account-name">{identity.name}</div>
              <div className="account-role">{identity.role}</div>
            </div>
          </div>
          <button
            className="account-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
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
                <div className="photo-ph">{identity.initials}</div>
                <div>
                  <button className="btn-soft" type="button">
                    Change photo
                  </button>
                  <div className="photo-hint">PNG or JPG, up to 2 MB.</div>
                </div>
              </div>

              <div className="acc-grid">
                <label>
                  Full Name
                  <input type="text" placeholder="Enter full name" />
                </label>
                <label>
                  {identity.idLabel}
                  <input type="text" placeholder={`Enter ${identity.idLabel.toLowerCase()}`} />
                </label>
              </div>

              <div className="acc-grid">
                <label>
                  Email Address
                  <input type="email" placeholder="name@cabuyao.gov.ph" />
                </label>
                <label>
                  Phone Number
                  <input type="tel" placeholder="+63" />
                </label>
              </div>

              <label>
                Position / Designation
                <input type="text" placeholder="e.g. Operations Officer" />
              </label>

              <div className="account-actions">
                <button className="btn-soft" type="button" onClick={onClose}>
                  Cancel
                </button>
                <button className="btn-primary-sm" type="submit">
                  Save Changes
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
                    <input type="checkbox" />
                    <span className="switch-slider" />
                  </label>
                </div>

                <div className="setting-row">
                  <div>
                    <div className="setting-label">SMS notifications</div>
                    <div className="setting-sub">Get urgent alerts via text message.</div>
                  </div>
                  <label className="switch">
                    <input type="checkbox" />
                    <span className="switch-slider" />
                  </label>
                </div>

                <label>
                  Language
                  <select defaultValue="">
                    <option value="" disabled>
                      Select language
                    </option>
                    <option value="en">English</option>
                    <option value="fil">Filipino</option>
                  </select>
                </label>

                <div className="account-actions">
                  <button className="btn-primary-sm" type="submit">
                    Save Preferences
                  </button>
                </div>
              </form>

              <div className="settings-divider" />

              {/* Security */}
              <form className="account-form" onSubmit={handlePasswordSave}>
                <div className="settings-group-title">Change Password</div>
                <label>
                  Current Password
                  <input type="password" placeholder="Enter current password" />
                </label>
                <div className="acc-grid">
                  <label>
                    New Password
                    <input type="password" placeholder="Enter new password" />
                  </label>
                  <label>
                    Confirm New Password
                    <input type="password" placeholder="Re-enter new password" />
                  </label>
                </div>
                <div className="account-actions">
                  <button className="btn-primary-sm" type="submit">
                    Update Password
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
