import { useEffect, useState } from 'react'
import {
  loadAlertSettings, loadAlertSettingsRemote, saveAlertSettings, useNotifications,
} from '../../../context/AdminDataContext.jsx'
import { useSystemConfig } from '../../../services/systemConfig.js'
import { sendAlertEmail } from '../../../services/emailAlert.js'
import { Panel, Toggle, UnitInput, SaveBar, SettingsNote, TabHead } from '../SettingsKit.jsx'

/**
 * Settings → Alerts (was the Alert Settings page).
 *
 * Configures HOW flood alerts go out — the counterpart to the Alerts screen
 * (which issues them). Here the admin picks delivery channels, the automatic
 * trigger tied to the flood-depth thresholds, the default message templates per
 * level, who receives alerts, and quiet-hours / throttling rules.
 *
 * Settings persist to the shared backend and survive a refresh; "Send Test
 * Alert" drops a real notification into the topbar bell over the enabled
 * channels.
 */
export default function AlertsTab({ onToast, onGoToTab }) {
  const { notify } = useNotifications()
  const config = useSystemConfig()
  const [cfg, setCfg] = useState(loadAlertSettings)
  const [dirty, setDirty] = useState(false)

  // Pull the shared settings from Supabase once on mount (cache renders first).
  useEffect(() => {
    let alive = true
    loadAlertSettingsRemote().then((s) => { if (alive) setCfg(s) })
    return () => { alive = false }
  }, [])

  function set(key, value) {
    setCfg((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }
  function handleSave(e) {
    e.preventDefault()
    saveAlertSettings(cfg)
    setDirty(false)
    onToast('Alert settings saved.')
  }
  function sendTest() {
    const channels = [cfg.email && 'Email', cfg.push && 'Push'].filter(Boolean)
    if (!channels.length) return onToast('Enable a channel to send a test alert.')
    sendAlertEmail({ level: 'moderate', title: 'Test Alert', message: 'This is a test from CDRRMO FloodRoute.', barangay: 'All Barangays' })
      .then(() => notify('moderate', 'Test email sent', `Delivered via ${channels.join(', ')}.`))
      .catch(() => notify('moderate', 'Test notification', `Would deliver via ${channels.join(', ')} (email not yet configured).`))
    onToast(`Test alert sent via ${channels.join(', ')}.`)
  }

  return (
    <form className="set" onSubmit={handleSave}>
      <TabHead
        icon={(
          <svg viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        )}
        title="Alert Settings"
        sub="How flood alerts are delivered, triggered and worded"
      />

      <SaveBar dirty={dirty}>
        <button type="button" className="mng-btn mng-btn-ghost" onClick={sendTest}>Send Test Alert</button>
        <button type="submit" className="mng-btn" disabled={!dirty}>Save Changes</button>
      </SaveBar>

      <div className="set-cols">
        {/* Delivery channels */}
        <Panel icon={<SendIcon />} title="Delivery Channels" sub="Where alerts are broadcast">
          <div className="set-toggles">
            <Toggle label="Email" sub="Send alert emails to staff and registered contacts via Supabase + Resend." checked={cfg.email} onChange={(v) => set('email', v)} />
            <Toggle label="Web push" sub="Browser notifications for command-center staff." checked={cfg.push} onChange={(v) => set('push', v)} />
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
            <UnitInput value={cfg.maxPerHour} onChange={(v) => set('maxPerHour', v)} suffix="/ hr" min="1" />
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
        <Panel icon={<ZapIcon />} title="Automatic Alerts" sub="Issue alerts from the flood-risk model">
          <div className="set-toggles">
            <Toggle
              label="Auto-issue on threshold breach"
              sub="Raise an alert automatically when a barangay's modeled flood depth crosses the trigger level."
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
              <UnitInput
                value={cfg.reissueInterval}
                onChange={(v) => set('reissueInterval', v)}
                suffix="min"
                min="5"
                disabled={!cfg.autoIssue}
              />
            </div>
          </div>

          {/* The depths those levels actually mean. Shown read-only here rather
              than described in prose — they are owned by the General tab. */}
          <div className="set-readonly">
            <div className="set-readonly-head">
              <span>Depth thresholds these levels use</span>
              <button type="button" className="mng-link" onClick={() => onGoToTab('general')}>
                Change on General
              </button>
            </div>
            <div className="set-readonly-rows">
              <ThresholdReadout level="low" label="Low" value={config.depthLow} />
              <ThresholdReadout level="moderate" label="Moderate" value={config.depthModerate} />
              <ThresholdReadout level="high" label="High" value={config.depthHigh} />
            </div>
          </div>
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

      <SettingsNote>
        These settings take effect immediately: the message templates pre-word every alert issued from the Alerts &amp;
        Dashboard screens, and — when Automatic Alerts is on — the system raises alerts on its own using the trigger
        level, quiet hours and throttle above. They persist to the shared backend.
      </SettingsNote>
    </form>
  )
}

/** One read-only threshold chip: the level badge and the depth it starts at. */
function ThresholdReadout({ level, label, value }) {
  return (
    <div className="set-readonly-row">
      <span className={`mng-badge ${level}`}>{label}</span>
      <span className="set-readonly-val">from {Number(value) || 0} m</span>
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────── */
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
