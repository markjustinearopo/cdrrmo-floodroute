import { useMemo, useState } from 'react'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import RecordList from '../../components/admin/RecordList.jsx'
import { BARANGAYS, ALERT_LEVELS } from '../../data/cabuyao.js'
import { useAlerts, nowLabel, fillAlertTemplate } from '../../context/AdminDataContext.jsx'
import { sendAlertEmail } from '../../services/emailAlert.js'
import './Manage.css'

/**
 * CDRRMO Admin — Alerts.
 *
 * Manage (issue / resolve / withdraw) the flood-hazard alerts broadcast to
 * each barangay. Alerts live in the shared AdminDataContext store, so an
 * alert issued here appears instantly on the Dashboard feed and the Flood
 * Map's Alerts panel, persists across refreshes, and an alert can be
 * scheduled to auto-issue at a future time.
 */

const LEVEL_LABEL = { high: 'High', moderate: 'Moderate', safe: 'All Clear' }

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active', test: (a) => a.status === 'active' },
  { key: 'high', label: 'High', test: (a) => a.level === 'high' },
  { key: 'moderate', label: 'Moderate', test: (a) => a.level === 'moderate' },
  { key: 'scheduled', label: 'Scheduled', test: (a) => a.status === 'scheduled' },
  { key: 'resolved', label: 'Resolved', test: (a) => a.status === 'resolved' },
]

// datetime-local needs "YYYY-MM-DDTHH:mm" — pre-fill ~1 hour from now.
function defaultScheduleValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function Alerts() {
  const { alerts, addAlert, updateAlert, resolveAlert, removeAlert } = useAlerts()
  const [showModal, setShowModal] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [toast, setToast] = useState('')
  const [confirm, setConfirm] = useState(null) // { title, message, confirmLabel, onConfirm }

  // Issue-modal fields are controlled so the operator's saved MESSAGE TEMPLATE
  // (Alert Settings) becomes the starting wording — re-worded whenever the
  // level/barangay changes, until the operator edits the text themselves.
  const BLANK_FORM = { barangay: '', level: 'high', title: '', message: '', msgEdited: false }
  const [form, setForm] = useState(BLANK_FORM)

  function openIssue() {
    setForm({ ...BLANK_FORM, message: fillAlertTemplate('high', {}) })
    setScheduling(false)
    setShowModal(true)
  }
  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      // Re-flow the template when the level or barangay changes, unless the
      // operator has already hand-edited the message.
      if ((key === 'level' || key === 'barangay') && !prev.msgEdited) {
        next.message = fillAlertTemplate(next.level, { barangay: next.barangay })
      }
      return next
    })
  }

  const stats = useMemo(() => [
    { color: 'red', value: alerts.filter((a) => a.status === 'active').length, label: 'Active' },
    { color: 'red', value: alerts.filter((a) => a.status === 'active' && a.level === 'high').length, label: 'High' },
    { color: 'amber', value: alerts.filter((a) => a.status === 'active' && a.level === 'moderate').length, label: 'Moderate' },
    { color: 'green', value: alerts.filter((a) => a.status === 'resolved').length, label: 'Resolved' },
  ], [alerts])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }

  function handleIssue(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const alert = {
      title: form.title.trim(),
      barangay: form.barangay,
      level: form.level,
      message: form.message.trim(),
    }
    // "Schedule for later": the alert queues and auto-issues when due
    // (the shared store promotes it on the next real-time refresh tick).
    const when = scheduling ? new Date(f.get('when')).getTime() : null
    if (when && when > Date.now()) {
      alert.status = 'scheduled'
      alert.scheduledFor = when
      alert.issued = `Scheduled · ${nowLabel(when)}`
    }
    addAlert(alert)
    // Fire email for immediately-active alerts; scheduled ones email when they auto-promote.
    if (alert.status !== 'scheduled') {
      sendAlertEmail({ level: alert.level, title: alert.title, message: alert.message, barangay: alert.barangay })
        .catch(console.warn)
    }
    setShowModal(false)
    setScheduling(false)
    flash(alert.status === 'scheduled'
      ? `Alert scheduled for ${alert.barangay} at ${nowLabel(when)}.`
      : `Alert issued for ${alert.barangay}.`)
  }

  // One "are you sure?" pattern for every destructive change, matching the
  // Dashboard / Flood Map resolve flows.
  function resolve(alert) {
    setConfirm({
      title: 'Resolve this alert?',
      message: `"${alert.title}" (${alert.barangay}) will be marked resolved and leave the active feed on every portal.`,
      confirmLabel: 'Resolve alert',
      onConfirm: () => {
        resolveAlert(alert.id)
        setConfirm(null)
        flash('Alert marked resolved.')
      },
    })
  }
  function reopen(id) {
    updateAlert(id, { status: 'active', issued: nowLabel(), issuedAt: Date.now() })
  }
  // RecordList owns the confirmation — this only runs after the user says yes.
  function remove(alert) {
    removeAlert(alert.id)
    flash('Alert withdrawn.')
  }

  const columns = useMemo(() => [
    {
      key: 'alert', header: 'Alert',
      render: (a) => (
        <>
          <div className="mng-strong">{a.title}</div>
          {a.message && <div className="mng-muted" style={{ fontSize: '0.75rem' }}>{a.message}</div>}
        </>
      ),
    },
    { key: 'barangay', header: 'Barangay', render: (a) => a.barangay },
    { key: 'level', header: 'Level', render: (a) => <span className={`mng-badge ${a.level}`}>{LEVEL_LABEL[a.level]}</span> },
    { key: 'issued', header: 'Issued', className: 'mng-muted mng-num', render: (a) => a.issued },
    { key: 'status', header: 'Status', render: (a) => <span className={`mng-badge ${a.status}`}>{a.status}</span> },
  ], [])

  return (
    <AdminLayout>
      <div className="mng">
        {/* Header */}
        <div className="mng-head">
          <div className="mng-head-titles">
            <div className="mng-head-icon">
              <svg viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="mng-title">Alerts</div>
              <div className="mng-sub">Issue and manage flood-hazard alerts per barangay</div>
            </div>
          </div>
          <button type="button" className="mng-btn" onClick={openIssue}>
            <PlusIcon /> Issue Alert
          </button>
        </div>

        {/* Stats */}
        <RecordList
          rows={alerts}
          rowLabel={(a) => a.title}
          stats={stats}
          filters={FILTERS}
          searchKeys={(a) => `${a.title} ${a.barangay} ${a.message}`}
          searchPlaceholder="Search alert, barangay or message…"
          columns={columns}
          rowActions={(a) => [
            ...(a.status === 'active' ? [{ label: 'Resolve', onClick: () => resolve(a) }] : []),
            ...(a.status === 'scheduled' ? [{ label: 'Issue now', onClick: () => reopen(a.id) }] : []),
            ...(a.status === 'resolved' ? [{ label: 'Reopen', onClick: () => reopen(a.id), subtle: true }] : []),
          ]}
          onDelete={remove}
          deleteLabel={() => 'Withdraw'}
          deleteConfirm={(a) => ({
            title: 'Withdraw this alert?',
            message: `"${a.title}" (${a.barangay}) will be permanently removed from the record. This cannot be undone.`,
            confirmLabel: 'Withdraw alert',
          })}
          emptyAll={{ title: 'No alerts issued yet', sub: 'Use “Issue Alert” to broadcast a flood-hazard warning to a barangay.' }}
          empty={{ title: 'No alerts match this filter', sub: 'Try a different filter or clear your search.' }}
        />

        <div className="mng-note">
          <SparkIcon />
          <span>Alerts are shared system-wide: they appear on the Dashboard feed and the Flood Map, persist across refreshes, and scheduled alerts auto-issue at their set time.</span>
        </div>
      </div>

      {/* Issue modal */}
      {showModal && (
        <div className="mng-overlay" onMouseDown={() => { setShowModal(false); setScheduling(false) }}>
          <div className="mng-modal" role="dialog" aria-modal="true" aria-label="Issue Alert" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mng-modal-head">
              <div>
                <div className="mng-modal-title">Issue Hazard Alert</div>
                <div className="mng-modal-sub">Broadcast a flood-hazard warning to a barangay</div>
              </div>
              <button type="button" className="mng-modal-close" onClick={() => setShowModal(false)} aria-label="Close">×</button>
            </div>
            <form className="mng-form" onSubmit={handleIssue}>
              <div className="mng-form-grid">
                <label>
                  Barangay
                  <select
                    name="barangay"
                    required
                    value={form.barangay}
                    onChange={(e) => setField('barangay', e.target.value)}
                  >
                    <option value="" disabled>Select Barangay</option>
                    {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
                  </select>
                </label>
                <label>
                  Alert Level
                  <select
                    name="level"
                    required
                    value={form.level}
                    onChange={(e) => setField('level', e.target.value)}
                  >
                    {ALERT_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </label>
              </div>
              <label>
                Alert Title
                <input
                  name="title"
                  type="text"
                  placeholder="Severe Flood Warning"
                  required
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                />
              </label>
              <label>
                Message
                <span className="mng-label-hint">Pre-filled from your Alert Settings template — edit as needed.</span>
                <textarea
                  name="message"
                  rows={3}
                  placeholder="Affected areas, water level and evacuation advice."
                  required
                  value={form.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value, msgEdited: true }))}
                />
              </label>
              <label className="mng-check">
                <input
                  type="checkbox"
                  checked={scheduling}
                  onChange={(e) => setScheduling(e.target.checked)}
                />
                <span>Schedule for later — queue this alert and issue it automatically</span>
              </label>
              {scheduling && (
                <label>
                  Issue At
                  <input name="when" type="datetime-local" defaultValue={defaultScheduleValue()} required />
                </label>
              )}
              <div className="mng-form-actions">
                <button type="button" className="mng-btn mng-btn-ghost" onClick={() => { setShowModal(false); setScheduling(false) }}>Cancel</button>
                <button type="submit" className="mng-btn">{scheduling ? 'Schedule Alert' : 'Issue Alert'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}


function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  )
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
  )
}
