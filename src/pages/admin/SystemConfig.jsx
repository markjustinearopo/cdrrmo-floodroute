import { useEffect, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import {
  SYSTEM_CONFIG_DEFAULTS as DEFAULTS,
  getSystemConfig,
  saveSystemConfig,
  resetSystemConfig,
  loadSystemConfigRemote,
} from '../../services/systemConfig.js'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — System Configuration (Settings).
 *
 * Site-wide operational settings that TAKE EFFECT across the app through the
 * shared systemConfig service: identity (topbar + document title), the
 * flood-depth thresholds that grade every risk badge, distance units on the
 * routing screens, the dashboard auto-refresh, new-registration and
 * maintenance switches. A save propagates instantly to every open screen and
 * persists to the shared backend.
 */

export default function SystemConfig() {
  const [cfg, setCfg] = useState(getSystemConfig)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState('')

  // Pull the shared config from Supabase once on mount (cache renders first).
  useEffect(() => {
    let alive = true
    loadSystemConfigRemote().then((remote) => { if (alive) setCfg(remote) })
    return () => { alive = false }
  }, [])

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
    saveSystemConfig(cfg) // instant local + broadcast + shared backend
    setDirty(false)
    flash('Configuration saved — applied across the system.')
  }
  function handleReset() {
    setCfg({ ...DEFAULTS })
    resetSystemConfig()
    setDirty(false)
    flash('Reverted to default configuration.')
  }

  return (
    <AdminLayout>
      <form className="set" onSubmit={handleSave}>
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </div>
            <div>
              <div className="mng-title">System Configuration</div>
              <div className="mng-sub">Operational defaults, thresholds and maintenance</div>
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
            <button type="button" className="mng-btn mng-btn-ghost" onClick={handleReset}>Reset to Defaults</button>
            <button type="submit" className="mng-btn" disabled={!dirty}>Save Changes</button>
          </div>
        </div>

        {/* General — full width, fields laid out across the row */}
        <Panel icon={<TagIcon />} title="General" sub="System identity and locale">
          <div className="set-grid">
            <div className="set-field">
              <span>System Name</span>
              <input type="text" value={cfg.systemName} onChange={(e) => set('systemName', e.target.value)} />
            </div>
            <div className="set-field">
              <span>Organization</span>
              <input type="text" value={cfg.organization} onChange={(e) => set('organization', e.target.value)} />
            </div>
          </div>
          <div className="set-grid-3">
            <div className="set-field">
              <span>Timezone</span>
              <select value={cfg.timezone} onChange={(e) => set('timezone', e.target.value)}>
                <option value="Asia/Manila">Asia/Manila (PHT)</option>
              </select>
            </div>
            <div className="set-field">
              <span>Default Language</span>
              <select value={cfg.language} onChange={(e) => set('language', e.target.value)}>
                <option value="en">English</option>
                <option value="fil">Filipino</option>
              </select>
            </div>
            <div className="set-field">
              <span>Date Format</span>
              <select value={cfg.dateFormat} onChange={(e) => set('dateFormat', e.target.value)}>
                <option value="dmy">DD/MM/YYYY</option>
                <option value="mdy">MM/DD/YYYY</option>
                <option value="ymd">YYYY-MM-DD</option>
              </select>
            </div>
          </div>
        </Panel>

        <div className="set-cols">
          {/* Flood thresholds */}
          <Panel icon={<DropletIcon />} title="Flood Risk Thresholds" sub="Modeled depth (m) that sets each risk level">
            <div className="set-grid-3">
              <ThresholdField label="Low" value={cfg.depthLow} onChange={(v) => set('depthLow', v)} />
              <ThresholdField label="Moderate" value={cfg.depthModerate} onChange={(v) => set('depthModerate', v)} />
              <ThresholdField label="High" value={cfg.depthHigh} onChange={(v) => set('depthHigh', v)} />
            </div>
            <div className="set-field-hint">
              A barangay is graded by its modeled flood depth: Safe below {cfg.depthLow || 0} m, then Low, Moderate and
              High once each threshold is reached. These power the risk badges on the Dashboard, Flood Map and Barangay screens.
            </div>
          </Panel>

          {/* Map & routing */}
          <Panel icon={<MapIcon />} title="Map &amp; Routing" sub="Defaults for the map and route screens">
            <div className="set-grid">
              <div className="set-field">
                <span>Default Map Zoom</span>
                <select value={cfg.mapZoom} onChange={(e) => set('mapZoom', Number(e.target.value))}>
                  {[11, 12, 13, 14, 15].map((z) => <option key={z} value={z}>Level {z}</option>)}
                </select>
              </div>
              <div className="set-field">
                <span>Distance Units</span>
                <select value={cfg.distanceUnit} onChange={(e) => set('distanceUnit', e.target.value)}>
                  <option value="km">Kilometres</option>
                  <option value="mi">Miles</option>
                </select>
              </div>
            </div>
            <div className="set-field-hint">
              Distances on the routing and evacuation screens are shown in these units. Routes are drawn manually on the map today.
            </div>
          </Panel>

          {/* Data */}
          <Panel icon={<ActivityIcon />} title="Data" sub="Feed cadence and retention">
            <div className="set-grid">
              <div className="set-field">
                <span>Data Retention</span>
                <UnitInput value={cfg.retentionDays} onChange={(v) => set('retentionDays', v)} suffix="days" min={1} />
              </div>
            </div>
            <div className="set-toggles">
              <Toggle
                label="Auto-refresh dashboards"
                sub="Pull the latest rainfall and risk data automatically."
                checked={cfg.autoRefresh}
                onChange={(v) => set('autoRefresh', v)}
              />
            </div>
          </Panel>

          {/* Maintenance */}
          <Panel icon={<ShieldIcon />} title="System &amp; Maintenance" sub="Availability and diagnostics">
            <div className="set-toggles">
              <Toggle
                label="Maintenance mode"
                sub="Take the public-facing app offline for updates. Admins keep access."
                checked={cfg.maintenance}
                onChange={(v) => set('maintenance', v)}
              />
              <Toggle
                label="Allow new registrations"
                sub="Let residents and barangay staff request an account from the login page."
                checked={cfg.allowRegistration}
                onChange={(v) => set('allowRegistration', v)}
              />
              <Toggle
                label="Verbose diagnostic logging"
                sub="Record detailed system logs. Useful for debugging; increases storage use."
                checked={cfg.debugLogging}
                onChange={(v) => set('debugLogging', v)}
              />
            </div>
          </Panel>
        </div>

        <div className="mng-note">
          <SparkIcon />
          <span>Saved settings apply immediately across every open screen and persist to the shared backend, so they follow you to any device.</span>
        </div>
      </form>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

/* ── Small building blocks ─────────────────────────────────── */
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
function UnitInput({ value, onChange, suffix, min }) {
  return (
    <div className="set-unit">
      <input type="number" min={min} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      <span className="set-unit-suffix">{suffix}</span>
    </div>
  )
}
function ThresholdField({ label, value, onChange }) {
  return (
    <div className="set-field">
      <span>{label}</span>
      <div className="set-unit">
        <input type="number" step="0.05" min="0" value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        <span className="set-unit-suffix">m</span>
      </div>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────── */
function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
function TagIcon() {
  return <svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
}
function DropletIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>
}
function MapIcon() {
  return <svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
}
function ActivityIcon() {
  return <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
}
function ShieldIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
}
