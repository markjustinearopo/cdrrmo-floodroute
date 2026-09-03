import { useEffect, useMemo, useState } from 'react'
import { BARANGAYS } from '../../data/cabuyao.js'
import { smsStats } from '../../services/smsAlert.js'
import './TextSmsModal.css'
import DialogOverlay from '../DialogOverlay.jsx'

/**
 * Plain bulk SMS — the operator writes a sentence and it goes to residents.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE ALERT BUTTONS
 * Everything else on this page creates an alert: a severity, a record in the
 * log, a banner on every open screen, an email. Most of what a CDRRMO office
 * actually needs to tell residents is none of that — "relief goods at the
 * covered court from 8am", "the Sala centre is open", "water is back on Calle
 * Onse". Forcing those through the alert machinery either inflates the alert
 * log with things that are not alerts, or means they never get sent. So this
 * is one channel doing one thing, with no alert record behind it.
 *
 * WHAT IT SHOWS BEFORE IT SENDS
 * The exact text the resident will receive, the number of handsets, and the
 * number of SMS segments. The segment count is not trivia: the gateway's free
 * tier is 300 messages a month, and a message that runs 20 characters over
 * silently costs double. Better to see that while there is still time to cut a
 * word than to find out in the delivery log.
 */
export default function TextSmsModal({ onClose, onSend }) {
  const [message, setMessage] = useState('')
  const [barangay, setBarangay] = useState('')
  const [stats, setStats] = useState(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let alive = true
    smsStats()
      .then((s) => { if (alive) setStats(s) })
      .catch(() => { if (alive) setStats({ error: true }) })
    return () => { alive = false }
  }, [])

  /* How many handsets this actually reaches. A barangay send also covers
     numbers with no barangay recorded, matching what the function does — the
     count on screen has to be the count that gets texted, or it is worse than
     showing nothing. */
  const reach = useMemo(() => {
    if (!stats || stats.error) return null
    if (!barangay) return stats.verified ?? 0
    const byB = stats.byBarangay || {}
    const named = byB[barangay] ?? 0
    const known = Object.values(byB).reduce((a, b) => a + b, 0)
    const unassigned = Math.max((stats.verified ?? 0) - known, 0)
    return named + unassigned
  }, [stats, barangay])

  const text = message.trim() ? `[CDRRMO CABUYAO] ${message.trim()}` : ''
  /* GSM-7: 160 characters in one segment, 153 each once it splits. Any
     character outside the basic alphabet forces UCS-2 at 70/67, which is why
     one stray curly quote can double the cost of a citywide send. */
  const unicode = /[^\x20-\x7E\n\r]/.test(text)
  const per = unicode ? 70 : 160
  const perNext = unicode ? 67 : 153
  const segments = text.length === 0 ? 0
    : text.length <= per ? 1
    : Math.ceil(text.length / perNext)

  const ready = message.trim().length > 4 && reach !== null && reach > 0 && !sending

  async function submit(e) {
    e.preventDefault()
    if (!ready) return
    setSending(true)
    try {
      await onSend({ message: message.trim(), barangay: barangay || null })
    } finally {
      setSending(false)
    }
  }

  return (
    <DialogOverlay className="mng-overlay" onDismiss={onClose}>
      <div
        className="mng-modal tsm"
        role="dialog"
        aria-modal="true"
        aria-label="Send a text message to residents"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mng-modal-head">
          <div>
            <div className="tsm-kicker">TEXT MESSAGE</div>
            <div className="mng-modal-sub">
              Goes to residents&apos; phones only — no alert is recorded
            </div>
          </div>
          <button type="button" className="mng-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form className="mng-form" onSubmit={submit}>
          <label>
            Send to
            <select value={barangay} onChange={(e) => setBarangay(e.target.value)}>
              <option value="">All residents with a confirmed number</option>
              {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
            </select>
            {barangay && (
              <span className="mng-field-hint">
                Also reaches residents who never recorded a barangay — better over-told than missed.
              </span>
            )}
          </label>

          <label>
            Message
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Relief goods will be distributed at the covered court from 8am tomorrow. Bring a valid ID."
              maxLength={280}
              required
              autoFocus
            />
          </label>

          {text && (
            <div className="tsm-preview">
              <div className="tsm-preview-label">What the resident receives</div>
              <div className="tsm-bubble">{text}</div>
              <div className={`tsm-meter ${segments > 1 ? 'tsm-meter--warn' : ''}`}>
                <span>{text.length} characters</span>
                <span>
                  {segments} SMS {segments === 1 ? 'segment' : 'segments'}
                  {unicode && ' · non-standard characters'}
                </span>
              </div>
              {segments > 1 && (
                <div className="tsm-hint">
                  Over one segment, so every recipient costs {segments} messages instead of one.
                  {unicode && ' Curly quotes, emoji or “—” force the short 70-character limit — plain text fits far more.'}
                </div>
              )}
            </div>
          )}

          <div className="tsm-reach">
            {stats === null && <span className="tsm-reach-dim">Checking who is subscribed…</span>}
            {stats?.error && <span className="tsm-reach-dim">Could not read the subscriber list.</span>}
            {reach !== null && reach > 0 && (
              <>
                Sending to <b>{reach}</b> {reach === 1 ? 'phone' : 'phones'}
                {segments > 1 && <> · <b>{reach * segments}</b> messages billed</>}
              </>
            )}
            {reach === 0 && (
              <span className="tsm-reach-none">
                No confirmed numbers {barangay ? `for Brgy. ${barangay}` : 'yet'} — nothing to send to.
              </span>
            )}
          </div>

          <div className="mng-form-actions">
            <button type="button" className="mng-btn mng-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="tsm-go" disabled={!ready}>
              {sending ? 'Sending…' : reach ? `Send to ${reach}` : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  )
}
