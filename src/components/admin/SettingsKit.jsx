/* ============================================================
   Shared building blocks for the Settings screen.

   System Configuration and Alert Settings each carried a private,
   near-identical copy of Panel / Toggle / the save bar; merging the five
   settings pages into one tabbed screen made keeping two copies indefensible.
   The versions here are the more complete set (System Configuration's), so a
   change to a field's chrome now lands on every tab at once.

   The markup is unchanged — it maps onto the existing .set-* rules in
   src/pages/admin/Settings.css.
   ============================================================ */

/** Titled card with an icon badge — the container every settings group uses. */
export function Panel({ icon, title, sub, actions, children }) {
  return (
    <section className="set-panel">
      <div className="set-panel-head">
        <div className="set-panel-icon">{icon}</div>
        <div>
          <div className="set-panel-title">{title}</div>
          <div className="set-panel-sub">{sub}</div>
        </div>
        {actions && <div className="set-panel-head-actions">{actions}</div>}
      </div>
      <div className="set-panel-body">{children}</div>
    </section>
  )
}

/** Labelled on/off switch with a one-line explanation of what it does. */
export function Toggle({ label, sub, checked, onChange, disabled = false }) {
  return (
    <div className="set-toggle">
      <div className="set-toggle-text">
        <div className="set-toggle-label">{label}</div>
        <div className="set-toggle-sub">{sub}</div>
      </div>
      <label className="switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-slider" />
      </label>
    </div>
  )
}

/** Number input with a trailing unit chip (days, /hr, min…). */
export function UnitInput({ value, onChange, suffix, min, step, disabled = false }) {
  return (
    <div className="set-unit">
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
      <span className="set-unit-suffix">{suffix}</span>
    </div>
  )
}

/** One flood-depth threshold (metres) in a labelled field. */
export function ThresholdField({ label, value, onChange }) {
  return (
    <div className="set-field">
      <span>{label}</span>
      <UnitInput value={value} onChange={onChange} suffix="m" min="0" step="0.05" />
    </div>
  )
}

/**
 * Dirty-state bar: says whether there is anything to save and holds the
 * actions. Pass the buttons as children — each tab needs a different set
 * (Reset to Defaults, Send Test Alert, …) beside its Save.
 *
 * `flush` drops the frame for a bar sitting inside a panel body.
 */
export function SaveBar({
  dirty,
  dirtyText = 'You have unsaved changes.',
  cleanText = 'All changes saved.',
  flush = false,
  children,
}) {
  return (
    <div className={`set-savebar${flush ? ' set-savebar--flush' : ''}`}>
      <div className="set-savebar-note">
        <SparkIcon />
        <span>{dirty ? dirtyText : cleanText}</span>
      </div>
      <div className="set-savebar-actions">{children}</div>
    </div>
  )
}

/** The footnote strip every settings page closes with. */
export function SettingsNote({ children }) {
  return (
    <div className="mng-note">
      <SparkIcon />
      <span>{children}</span>
    </div>
  )
}

/** Section header used by each tab in place of its old page header. */
export function TabHead({ icon, title, sub, actions }) {
  return (
    <div className="mng-head">
      <div className="mng-head-titles">
        <div className="mng-head-icon">{icon}</div>
        <div>
          <div className="mng-title">{title}</div>
          <div className="mng-sub">{sub}</div>
        </div>
      </div>
      {actions}
    </div>
  )
}

/** The four-point spark used across every settings surface. */
export function SparkIcon() {
  return <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
}
