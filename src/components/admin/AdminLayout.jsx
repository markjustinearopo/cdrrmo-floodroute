import { useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import NotificationsPanel from './NotificationsPanel.jsx'
import AccountModal from './AccountModal.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import { Avatar } from '../Avatar.jsx'
import { authApi } from '../../services/api.js'
import { useLiveWeather, formatRain, formatWind } from '../../services/weather.js'
import { useFloodRisk, barangayRiskSamples } from './floodRisk.js'
import { useRealTimeSync } from '../../hooks/useRealTimeSync.js'
import { useSystemConfig, loadSystemConfigRemote } from '../../services/systemConfig.js'
import { useT } from '../../services/i18n.js'
import AutoAlertWatcher from './AutoAlertWatcher.jsx'
import './AdminLayout.css'

/**
 * Shared shell for every CDRRMO Admin page — alert banner, topbar (with a
 * live PHT clock) and the left navigation rail. Individual screens render
 * inside <main> via {children}.
 *
 * All live figures (rainfall, wind, risk summary) are placeholders here and
 * will be fed from the API/database once the backend is wired in.
 *
 * `mainClassName` lets a page opt out of the default padded, scrolling frame
 * (e.g. the Flood Map runs its content flush to the edges and fills the
 * viewport instead of scrolling).
 */

/* ── Sidebar definition (label · route · icon) ───────────────────────────── */
const NAV = [
  {
    section: 'Monitor',
    items: [
      { label: 'Dashboard', to: '/admin/dashboard', icon: DashboardIcon },
      { label: 'Flood Map', to: '/admin/flood-map', icon: MapIcon },
      { label: 'Flood-Prone Areas', to: '/admin/flood-areas', icon: DropIcon },
      { label: 'Hazard Layer', to: '/admin/hazard-layer', icon: LayersIcon },
      { label: 'Reports', to: '/admin/reports', icon: ReportIcon },
    ],
  },
  {
    section: 'Routing',
    items: [
      { label: 'Auto Route', to: '/admin/auto-route', icon: SparkIcon },
      { label: 'Road Status', to: '/admin/road-status', icon: ListIcon },
      { label: 'Route Planning', to: '/admin/route-planning', icon: TargetIcon },
      { label: 'Override Routes', to: '/admin/override-routes', icon: ShuffleIcon },
      { label: 'Saved Routes', to: '/admin/saved-routes', icon: BookmarkIcon },
    ],
  },
  {
    section: 'Manage',
    items: [
      { label: 'Alerts', to: '/admin/alerts', icon: BellIcon },
      { label: 'Barangay', to: '/admin/barangay', icon: UsersIcon },
      { label: 'Flood Reports', to: '/admin/flood-reports', icon: FloodReportIcon },
      { label: 'Incidents', to: '/admin/incidents', icon: TriangleIcon },
      { label: 'Evacuation', to: '/admin/evacuation', icon: HomeIcon },
    ],
  },
  {
    section: 'Settings',
    items: [
      { label: 'User Management', to: '/admin/users', icon: UserCogIcon },
      { label: 'System Configuration', to: '/admin/system-config', icon: SlidersIcon },
      { label: 'Permissions & Roles', to: '/admin/roles', icon: ShieldIcon },
      { label: 'API Integrations', to: '/admin/integrations', icon: PlugIcon },
      { label: 'Alert Settings', to: '/admin/alert-settings', icon: BellCogIcon },
    ],
  },
]

export default function AdminLayout({ children, mainClassName = '' }) {
  const navigate = useNavigate()
  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()
  const config = useSystemConfig()
  const t = useT()

  // Pull the shared system config once so identity / maintenance / thresholds
  // are correct on any device the operator signs in from.
  useEffect(() => { loadSystemConfigRemote() }, [])

  // System identity is operator-set on System Configuration and reflected in
  // the browser tab + topbar brand.
  useEffect(() => {
    document.title = `${config.systemName} · ${config.organization}`
  }, [config.systemName, config.organization])

  // Portal heartbeat: refresh the shared store every 5s + a live "updated Xs
  // ago" stamp. Staleness tints the chip (amber > 30s, red > 60s).
  const { lastUpdated, refresh, label: syncLabel } = useRealTimeSync(5000)
  const staleSecs = lastUpdated ? Math.round((Date.now() - lastUpdated) / 1000) : 0
  const syncTone = staleSecs > 60 ? 'stale' : staleSecs > 30 ? 'warn' : ''

  // Live flood picture (derived from the Open-Meteo flood × forecast risk field), shared
  // by the alert banner + status pill on every admin screen. The hazard map
  // always shows inherent susceptibility, but an ACTIVE alert is only raised
  // when there is real wetness (rain / elevated discharge) — so a dry day reads
  // "no active flood issue" even though the lowland barangays stay coloured.
  const flood = useMemo(() => {
    const wet = (field?.meta?.wetness ?? 0) >= 0.15
    const samples = barangayRiskSamples(field)
    const elevated = wet ? samples.filter((s) => s.level === 'high' || s.level === 'moderate') : []
    const high = wet ? samples.filter((s) => s.level === 'high') : []
    return {
      elevated: elevated.map((s) => s.name),
      worst: high.length ? 'high' : elevated.length ? 'moderate' : 'safe',
    }
  }, [field])

  const hasAlert = flood.elevated.length > 0
  const lvlClass = `lvl-${flood.worst}`
  const bannerText = hasAlert
    ? `${flood.elevated.slice(0, 4).join(', ')}${flood.elevated.length > 4 ? ` +${flood.elevated.length - 4} more` : ''} reporting elevated water levels.`
    : t('No active flood issue reported.')
  const pillText = hasAlert
    ? `Elevated flood risk: ${flood.elevated.slice(0, 3).join(', ')}${flood.elevated.length > 3 ? '…' : ''}`
    : t('No elevated flood risk reported.')
  const dotColor = flood.worst === 'high' ? '#ef4444' : flood.worst === 'moderate' ? '#f59e0b' : '#22c55e'

  const [clock, setClock] = useState('--:-- PHT')
  // Topbar overlays: 'notif' (notifications popup) | 'account' (profile/settings) | null
  const [menu, setMenu] = useState(null)
  const [accountTab, setAccountTab] = useState('profile')
  const [confirmSignout, setConfirmSignout] = useState(false)

  // Tint the page background only while an admin screen is mounted.
  useEffect(() => {
    document.body.classList.add('admin-body')
    return () => document.body.classList.remove('admin-body')
  }, [])

  // Live Philippine-time clock in the topbar.
  useEffect(() => {
    function tick() {
      // 12-hour clock (1–12 with AM/PM), Philippine time.
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

  return (
    <>
      {/* Automatic-alert engine (opt-in on Alert Settings) — no UI of its own. */}
      <AutoAlertWatcher field={field} />

      {/* ── Maintenance banner (System Configuration → Maintenance mode) ── */}
      {config.maintenance && (
        <div className="maint-banner" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z" />
          </svg>
          <span><b>{t('Maintenance mode is ON.')}</b> {t('The public-facing app is offline for updates — administrators keep full access.')}</span>
        </div>
      )}

      {/* ── Alert banner (live from the flood-risk field) ── */}
      <div className={`alert-banner ${lvlClass}`}>
        <svg viewBox="0 0 24 24">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="lbl">{hasAlert ? t('Flood Alert Active:') : t('Flood Status:')}</span>
        <span>{bannerText}</span>
      </div>

      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="logo-wrap">
          <div className="logo-shield">
            <img src="/cdrrmo-logo.png" alt="CDRRMO logo" />
          </div>
          <div className="logo-text">
            <strong>{config.systemName}</strong>
            <span>{config.organization} – {t('Command Center')}</span>
          </div>
        </div>

        <div className={`flood-pill ${lvlClass}`}>
          <div className="dot" style={{ background: dotColor }} />
          <span>{pillText}</span>
        </div>

        <div className="topbar-right">
          <div className="stat-chip" title="Live rainfall (Open-Meteo)">
            <svg viewBox="0 0 24 24">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            {t('Rainfall:')} <b>{formatRain(weather.current.rain)}</b>
          </div>
          <div className="stat-chip wind" title="Live wind (Open-Meteo)">
            <svg viewBox="0 0 24 24">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
            </svg>
            {t('Wind:')} <b>{formatWind(weather.current.windKmh)}</b>
          </div>
          <div className={`sync-chip ${syncTone}`} title="Live data refresh">
            <span className="sync-dot" />
            {t('Updated')} {syncLabel}
            <button
              type="button"
              className="sync-refresh"
              title="Refresh now"
              onClick={refresh}
              aria-label="Refresh data now"
            >
              <svg viewBox="0 0 24 24">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
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
            <Avatar initials="CA" />
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
        />
      )}

      {/* ── Body: sidebar + page content ── */}
      <div className="body-wrap">
        <aside className="sidebar">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="sidebar-section">{t(group.section)}</div>
              {group.items.map(({ label, to, icon: Icon }) => (
                <NavLink
                  key={label}
                  to={to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <Icon />
                  {t(label)}
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
              {t('Signout')}
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

/* ── Icons (inline SVG, ported from the static markup) ───────────────────── */
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
function DropIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  )
}
function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
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
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.7 1.9L21.5 17.5 19.7 18l-.7 1.9-.7-1.9L16.5 17.5l1.8-.6L19 15z" />
    </svg>
  )
}
function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
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
function TriangleIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  )
}
function FloodReportIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      <path d="M9 14c1 1 2 1 3 0s2-1 3 0" />
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
function UserCogIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <circle cx="19" cy="11" r="2" />
      <path d="M19 8v1M19 13v1M21.6 9.5l-.87.5M17.27 12l-.87.5M21.6 12.5l-.87-.5M17.27 11l-.87-.5" />
    </svg>
  )
}
function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  )
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}
function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}
function BellCogIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
