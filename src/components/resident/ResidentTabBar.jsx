import { NavLink } from 'react-router-dom'
import './residentTabBar.css'

/**
 * Bottom tab bar for the Resident portal — mobile only (hidden from 761px up,
 * where the sidebar rail is always on screen).
 *
 * WHY THIS EXISTS: a resident opening this during a flood is on a phone, one
 * handed, in a hurry. Behind the burger, every destination cost two taps and a
 * read of the whole drawer. The five things a citizen actually needs —
 * where am I at risk, show me the map, route me out, what has CDRRMO said, and
 * report what I can see — now sit permanently under the thumb.
 *
 * The drawer stays: it still holds the full nav (Road Status, Evacuation
 * centres, Evacuation Routing) for anyone who wants it. This is a fast path over
 * the top of it, not a replacement, so nothing becomes unreachable.
 */

const TABS = [
  { label: 'Home', to: '/resident/dashboard', icon: HomeIcon },
  { label: 'Map', to: '/resident/flood-map', icon: MapIcon },
  { label: 'Route', to: '/resident/evacuation-routing', icon: RouteIcon, accent: true },
  { label: 'Alerts', to: '/resident/alerts', icon: BellIcon },
  { label: 'Report', to: '/resident/flood-reports', icon: DropIcon },
]

export default function ResidentTabBar() {
  return (
    <nav className="res-tabbar" aria-label="Primary">
      {TABS.map(({ label, to, icon: Icon, accent }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `res-tab ${isActive ? 'active' : ''} ${accent ? 'accent' : ''}`.replace(/\s+/g, ' ').trim()
          }
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

/* ── Icons ─────────────────────────────────────────────────────────────── */
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}
function MapIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  )
}
function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function DropIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      <path d="M9 14c1 1 2 1 3 0s2-1 3 0" />
    </svg>
  )
}
