import { useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — Alert Settings (Settings).
 *
 * Configures HOW flood alerts go out — the counterpart to the Alerts screen
 * (which issues them). Here the admin picks delivery channels, the automatic
 * trigger tied to the flood-depth thresholds, the default message templates per
 * level, who receives alerts, and quiet-hours / throttling rules.
 *
 * Values are held in component state and acknowledged with a toast; they
 * persist to the backend (PUT /alert-settings) once it is connected.
 */

const DEFAULTS = {
  // Delivery channels
  sms: true,
  email: true,
  push: false,
  siren: false,
  // Automatic alerts
  autoIssue: false,
  triggerLevel: 'high',
  reissueInterval: 30,
  // Templates (placeholders: {barangay} {level} {depth})
  tplHigh: '🚨 SEVERE FLOOD WARNING for {barangay}. Water level has reached {depth} m. Evacuate low-lying areas immediately and proceed to the nearest evacuation center.',
  tplModerate: '⚠️ Flood advisory for {barangay}. Water level is rising ({depth} m). Avoid flooded roads and prepare to evacuate if conditions worsen.',
  tplSafe: '✅ ALL CLEAR for {barangay}. Flood waters have receded. Stay alert for further advisories from CDRRMO.',
  // Recipients
  toStaff: true,
  toOfficials: true,
  toResidents: false,
  // Quiet hours / throttling
  quietHours: false,
  quietFrom: '22:00',
  quietTo: '05:00',
  maxPerHour: 4,
}

export default function AlertSettings() {
  const [cfg, setCfg] = useState(DEFAULTS)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState('')

  function set(key, value) {
    setCfg((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }
  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }
  function handleSave(e) {
    e.preventDefault()
    setDirty(false)
    flash('Alert settings saved — will sync once the backend is connected.')
  }
  function sendTest() {
    const channels = [cfg.sms && 'SMS', cfg.email && 'Email', cfg.push && 'Push', cfg.siren && 'Siren'].filter(Boolean)
    flash(channels.length ? `Test alert queued via ${channels.join(', ')}.` : 'Enable a channel to send a test alert.')
  }

  return (
    <AdminLayout>
      <form className="set" onSubmit={handleSave}>
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Alert Settings</div>
              <div className="mng-sub">How flood alerts are delivered, triggered and worded</div>
            </div>
          </div>
        </div>

        {/* Save bar */}
        <div className="set-savebar">
          <div className="set-savebar-note">
            <SparkIcon />
            <span>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
          </div>
          <div className="set-savebar-actions">
            <button type="button" className="mng-btn mng-btn-ghost" onClick={sendTest}>Send Test Alert</button>
            <button type="submit" className="mng-btn" disabled={!dirty}>Save Changes</button>
          </div>
        </div>

        <div className="set-cols">
          {/* Delivery channels */}
          <Panel icon={<SendIcon />} title="Delivery Channels" sub="Where alerts are broadcast">
            <div className="set-toggles">
              <Toggle label="SMS / Text message" sub="Reach residents and barangay officials directly on their phones." checked={cfg.sms} onChange={(v) => set('sms', v)} />
              <Toggle label="Email" sub="Send alert digests to staff and registered contacts." checked={cfg.email} onChange={(v) => set('email', v)} />
              <Toggle label="Web push" sub="Browser notifications for command-center staff." checked={cfg.push} onChange={(v) => set('push', v)} />
              <Toggle label="Sirens / Public address" sub="Trigger barangay warning sirens for high-level alerts." checked={cfg.siren} onChange={(v) => set('siren', v)} />
            </div>
          </Panel>

          {/* Quiet hours / throttling */}
          <Panel icon={<MoonIcon />} title="Quiet Hours &amp; Throttling" sub="Limit non-urgent alert noise">
            <div className="set-toggles">
              <Toggle
                label="Enable quiet hours"
                sub="Hold back low and moderate alerts overnight. High-level alerts always go out."
                checked={cfg.quietHours}
                onChange={(v) => set('quietHours', v)}
              />
            </div>
            <div className="set-grid">
              <div className="set-field">
                <span>From</span>
                <input type="time" value={cfg.quietFrom} disabled={!cfg.quietHours} onChange={(e) => set('quietFrom', e.target.value)} />
              </div>
              <div className="set-field">
                <span>To</span>
                <input type="time" value={cfg.quietTo} disabled={!cfg.quietHours} onChange={(e) => set('quietTo', e.target.value)} />
              </div>
            </div>
            <div className="set-field">
              <span>Max Alerts Per Barangay / Hour</span>
              <div className="set-unit">
                <input type="number" min="1" value={cfg.maxPerHour} onChange={(e) => set('maxPerHour', e.target.value === '' ? '' : Number(e.target.value))} />
                <span className="set-unit-suffix">/ hr</span>
              </div>
              <div className="set-field-hint">Prevents duplicate alerts from flooding recipients during a fast-changing event.</div>
            </div>
          </Panel>

          {/* Recipients */}
          <Panel icon={<UsersIcon />} title="Default Recipients" sub="Who is notified by default">
            <div className="set-toggles">
              <Toggle label="CDRRMO staff" sub="Command-center operators and administrators." checked={cfg.toStaff} onChange={(v) => set('toStaff', v)} />
              <Toggle label="Barangay officials" sub="Captains and BDRRMC coordinators of the affected barangay." checked={cfg.toOfficials} onChange={(v) => set('toOfficials', v)} />
              <Toggle label="Registered residents" sub="Residents who opted in to flood alerts for their barangay." checked={cfg.toResidents} onChange={(v) => set('toResidents', v)} />
            </div>
          </Panel>

          {/* Automatic alerts */}
          <Panel icon={<ZapIcon />} title="Automatic Alerts" sub="Issue alerts from the sensor feed">
            <div className="set-toggles">
              <Toggle
                label="Auto-issue on threshold breach"
                sub="Raise an alert automatically when a barangay's measured flood depth crosses the trigger level."
                checked={cfg.autoIssue}
                onChange={(v) => set('autoIssue', v)}
              />
            </div>
            <div className="set-grid">
              <div className="set-field">
                <span>Trigger From Level</span>
                <select value={cfg.triggerLevel} disabled={!cfg.autoIssue} onChange={(e) => set('triggerLevel', e.target.value)}>
                  <option value="moderate">Moderate &amp; above</option>
                  <option value="high">High only</option>
                </select>
              </div>
              <div className="set-field">
                <span>Re-alert Interval</span>
                <div className="set-unit">
                  <input type="number" min="5" value={cfg.reissueInterval} disabled={!cfg.autoIssue} onChange={(e) => set('reissueInterval', e.target.value === '' ? '' : Number(e.target.value))} />
                  <span className="set-unit-suffix">min</span>
                </div>
              </div>
            </div>
            <div className="set-field-hint">Automatic alerts use the same flood-depth thresholds set under System Configuration.</div>
          </Panel>
        </div>

        {/* Message templates — full width */}
        <Panel icon={<FileIcon />} title="Message Templates" sub="Default wording per alert level — use {barangay}, {level} and {depth}">
          <div className="set-field">
            <span>High / Severe</span>
            <textarea value={cfg.tplHigh} onChange={(e) => set('tplHigh', e.target.value)} rows={2} />
          </div>
          <div className="set-field">
            <span>Moderate / Advisory</span>
            <textarea value={cfg.tplModerate} onChange={(e) => set('tplModerate', e.target.value)} rows={2} />
          </div>
          <div className="set-field">
            <span>All Clear</span>
            <textarea value={cfg.tplSafe} onChange={(e) => set('tplSafe', e.target.value)} rows={2} />
          </div>
        </Panel>

        <div className="mng-note">
          <SparkIcon />
          <span>These settings shape every alert issued from the Alerts screen and any automatic alerts. They are kept for this session until the backend is connected.</span>
        </div>
      </form>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

/* ── Building blocks ───────────────────────────────────────── */
function Panel({ icon, title, sub, children }) {
  return (
    <section className="set-panel">
      <div className="set-panel-head">
        <div className="set-panel-icon">{icon}</div>
        <div>
          <div className="set-panel-title">{title}</div>
          <div className="set-panel-sub">{sub}</div>
        </div>
      </div>
      <div className="set-panel-body">{children}</div>
    </section>
  )
}
function Toggle({ label, sub, checked, onChange }) {
  return (
    <div className="set-toggle">
      <div className="set-toggle-text">
        <div className="set-toggle-label">{label}</div>
        <div className="set-toggle-sub">{sub}</div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-slider" />
      </label>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────── */
function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
function SendIcon() {
  return <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
}
function ZapIcon() {
  return <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
}
function FileIcon() {
  return <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
}
function UsersIcon() {
  return <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}
function MoonIcon() {
  return <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
}
