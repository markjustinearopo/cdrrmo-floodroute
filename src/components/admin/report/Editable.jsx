import { useEffect, useRef } from 'react'

/* ============================================================
   Click-to-edit text, straight on the document.

   The whole point of the rebuilt report screen is that the WORDS are edited
   where they appear, not in a form beside the page. So every piece of prose in
   the document — titles, reference values, section headings, paragraphs,
   signatory names — is one of these.

   It is deliberately UNCONTROLLED. A contentEditable node driven by React on
   every keystroke fights the browser's caret and drops the cursor to the end
   of the text mid-word; instead the DOM owns the text while the field has
   focus, and the value is committed on blur (or Enter, for single-line
   fields). The effect only writes back when the field is NOT focused, which is
   how an external change — loading a template, resetting — still lands.
   ============================================================ */

/* contentEditable sprays non-breaking spaces around as you type; left in, they
   survive into the PDF as odd unbreakable gaps. */
const NBSP = / /g

export default function Editable({
  value,
  onChange,
  placeholder = '',
  as: Tag = 'div',
  className = '',
  multiline = false,
  disabled = false,
}) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || document.activeElement === el) return
    const next = value || ''
    if (el.textContent !== next) el.textContent = next
  }, [value])

  const commit = () => {
    const el = ref.current
    if (!el) return
    // Multiline blocks keep their line breaks; single-line ones collapse to
    // one clean run of text so a stray paste cannot break the letterhead.
    const text = multiline
      ? el.innerText.replace(NBSP, ' ').trimEnd()
      : el.textContent.replace(NBSP, ' ').replace(/\s+/g, ' ').trim()
    if (text !== (value || '')) onChange(text)
    el.textContent = text
  }

  return (
    <Tag
      ref={ref}
      className={`rd-edit ${className}`.trim()}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck={false}
      role={disabled ? undefined : 'textbox'}
      tabIndex={disabled ? undefined : 0}
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.currentTarget.blur(); return }
        if (!multiline && e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      onPaste={(e) => {
        // Paste as plain text — a copy out of Word otherwise drags its own
        // fonts and colours onto the page.
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, multiline ? text : text.replace(/\s+/g, ' '))
      }}
    />
  )
}
