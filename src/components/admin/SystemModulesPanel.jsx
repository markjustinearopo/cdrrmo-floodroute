import { useMemo, useState } from 'react'
import { useIntegrations, nowLabel } from '../../context/AdminDataContext.jsx'
import { INTEGRATION_STATUS_LABEL, INTEGRATION_SECRET_KEYS } from '../../data/integrations.js'
import './SystemModulesPanel.css'

/**
 * Flood Map → System Modules tab.
 *
 * A live status board for the external services the system depends on,
 * mirroring the API Integrations settings screen through the same shared
 * AdminDataContext store — so a service connected/disconnected on Settings
 * shows here instantly, and "Test" probes the keyless live feeds for real and
 * records the response time. The roll-up metrics (avg response, reachable
 * share) are computed from the latest probes.
 */

function maskSecret(v) {
  if (!v) return ''
  if (v.length <= 4) return '••••'
  return `${'•'.repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`
}

export default function SystemModulesPanel() {
  const { integrations, setIntegration } = useIntegrations()
  const [testing, setTesting] = useState(null) // id being probed, or 'all'
  const [toast, setToast] = useState('')

  const stats = useMemo(() => {
    const connected = integrations.filter((i) => i.status === 'connected')
    const errors = integrations.filter((i) => i.status === 'error')
    const probed = integrations.filter((i) => i.responseMs != null)
    const avgMs = probed.length
      ? Math.round(probed.reduce((s, i) => s + i.responseMs, 0) / probed.length)
      : null
    return {
      connected: connected.length,
      enabled: integrations.filter((i) => i.enabled).length,
      errors: errors.length,
      total: integrations.length,
      avgMs,
      uptime: Math.round((connected.length / Math.max(integrations.length, 1)) * 100),
    }
  }, [integrations])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  /* Genuinely probe a live feed. Only services with a public testUrl can be
     verified from the browser — credential-based services never reach here
     (their card says so honestly instead of stamping a check that never ran). */
  async function probe(it) {
    const started = performance.now()
    try {
      const res = await fetch(it.testUrl, { signal: AbortSignal.timeout(8000) })
      const ms = Math.round(performance.now() - started)
      setIntegration(it.id, {
        status: res.ok ? 'connected' : 'error',
        lastCheck: nowLabel(), lastCheckAt: Date.now(), responseMs: ms,
      })
      return res.ok
    } catch {
      setIntegration(it.id, { status: 'error', lastCheck: nowLabel(), lastCheckAt: Date.now(), responseMs: null })
      return false
    }
  }

  async function testOne(it) {
    setTesting(it.id)
    const ok = await probe(it)
    setTesting(null)
    flash(ok ? `${it.name} reachable.` : `${it.name} unreachable.`)
  }

  async function testAll() {
    setTesting('all')
    const targets = integrations.filter((i) => i.testUrl)
    const results = await Promise.all(targets.map(probe))
    setTesting(null)
    flash(`Checked ${targets.length} live feeds — ${results.filter(Boolean).length} reachable.`)
  }

  function disconnect(it) {
    setIntegration(it.id, { status: 'disconnected', enabled: false, values: {} })
    flash(`${it.name} disconnected.`)
  }

  return (
    <div className="sysmod">
      <div className="sysmod-head">
        <div>
          <div className="sysmod-title">System Modules</div>
          <div className="sysmod-sub">Live status of the external services powering the command center</div>
        </div>
        <button type="button" className="sysmod-testall" disabled={testing === 'all'} onClick={testAll}>
          {testing === 'all' ? 'Testing…' : 'Test all feeds'}
        </button>
      </div>

      {/* Roll-up metrics */}
      <div className="sysmod-metrics">
        <Metric value={`${stats.connected}/${stats.total}`} label="Connected" tone="green" />
        <Metric value={stats.enabled} label="Enabled" tone="blue" />
        <Metric value={stats.errors} label="Errors" tone={stats.errors ? 'red' : 'slate'} />
        <Metric value={stats.avgMs != null ? `${stats.avgMs} ms` : '—'} label="Avg response" tone="slate" />
        <Metric value={`${stats.uptime}%`} label="Reachable" tone="green" />
      </div>

      {/* Service grid */}
      <div className="sysmod-grid">
        {integrations.map((it) => {
          const primary = it.fields[0]
          const primaryVal = it.values?.[primary.key]
          const verifiable = Boolean(it.testUrl)
          return (
            <div key={it.id} className={`sysmod-card ${it.status}`}>
              <div className="sysmod-card-top">
                <span className={`sysmod-dot ${it.status}`} />
                <div className="sysmod-card-name">{it.name}</div>
                <span className={`sysmod-status ${it.status}`}>{INTEGRATION_STATUS_LABEL[it.status]}</span>
              </div>
              <div className="sysmod-card-cat">
                {it.category}
                {/* Verified feeds and assumed-configured services must never
                    look identical — say which one this card is. */}
                <span
                  className={`sysmod-verify ${verifiable ? 'live' : 'manual'}`}
                  title={verifiable
                    ? 'This feed is tested with a real network request; the status reflects an actual probe.'
                    : 'Credential-based service — the browser cannot verify the key, so the status reflects the saved configuration only.'}
                >
                  {!verifiable ? 'Config only — not verifiable'
                    : it.responseMs != null ? 'Network-verified'
                    : 'Live-testable'}
                </span>
              </div>

              <div className="sysmod-card-meta">
                <span>
                  {primaryVal
                    ? `${primary.label}: ${INTEGRATION_SECRET_KEYS.has(primary.key) ? maskSecret(primaryVal) : primaryVal}`
                    : 'Not configured'}
                </span>
              </div>

              <div className="sysmod-card-stats">
                <span>{verifiable ? `Last verified: ${it.lastCheck || '—'}` : 'Never network-verified'}</span>
                <span>{it.responseMs != null ? `${it.responseMs} ms` : it.enabled ? 'Enabled' : 'Disabled'}</span>
              </div>

              <div className="sysmod-card-actions">
                {verifiable ? (
                  <button type="button" className="sysmod-link" disabled={testing === it.id} onClick={() => testOne(it)}>
                    {testing === it.id ? 'Testing…' : 'Test'}
                  </button>
                ) : (
                  <span className="sysmod-link-hint">No public test endpoint</span>
                )}
                {it.status === 'connected'
                  ? <button type="button" className="sysmod-link subtle" onClick={() => disconnect(it)}>Disconnect</button>
                  : <span className="sysmod-link-hint">Configure under Settings → API Integrations</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}

function Metric({ value, label, tone }) {
  return (
    <div className={`sysmod-metric ${tone}`}>
      <div className="sysmod-metric-val">{value}</div>
      <div className="sysmod-metric-lbl">{label}</div>
    </div>
  )
}
