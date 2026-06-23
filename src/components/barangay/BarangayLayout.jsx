import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import NotificationsPanel from '../admin/NotificationsPanel.jsx'
import AccountModal from '../admin/AccountModal.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { Avatar } from '../Avatar.jsx'
import { officialBarangayLabel } from '../../data/barangay.js'
import { authApi } from '../../services/api.js'
import { useLiveWeather, formatRain, formatWind } from '../../services/weather.js'
import '../admin/AdminLayout.css'

/**
 * Shared shell for every CDRRMO Barangay Official screen — alert banner,
 * topbar (live PHT clock) and the left navigation rail. It deliberately reuses
 * the admin shell stylesheet and the same topbar overlays (notifications,
 * account) so the two portals are visually one system; only the sidebar, the
 * identity and the jurisdiction scope differ.
 *
 * A Barangay Official sees their OWN barangay: the Manage / Routing screens act
 * on that jurisdiction, while the Monitor screens keep the city-wide context.
 *
 * Rainfall + wind in the topbar are LIVE (Open-Meteo via useLiveWeather), the
 * same feed the admin shell uses; the risk-summary banner is still static.
 *
 * `mainClassName` lets a page opt out of the default padded, scrolling frame
 * (e.g. the full-bleed map screens fill the viewport instead of scrolling).
 */

/* ── Sidebar definition (label · route · icon) ───────────────────────────── */
const NAV = [
  {
    section: 'Monitor',
    items: [
      { label: 'Dashboard', to: '/barangay/dashboard', icon: DashboardIcon },
      { label: 'Flood Map', to: '/barangay/flood-map', icon: MapIcon },
      { label: 'Hazard Layer', to: '/barangay/hazard-layer', icon: LayersIcon },
    ],
  },
  {
    section: 'Routing',
    items: [
      { label: 'Road Status', to: '/barangay/road-status', icon: RoadIcon },
      { label: 'Evacuation Routing', to: '/barangay/evacuation-routing', icon: TargetIcon },
    ],
  },
  {
    section: 'Manage',
    items: [
      { label: 'Alerts', to: '/barangay/alerts', icon: BellIcon },
      { label: 'Incidents', to: '/barangay/incidents', icon: TriangleIcon },
      { label: 'Evacuation', to: '/barangay/evacuation', icon: HomeIcon },
      { label: 'Barangay Operations', to: '/barangay/operations', icon: UsersIcon },
    ],
  },
]

export default function BarangayLayout({ children, mainClassName = '' }) {
  const navigate = useNavigate()
  const { weather } = useLiveWeather()
  const [clock, setClock] = useState('--:-- PHT')
  // Topbar overlays: 'notif' (notifications popup) | 'account' (profile/settings) | null
  const [menu, setMenu] = useState(null)
  const [accountTab, setAccountTab] = useState('profile')
  const [confirmSignout, setConfirmSignout] = useState(false)

  const brgyLabel = officialBarangayLabel()

  // Tint the page background only while a barangay screen is mounted (the same
  // tint the admin shell uses — the body class is shared).
  useEffect(() => {
    document.body.classList.add('admin-body')
    return () => document.body.classList.remove('admin-body')
  }, [])

  // Live Philippine-time clock in the topbar.
  useEffect(() => {
    function tick() {
      const t = new Date().toLocaleTimeString('en-PH', {
        hour12: true,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Manila',
      })
      setClock(`${t} PHT`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  function handleSignout(e) {
    e.preventDefault()
    setConfirmSignout(true)
  }

  function confirmSignoutNow() {
    setConfirmSignout(false)
    authApi.logout() // actually clear the session token + cached user
    navigate('/login')
  }

  const identity = {
    name: 'Barangay Official',
    role: `Brgy. ${brgyLabel} — Operations Center`,
    initials: 'BO',
    idLabel: 'Staff ID',
  }

  return (
    <>
      {/* ── Alert banner ── */}
      <div className="alert-banner">
        <svg viewBox="0 0 24 24">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="lbl">Flood Alert Active:</span>
        <span>No active flood issue reported in Brgy. {brgyLabel}.</span>
      </div>

      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="logo-wrap">
          <div className="logo-shield">
            <img src="/cdrrmo-logo.png" alt="CDRRMO logo" />
          </div>
          <div className="logo-text">
            <strong>CDRRMO FloodRoute</strong>
            <span>Brgy. {brgyLabel} – Operations Center</span>
          </div>
        </div>

        <div className="flood-pill">
          <div className="dot" />
          <span>No elevated flood risk reported.</span>
        </div>

        <div className="topbar-right">
          <div className="stat-chip">
            <svg viewBox="0 0 24 24">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Rainfall: <b>{formatRain(weather.current.rain)}</b>
          </div>
          <div className="stat-chip wind">
            <svg viewBox="0 0 24 24">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
            </svg>
            Wind: <b>{formatWind(weather.current.windKmh)}</b>
          </div>
          <div className="time-chip">{clock}</div>
          <button
            type="button"
            className={`icon-btn ${menu === 'notif' ? 'active' : ''}`}
            title="Notifications"
            onClick={() => setMenu(menu === 'notif' ? null : 'notif')}
          >
            <svg viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Settings"
            onClick={() => {
              setAccountTab('settings')
              setMenu('account')
            }}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            className="avatar"
            title="Account"
            onClick={() => {
              setAccountTab('profile')
              setMenu('account')
            }}
          >
            <Avatar initials="BO" />
          </button>
        </div>
      </div>

      {/* Topbar overlays */}
      {menu === 'notif' && <NotificationsPanel onClose={() => setMenu(null)} />}
      {menu === 'account' && (
        <AccountModal
          tab={accountTab}
          onTabChange={setAccountTab}
          onClose={() => setMenu(null)}
          identity={identity}
        />
      )}

      {/* ── Body: sidebar + page content ── */}
      <div className="body-wrap">
        <aside className="sidebar">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="sidebar-section">{group.section}</div>
              {group.items.map(({ label, to, icon: Icon }) => (
                <NavLink
                  key={label}
                  to={to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}

          <div className="signout">
            <a className="nav-item" href="/login" onClick={handleSignout}>
              <svg viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Signout
            </a>
          </div>
        </aside>

        <main className={`main ${mainClassName}`.trim()}>{children}</main>
      </div>

      {confirmSignout && (
        <ConfirmDialog
          title="Sign out?"
          tone="default"
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          icon={(
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          )}
          message={<>You'll be returned to the login screen and your session will end.</>}
          onConfirm={confirmSignoutNow}
          onCancel={() => setConfirmSignout(false)}
        />
      )}
    </>
  )
}

/* ── Icons (inline SVG, matching the admin sidebar style) ────────────────── */
function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
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
function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}
function RoadIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 21L8 3" />
      <path d="M20 21L16 3" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <line x1="12" y1="11" x2="12" y2="14" />
      <line x1="12" y1="17" x2="12" y2="20" />
    </svg>
  )
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
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
function TriangleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  )
}
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}
