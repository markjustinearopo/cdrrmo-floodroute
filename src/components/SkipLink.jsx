import './skipLink.css'

/**
 * "Skip to main content" — the first thing in the tab order, visible only
 * once it has focus.
 *
 * Every portal puts the same sidebar before the page content. Without this, a
 * keyboard or screen-reader user has to tab through eight to eleven
 * navigation links to reach the actual screen — on EVERY page, every time.
 * For someone checking flood status across several barangays that is dozens
 * of keystrokes spent going nowhere.
 *
 * It targets #main-content, which the three layouts set on their <main>
 * along with tabIndex={-1} so the element can actually receive focus when
 * the link is followed (a plain anchor jump moves the viewport but leaves
 * focus behind, which is the usual reason skip links seem to "not work").
 */
export default function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      Skip to main content
    </a>
  )
}
