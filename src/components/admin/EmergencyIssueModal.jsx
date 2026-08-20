import { useState } from 'react'
import { BARANGAYS, CITY_WIDE } from '../../data/cabuyao.js'
import './EmergencyIssueModal.css'

/**
 * Issuing an emergency alert.
 *
 * This is the only control in the product that takes over every screen in the
 * city and sounds a siren, so it is the only one guarded like this: the
 * operator picks a target, writes the instruction themselves, and then types
 * the target's name to arm the button. The typing is not ceremony — it is the
 * step that makes an accidental siren essentially impossible, and it is the
 * same pattern the app already uses before an irreversible delete.
 *
 * There is no template and no pre-filled message. An emergency instruction has
 * to say what to actually do, and a canned sentence is how a warning ends up
 * saying nothing. The operator writes it.
 */
export default function EmergencyIssueModal({ onClose, onIssue }) {
  const [barangay, setBarangay] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState('')

  const target = barangay || 'CITY-WIDE'
  const armed =
    title.trim().length > 3
    && message.trim().length > 10
    && confirm.trim().toUpperCase() === target.toUpperCase()

  function submit(e) {
    e.preventDefault()
    if (!armed) return
    onIssue({
      level: 'emergency',
      barangay: barangay || CITY_WIDE,
      title: title.trim(),
      message: message.trim(),
    })
  }

  return (
    <div className="mng-overlay" onMouseDown={onClose}>
      <div
        className="mng-modal eim"
        role="dialog"
        aria-modal="true"
        aria-label="Issue emergency alert"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="eim-bar" aria-hidden="true" />

        <div className="mng-modal-head eim-head">
          <div>
            <div className="eim-kicker">EMERGENCY ALERT</div>
            <div className="mng-modal-sub">
              Takes over every screen and sounds a siren until acknowledged
            </div>
          </div>
          <button type="button" className="mng-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="eim-warn">
          <b>This is the highest tier and it is not quiet.</b> Everyone signed in to
          CDRRMO FloodRoute — operators, barangay officials and residents — gets a
          full-screen warning with a siren that keeps sounding until they acknowledge it.
          Use it when someone has to move now. Anything less urgent belongs in a High alert.
        </div>

        <form className="mng-form" onSubmit={submit}>
          <label>
            Target
            <select value={barangay} onChange={(e) => { setBarangay(e.target.value); setConfirm('') }}>
              <option value="">City-wide — all 18 barangays</option>
              {BARANGAYS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>

          <label>
            What is happening
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Evacuate now — Marinig riverside"
              maxLength={80}
              required
            />
          </label>

          <label>
            What people must do
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Water is rising fast along Calle Onse. Move to Marinig Elementary School immediately. Do not cross Daang Marinig."
              required
            />
            <span className="mng-field-hint">
              Write the instruction in full. There is no template here on purpose — an
              emergency message has to say what to do, and a canned sentence usually doesn't.
            </span>
          </label>

          <label className="eim-confirm">
            Type <b>{target}</b> to arm this alert
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={target}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <div className="mng-form-actions">
            <button type="button" className="mng-btn mng-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="eim-go" disabled={!armed}>
              {armed ? 'Issue emergency alert' : 'Complete the fields above'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
