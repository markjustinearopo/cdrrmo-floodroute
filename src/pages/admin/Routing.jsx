import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import { ROUTE_TYPES, useCabuyaoRoads } from '../../components/admin/routingHelpers.jsx'
import { useRouteGraph } from '../../components/admin/routeEngine.js'
import { useFloodRiskAtScrub, NEUTRAL_FIELD } from '../../components/admin/floodRisk.js'
import { useLiveWeather, hourlyAt } from '../../services/weather.js'
import TimeScrubber, { ForecastBadge } from '../../components/admin/TimeScrubber.jsx'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import GenerateTab from '../../components/admin/routing/GenerateTab.jsx'
import DrawTab from '../../components/admin/routing/DrawTab.jsx'
import OverrideTab from '../../components/admin/routing/OverrideTab.jsx'
import SavedTab from '../../components/admin/routing/SavedTab.jsx'
import './AutoRoute.css'
import './RoutePlanning.css'
import './OverrideRoutes.css'
import './SavedRoutes.css'
import './Routing.css'

/**
 * CDRRMO Admin — Routing.
 *
 * One screen for every way of producing a route, replacing four sidebar
 * entries that all called the same flood-weighted A* and only disagreed about
 * what to name the button:
 *
 *   Generate — pick origin + destination, the engine solves      (was Auto Route)
 *   Draw     — click ordered stops by hand                       (was Route Planning)
 *   Override — replace a saved route's path, by hand or auto     (was Override Routes)
 *   Saved    — the one canonical library                         (was Saved Routes)
 *
 * The saved-route list was rendered three different ways across those pages;
 * all three mount points now use SavedRouteList, and the result/summary block
 * is RouteResultPanel. Road network, route graph and the live risk field are
 * loaded once here and handed to whichever tab is showing, so switching tabs
 * doesn't re-parse 4,853 ways.
 *
 * The active tab lives in the URL (?tab=draw) so links and refreshes work, and
 * the old four routes redirect onto the matching tab.
 */

const TABS = [
  { key: 'generate', label: 'Generate', Component: GenerateTab, hasTypes: true },
  { key: 'draw', label: 'Draw', Component: DrawTab, hasTypes: true },
  { key: 'override', label: 'Override', Component: OverrideTab, hasTypes: false },
  { key: 'saved', label: 'Saved', Component: SavedTab, hasTypes: false },
]

const DEFAULT_TAB = 'generate'

export default function Routing() {
  const [params, setParams] = useSearchParams()
  const [toast, setToast] = useState('')

  // Loaded once for the whole screen instead of once per former page.
  const { roads } = useCabuyaoRoads()
  const graph = useRouteGraph(roads)
  // The routing engine reads `live.riskAt` out of this, so pointing the
  // scrubber at 3 PM is what makes A* solve against 3 PM's hazard surface —
  // the route re-solves rather than the map merely re-colouring under it.
  const {
    field, baselineField, loading: fieldLoading, refresh: refreshField,
    forecast: isForecast, offset: hourOffset, projecting,
  } = useFloodRiskAtScrub()
  const { weather } = useLiveWeather()
  const [use3D, setUse3D] = use3DPreference()
  const [type, setType] = useState('evacuation')

  const live = field || NEUTRAL_FIELD

  const requested = params.get('tab')
  const active = TABS.some((t) => t.key === requested) ? requested : DEFAULT_TAB
  const { Component, hasTypes } = TABS.find((t) => t.key === active)

  // `replace` so tab-hopping doesn't bury the previous page under a pile of
  // history entries — Back should leave Routing, not walk the tabs.
  const goToTab = useCallback((key) => {
    setParams(key === DEFAULT_TAB ? {} : { tab: key }, { replace: true })
  }, [setParams])

  // One toast for the whole screen: only one tab is mounted at a time.
  const flash = useCallback((msg) => {
    setToast(msg)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setToast(''), 2400)
  }, [])

  const shared = useMemo(
    () => ({
      roads, graph, live, baselineField, fieldLoading, refreshField, use3D, type, setType,
      isForecast, hourOffset, forecastHour: hourlyAt(weather, hourOffset),
    }),
    [roads, graph, live, baselineField, fieldLoading, refreshField, use3D, type, isForecast, hourOffset, weather],
  )

  return (
    <AdminLayout mainClassName="main--flush">
      <div className="rt-shell">
        {/* ── Toolbar: tabs + the controls that apply across them ── */}
        <div className="rt-toolbar">
          <div className="rt-title">
            <RouteIcon />
            <span>Routing</span>
          </div>

          <nav className="rt-tabs" role="tablist" aria-label="Routing modes">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active === t.key}
                className={`rt-tab ${active === t.key ? 'active' : ''}`}
                onClick={() => goToTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Trip type is shared by the tabs that author a route; Override
              inherits the type of the route it is editing, and Saved just
              lists them, so neither shows the picker. */}
          {hasTypes && (
            <div className="rt-type-seg">
              {Object.entries(ROUTE_TYPES).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  className={`rt-type ${type === key ? 'active' : ''}`}
                  style={type === key ? { '--seg': t.color } : undefined}
                  onClick={() => setType(key)}
                >
                  <span className="rt-type-dot" style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="rt-toolbar-end">
            {/* 3D is only wired on Generate — the other tabs are 2D editors. */}
            {active === 'generate' && <MapViewToggle value={use3D} onChange={setUse3D} />}
          </div>
        </div>

        {/* Keying on the tab drops the previous tab's draft instead of leaking
            a half-drawn route into the next one. */}
        <div className={`rt-tabpanel ${isForecast ? 'forecast-frame' : ''}`}>
          {isForecast && <ForecastBadge hour={hourlyAt(weather, hourOffset)} offset={hourOffset} />}
          <Component key={active} shared={shared} onToast={flash} onGoToTab={goToTab} />
        </div>

        {/* Only the tabs that actually solve a route follow the clock; Saved is
            a library of past decisions, so scrubbing it would mean nothing. */}
        {active !== 'saved' && <TimeScrubber weather={weather} projecting={projecting} />}

        <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
      </div>
    </AdminLayout>
  )
}

function RouteIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  )
}
