import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import './Modal.css'
import './ConfirmDialog.css'
import './PromptDialog.css'

/**
 * Ask for one value — the counterpart to ConfirmDialog's yes/no.
 *
 * WHY THIS EXISTS
 * Updating an evacuation centre's headcount went through `window.prompt()`.
 * That is the browser's own grey box, and it has three problems that matter
 * for the one screen where an operator types how many people are sheltering
 * during a flood:
 *
 *   1. It is not the product. It carries no centre name styling, no capacity,
 *      no sense of whether 300 is fine or over the roof.
 *   2. It blocks the JavaScript thread outright. Live weather polling, the
 *      alert feed and the map all freeze behind it.
 *   3. It cannot validate. `window.prompt` returns a string and the caller
 *      coerced it with `Number(v) || 0`, so a typo of "3OO" silently recorded
 *      **zero people** in a shelter. That is a wrong number on the screen the
 *      city would use to decide where to send the next truck.
 *
 * So this validates before it will let you commit, and shows the consequence
 * of the number as you type it.
 *
 * props
 *   title, message  — heading and supporting copy
 *   label           — field label (required; the input is never unlabelled)
 *   defaultValue    — starting value
 *   type            — 'text' | 'number'
 *   min, max        — numeric bounds, enforced not just decorative
 *   hint(value)     — node rendered live under the field, e.g. "76% full"
 *   validate(value) → string | null   error message, or null when acceptable
 *   confirmLabel, cancelLabel
 *   onSubmit(value) — value is a Number for type="number", else a string
 *   onCancel
 */
export default function PromptDialog({
  title = 'Enter a value',
  message,
  label,
  defaultValue = '',
  type = 'text',
  min,
  max,
  hint,
  validate,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onSubmit,
  onCancel,
}) {
  const [value, setValue] = useState(String(defaultValue ?? ''))
  /* Errors appear on submit, not on the first keystroke. Shouting "invalid"
     at someone who has typed "3" on the way to "300" trains them to ignore
     the message by the time it is true. */
  const [touched, setTouched] = useState(false)
  const dialogRef = useFocusTrap(true)
  const inputRef = useRef(null)

  const trimmed = value.trim()
  let error = null
  if (type === 'number') {
    if (trimmed === '') error = 'Enter a number.'
    else if (!/^-?\d+(\.\d+)?$/.test(trimmed)) error = 'Numbers only — no letters or symbols.'
    else if (min != null && Number(trimmed) < min) error = `Cannot be less than ${min}.`
    else if (max != null && Number(trimmed) > max) error = `Cannot be more than ${max}.`
  } else if (trimmed === '') {
    error = 'This cannot be empty.'
  }
  if (!error && validate) error = validate(type === 'number' ? Number(trimmed) : trimmed)

  function submit() {
    setTouched(true)
    if (error) {
      inputRef.current?.focus()
      return
    }
    onSubmit?.(type === 'number' ? Number(trimmed) : trimmed)
  }

  /* The focus trap puts focus on the first focusable thing in the dialog,
     which is the header's close button — correct for a confirmation, wrong
     here, where the whole point is to type. This runs after the trap's own
     effect and puts the caret in the field, with the existing value selected
     so typing replaces it the way window.prompt did. */
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.select?.()
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onCancel])

  const fieldId = 'prompt-dialog-field'
  const errId = 'prompt-dialog-error'
  const showError = touched && error

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-card confirm-card prompt-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <h3 className="modal-title">{title}</h3>
          </div>
          <button className="modal-close" onClick={onCancel} aria-label="Cancel">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <form
          className="modal-body prompt-body"
          onSubmit={(e) => { e.preventDefault(); submit() }}
        >
          {message && <p className="prompt-msg">{message}</p>}

          <label className="prompt-label" htmlFor={fieldId}>{label}</label>
          <input
            id={fieldId}
            ref={inputRef}
            className={`prompt-input ${showError ? 'invalid' : ''}`}
            type={type === 'number' ? 'text' : type}
            /* inputMode over type="number": the spinner arrows are a 12px
               target, and type="number" silently discards a value the browser
               considers malformed, which is the failure this replaced. */
            inputMode={type === 'number' ? 'numeric' : undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={showError ? 'true' : undefined}
            aria-describedby={showError ? errId : undefined}
            autoFocus
          />

          {showError
            ? <p className="prompt-error" id={errId} role="alert">{error}</p>
            : hint && <p className="prompt-hint">{hint(trimmed)}</p>}
        </form>

        <div className="modal-footer confirm-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-navy" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
