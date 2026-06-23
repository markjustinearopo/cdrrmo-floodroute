import { useEffect } from 'react'
import './Modal.css'
import './ConfirmDialog.css'

/**
 * Reusable yes/no confirmation dialog — the careful "are you sure?" prompt used
 * before sign-out and any destructive action (delete / clear / remove / resolve)
 * across every portal. Built on the same card aesthetic as Modal.jsx (backdrop
 * blur, red-accent header, soft shadow) but with two footer buttons instead of a
 * single dismiss.
 *
 * Closes (cancels) on the X, the Cancel button, a backdrop click, or Escape.
 * Pressing Enter confirms, so a keyboard user can act without reaching for the
 * mouse.
 *
 * props:
 *   title        — heading (e.g. "Sign out?")
 *   message      — body text / node explaining the consequence
 *   confirmLabel — primary button text (default "Confirm")
 *   cancelLabel  — secondary button text (default "Cancel")
 *   tone         — 'danger' (red confirm) | 'default' (navy confirm)
 *   icon         — optional SVG node for the header badge
 *   onConfirm    — called when the user confirms
 *   onCancel     — called when the user cancels / dismisses
 */
export default function ConfirmDialog({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  icon,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel?.()
      if (e.key === 'Enter') {
        // Don't hijack Enter while the user is typing in a field (e.g. a reason
        // textarea inside the dialog) — let it insert a newline as expected.
        const tag = (e.target?.tagName || '').toLowerCase()
        if (tag === 'textarea' || tag === 'input' || e.target?.isContentEditable) return
        onConfirm?.()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onConfirm, onCancel])

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className={`modal-card confirm-card ${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className={`modal-icon confirm-icon ${tone}`}>
              {icon || (
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              )}
            </span>
            <h3 className="modal-title">{title}</h3>
          </div>
          <button className="modal-close" onClick={onCancel} aria-label="Cancel">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {message != null && <div className="modal-body confirm-msg">{message}</div>}

        <div className="modal-footer confirm-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-navy'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
