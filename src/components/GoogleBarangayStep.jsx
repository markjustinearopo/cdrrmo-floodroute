import { useState } from 'react'
import DialogOverlay from './DialogOverlay.jsx'
import './googleBarangay.css'

/* ============================================================
   The one question Google cannot answer.

   A Google ID token proves an email address and a name. It says nothing about
   where the person lives, and this entire system is scoped by barangay: which
   alerts reach them, which evacuation centres and roads they see, and what
   RLS will let their session read. An account without one is not a partial
   account, it is an account the app cannot serve.

   So a first-time Google sign-in stops here. The server has already verified
   Google's signature and issued a signed ten-minute ticket carrying the
   address; nothing on this screen can change who they are, only where they
   are. That separation is why the ticket exists rather than the browser
   simply posting back an email of its choosing.
   ============================================================ */

export default function GoogleBarangayStep({
  email,
  fullName,
  barangays,
  busy = false,
  error = '',
  onSubmit,
  onCancel,
}) {
  const [barangay, setBarangay] = useState('')

  return (
    <DialogOverlay className="gbs-overlay" onDismiss={busy ? undefined : onCancel}>
      <div
        className="gbs-card light-auth"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gbs-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="gbs-title" id="gbs-title">One last thing</h2>
        <p className="gbs-sub">
          Signed in as <b>{email}</b>
          {fullName ? <> — welcome, {fullName.split(' ')[0]}.</> : '.'}
        </p>

        <p className="gbs-why">
          Which barangay do you live in? CDRRMO uses this to send you only the
          flood warnings and evacuation routes for your own area.
        </p>

        <div className="gbs-field">
          <label htmlFor="gbs-brgy">Barangay</label>
          <select
            id="gbs-brgy"
            value={barangay}
            onChange={(e) => setBarangay(e.target.value)}
            disabled={busy}
            autoFocus
          >
            <option value="">Select your barangay…</option>
            {barangays.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {error && <p className="gbs-error" role="alert">{error}</p>}

        <div className="gbs-actions">
          <button type="button" className="gbs-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="gbs-go"
            onClick={() => onSubmit(barangay)}
            disabled={busy || !barangay}
          >
            {busy ? 'Creating your account…' : 'Finish sign-up'}
          </button>
        </div>

        <p className="gbs-note">
          You can ask CDRRMO to change this later if you move.
        </p>
      </div>
    </DialogOverlay>
  )
}
