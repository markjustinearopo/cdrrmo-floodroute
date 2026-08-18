import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import GeneralTab from '../../components/admin/settings/GeneralTab.jsx'
import UsersTab from '../../components/admin/settings/UsersTab.jsx'
import BarangaysTab from '../../components/admin/settings/BarangaysTab.jsx'
import AlertsTab from '../../components/admin/settings/AlertsTab.jsx'
import IntegrationsTab from '../../components/admin/settings/IntegrationsTab.jsx'
import './Manage.css'
import './Settings.css'

/**
 * CDRRMO Admin — Settings.
 *
 * One screen for everything that configures the system, replacing the five
 * separate sidebar entries (System Configuration, User Management,
 * Permissions & Roles, Alert Settings, API Integrations) plus the Barangay
 * roster that used to sit under Manage. Each tab is the old page's body,
 * unchanged in behaviour — same save handlers, same remote loaders, same CSV
 * importer and permission matrix — just rendered here instead of on its own
 * route.
 *
 * The active tab lives in the URL (?tab=alerts) so a link, a bookmark or a
 * refresh lands where the operator expects, and the old routes redirect onto
 * the matching tab.
 */

const TABS = [
  { key: 'general', label: 'General', Component: GeneralTab },
  { key: 'users', label: 'Users & Access', Component: UsersTab },
  { key: 'barangays', label: 'Barangays', Component: BarangaysTab },
  { key: 'alerts', label: 'Alerts', Component: AlertsTab },
  { key: 'integrations', label: 'Integrations', Component: IntegrationsTab },
]

const DEFAULT_TAB = 'general'

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const [toast, setToast] = useState('')

  const requested = params.get('tab')
  const active = TABS.some((t) => t.key === requested) ? requested : DEFAULT_TAB
  const { Component } = TABS.find((t) => t.key === active)

  // `replace` so tab-hopping doesn't bury the previous page under a pile of
  // history entries — Back should leave Settings, not walk the tabs.
  const goToTab = useCallback((key) => {
    setParams(key === DEFAULT_TAB ? {} : { tab: key }, { replace: true })
  }, [setParams])

  // One toast for the whole screen: only one tab is mounted at a time, so the
  // tabs report through here instead of each keeping its own copy.
  const flash = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2600)
  }, [])

  return (
    <AdminLayout>
      <div className="set-tabbar">
        <div className="set-tabbar-title">Settings</div>
        <nav className="set-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              className={`set-tab ${active === t.key ? 'active' : ''}`}
              onClick={() => goToTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Keying on the tab drops the previous tab's state instead of leaking a
          half-edited form into the next one. */}
      <Component key={active} onToast={flash} onGoToTab={goToTab} />

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </AdminLayout>
  )
}
