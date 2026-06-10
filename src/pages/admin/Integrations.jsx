import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — API Integrations (Settings).
 *
 * The external services the system talks to: the rainfall/weather feed, the
 * SMS and email gateways used to broadcast alerts, the map tile provider, the
 * flood-sensor feed and web push. Each card carries a connection status, the
 * keys/endpoints needed to reach it and an enable switch. Secrets are masked.
 *
 * Configuration is held in component state and acknowledged with a toast; it
 * persists to the backend (PUT /integrations) once it is connected.
 */

const STATUS_LABEL = { connected: 'Connected', disconnected: 'Not Connected', error: 'Error' }

/* Service catalogue. `fields` drive the Configure modal; the first non-secret
   field is echoed (masked where needed) on the card. */
const CATALOG = [
  {
    id: 'weather', name: 'Windy · Weather & Wind', category: 'Data Feed', icon: 'cloud',
    desc: 'Live rainfall, wind and forecast feeding the header, dashboards and the flood-risk model. Running keyless via Open-Meteo until a Windy key is set.',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://api.open-meteo.com/v1/forecast' },
      { key: 'apiKey', label: 'Windy API Key', type: 'password', placeholder: 'Optional — using keyless feed' },
    ],
    enabled: true, status: 'connected',
    values: { endpoint: 'https://api.open-meteo.com/v1/forecast' },
  },
  {
    id: 'floodhub', name: 'Google Flood Hub', category: 'Data Feed', icon: 'activity',
    desc: 'Flood forecast & river-discharge feeding the real-time hazard layer and flood-aware routing. Running keyless via the Open-Meteo Flood API until a Flood Hub key is set.',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://flood-api.open-meteo.com/v1/flood' },
      { key: 'apiKey', label: 'Flood Hub API Key', type: 'password', placeholder: 'Optional — using keyless feed' },
    ],
    enabled: true, status: 'connected',
    values: { endpoint: 'https://flood-api.open-meteo.com/v1/flood' },
  },
  {
    id: 'sms', name: 'SMS Gateway', category: 'Notifications', icon: 'message',
    desc: 'Broadcast flood alerts to residents and barangay officials by text message.',
    fields: [
      { key: 'provider', label: 'Provider', type: 'text', placeholder: 'e.g. Semaphore, Twilio' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Enter API key' },
      { key: 'sender', label: 'Sender ID', type: 'text', placeholder: 'CDRRMO' },
    ],
    enabled: false, status: 'disconnected',
  },
  {
    id: 'email', name: 'Email (SMTP)', category: 'Notifications', icon: 'mail',
    desc: 'Send alert digests, reports and account invites over your SMTP server.',
    fields: [
      { key: 'host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.cabuyao.gov.ph' },
      { key: 'port', label: 'Port', type: 'text', placeholder: '587' },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'alerts@cabuyao.gov.ph' },
      { key: 'password', label: 'Password', type: 'password', placeholder: 'Enter password' },
    ],
    enabled: false, status: 'disconnected',
  },
  {
    id: 'maptiles', name: 'Map Tiles', category: 'Mapping', icon: 'map',
    desc: 'Base map imagery for the Flood Map, Hazard Layer and routing screens.',
    fields: [
      { key: 'endpoint', label: 'Tile URL Template', type: 'text', placeholder: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
    ],
    enabled: true, status: 'connected',
    values: { endpoint: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  },
  {
    id: 'sensors', name: 'Flood Sensor Feed', category: 'Data Feed', icon: 'activity',
    desc: 'Measured water-level readings per barangay that drive every risk badge.',
    fields: [
      { key: 'endpoint', label: 'Feed Endpoint', type: 'text', placeholder: 'https://sensors.cabuyao.gov.ph/api/levels' },
      { key: 'apiKey', label: 'Access Token', type: 'password', placeholder: 'Enter access token' },
    ],
    enabled: false, status: 'disconnected',
  },
  {
    id: 'push', name: 'Push Notifications', category: 'Notifications', icon: 'bell',
    desc: 'Browser push alerts for staff using the command-center web app.',
    fields: [
      { key: 'publicKey', label: 'VAPID Public Key', type: 'text', placeholder: 'Enter public key' },
      { key: 'privateKey', label: 'VAPID Private Key', type: 'password', placeholder: 'Enter private key' },
    ],
    enabled: false, status: 'disconnected',
  },
]

const SECRET_KEYS = new Set(['apiKey', 'password', 'privateKey'])

export default function Integrations() {
  const [items, setItems] = useState(() => CATALOG.map((c) => ({ ...c, values: c.values || {} })))
  const [configuring, setConfiguring] = useState(null) // integration id
  const [toast, setToast] = useState('')

  const stats = useMemo(() => ({
    total: items.length,
    connected: items.filter((i) => i.status === 'connected').length,
    enabled: items.filter((i) => i.enabled).length,
    issues: items.filter((i) => i.status === 'error').length,
  }), [items])

  const current = configuring ? items.find((i) => i.id === configuring) : null

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function toggleEnabled(id) {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i
      // Can't enable a service that was never configured.
      if (!i.enabled && i.status !== 'connected') {
        flash(`Configure ${i.name} before enabling it.`)
        return i
      }
      return { ...i, enabled: !i.enabled }
    }))
  }

  function handleConfigure(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const values = {}
    for (const field of current.fields) values[field.key] = (f.get(field.key) || '').trim()
    // Connected once the first field has a value; otherwise back to not-connected.
    const connected = Boolean(values[current.fields[0].key])
    setItems((prev) => prev.map((i) => (i.id === configuring ? {
      ...i,
      values,
      status: connected ? 'connected' : 'disconnected',
      enabled: connected ? i.enabled : false,
    } : i)))
    setConfiguring(null)
    flash(connected ? `${current.name} connected.` : `${current.name} configuration cleared.`)
  }

  function disconnect(id) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'disconnected', enabled: false, values: {} } : i)))
    const it = items.find((i) => i.id === id)
    flash(`${it?.name || 'Integration'} disconnected.`)
  }

  return (
    <AdminLayout>
      <div className="set">
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <div className="mng-title">API Integrations</div>
              <div className="mng-sub">Connect the external services the system depends on</div>
            </div>
          </div>
        </div>

        <div className="mng-stats">
          <Stat color="blue" value={stats.total} label="Integrations" />
          <Stat color="green" value={stats.connected} label="Connected" />
          <Stat color="slate" value={stats.enabled} label="Enabled" />
          <Stat color="red" value={stats.issues} label="Issues" />
        </div>

        <div className="set-int-grid">
          {items.map((i) => {
            const primary = i.fields[0]
            const primaryVal = i.values[primary.key]
            return (
              <div key={i.id} className="set-int">
                <div className="set-int-top">
                  <div className="set-int-icon"><Icon name={i.icon} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="set-int-name">{i.name}</div>
                    <div className="set-int-cat">{i.category}</div>
                  </div>
                  <span className={`set-status ${i.status}`}>{STATUS_LABEL[i.status]}</span>
                </div>

                <div className="set-int-desc">{i.desc}</div>

                <div className="set-int-meta">
                  <span className="set-int-endpoint">
                    {primaryVal
                      ? `${primary.label}: ${SECRET_KEYS.has(primary.key) ? maskSecret(primaryVal) : primaryVal}`
                      : <span className="mng-muted">Not configured</span>}
                  </span>
                  {i.status === 'connected' && (
                    <button type="button" className="mng-link subtle" onClick={() => disconnect(i.id)}>Disconnect</button>
                  )}
                </div>

                <div className="set-int-actions">
                  <button type="button" className="mng-link" onClick={() => setConfiguring(i.id)}>Configure</button>
                  <label className="switch" title={i.status === 'connected' ? 'Enable / disable' : 'Configure first'}>
                    <input type="checkbox" checked={i.enabled} onChange={() => toggleEnabled(i.id)} />
                    <span className="switch-slider" />
                  </label>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mng-note">
          <SparkIcon />
          <span>Keys are masked and stored for this session only. Connections are validated and persisted once the integrations API is connected.</span>
        </div>
      </div>

      {/* Configure modal */}
      {current && (
        <div className="mng-overlay" onMouseDown={() => setConfiguring(null)}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label={`Configure ${current.name}`} onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Configure · {current.name}</div>
                <div className="mng-modal-sub">{current.category} integration</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setConfiguring(null)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleConfigure}>
              {current.fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    name={field.key}
                    type={field.type}
                    defaultValue={current.values[field.key] || ''}
                    placeholder={field.placeholder}
                    autoComplete="off"
                  />
                </label>
              ))}
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => setConfiguring(null)}>Cancel</button>
                <button type="submit" className="mng-btn">Save &amp; Connect</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}

function maskSecret(v) {
  if (v.length <= 4) return '••••'
  return `${'•'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`
}

function Stat({ color, value, label }) {
  return (
    <div className={`mng-stat ${color}`}>
      <div className="mng-stat-val">{value}</div>
      <div className="mng-stat-lbl">{label}</div>
    </div>
  )
}

function Icon({ name }) {
  switch (name) {
    case 'cloud':
      return <svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
    case 'message':
      return <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
    case 'mail':
      return <svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
    case 'map':
      return <svg viewBox="0 0 24 24"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
    case 'activity':
      return <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
    case 'bell':
      return <svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
    default:
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>
  }
}
function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
