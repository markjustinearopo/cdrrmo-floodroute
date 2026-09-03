import { Component } from 'react'

/**
 * Stops one broken component from taking the whole app down.
 *
 * WHY THIS EXISTS
 * There was no error boundary anywhere in this product. React's default when
 * a render throws is to unmount the ENTIRE tree, so a fault in any single
 * component blanks the screen — and that was not theoretical: a coordinate
 * error inside LiveNavigation3D turned the resident's evacuation screen
 * completely white, mid-route, with the 2D map and the turn list that were
 * working perfectly taken down alongside it.
 *
 * A white screen during an evacuation is the worst failure this product has.
 * The 3D view is a nicety; the route underneath it is not.
 *
 * `fallback` renders instead of the children when something throws. Pass one
 * that degrades to the working thing (usually the 2D map) rather than an
 * apology — the reader needs the route, not an explanation.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // Logged, not swallowed: this should be findable afterwards.
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info)
    this.props.onError?.(error)
  }

  /* Let the parent clear the fault — e.g. the user switching back to 2D and
     then to 3D again should get a fresh attempt rather than a boundary that
     stays tripped for the rest of the session. */
  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}
