import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import RoadConditionModal from '../../components/admin/RoadConditionModal.jsx'
import { BarangayDetailCard } from '../../components/admin/BarangayDetailCard.jsx'
import { useLiveWeather, formatRain } from '../../services/weather.js'
import { useFloodRisk, barangayRiskSamples, estDepthFromRisk } from '../../components/admin/floodRisk.js'
import {
  useCabuyaoRoads,
  useRoadStatus,
  RoadNetworkLayer,
  ROAD_STATUS,
} from '../../components/admin/routingHelpers.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock } from '../../components/admin/mapHelpers.jsx'
import { useAlerts, useIncidents, useRoadReports } from '../../context/AdminDataContext.jsx'
import { levelFromDepth } from '../../services/systemConfig.js'
import { useT } from '../../services/i18n.js'
import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import './Dashboard.css'

/**
 * CDRRMO Admin — Dashboard.
 *
 * The command-center home: live stat cards, an animated rainfall-trend chart,
 * a city flood-risk gauge and a 3D barangay-risk skyline, over the shared
 * live feeds (Open-Meteo model + the AdminData store). Risk classes are graded
 * by the operator's configurable thresholds via the systemConfig service.
 */

// The 18 official barangays of Cabuyao City (alphabetical).
const BARANGAYS = [
  'Baclaran', 'Banay-Banay', 'Banlic', 'Bigaa', 'Butong', 'Casile',
  'Diezmo', 'Gulod', 'Mamatid', 'Marinig', 'Niugan', 'Pittland',
  'Poblacion Dos', 'Poblacion Tres', 'Poblacion Uno', 'Pulo', 'Sala',
  'San Isidro',
]

const ALERT_LEVELS = [
  { value: 'high', label: 'High' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'safe', label: 'Safe / All Clear' },
]

const ALERT_LEVEL_LABEL = { high: 'HIGH', moderate: 'MODERATE', safe: 'SAFE / ALL CLEAR' }

// Risk class is graded by `levelFromDepth` from the shared systemConfig service,
// so the operator's System Configuration thresholds drive every badge and bar.
// Depth (m) that fills the risk bar to 100% — anything deeper stays capped.
const DEPTH_FULL_BAR = 0.6

// Colour per risk class — shared by the charts, gauge and 3D skyline below.
const LEVEL_COLOR = { high: '#dc2626', moderate: '#f97316', low: '#eab308', safe: '#22c55e' }

const RISK_FILTERS = [
  { key: 'high', label: 'High', cls: 'hi' },
  { key: 'moderate', label: 'Moderate', cls: 'mod' },
  { key: 'low', label: 'Low', cls: 'low' },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const t = useT()

  // ── Live feeds ──
  const { weather } = useLiveWeather()
  const { field } = useFloodRisk()
  const { roads: roadNetwork } = useCabuyaoRoads()
  const [roadStatus, { setStatus }] = useRoadStatus()

  // ── Shared store ──
  const { alerts, addAlert, resolveAlert } = useAlerts()
  const { incidents } = useIncidents()
  const { roadReports, reportRoad, removeRoadReport } = useRoadReports()

  // Each barangay's flood depth is derived live from the Open-Meteo flood ×
  // forecast risk field sampled at its location (model estimate, not a sensor reading).
  const barangays = useMemo(() => barangayRiskSamples(field), [field])

  const [riskFilter, setRiskFilter] = useState('all')
  // Which modal is open: 'hazard' (hazard alert) | null
  const [modal, setModal] = useState(null)
  // Active brush for clicking roads on the map: 'flooded' | 'blocked' (Closed).
  const [roadBrush, setRoadBrush] = useState('flooded')
  const [toast, setToast] = useState({ msg: '', tone: '' })
  // Drill-down state: the clicked alert / barangay / road, plus the shared
  // "are you sure?" prompt used before every destructive change.
  const [alertDetail, setAlertDetail] = useState(null) // alert id
  const [brgyDetail, setBrgyDetail] = useState(null) // barangay name
  const [roadEdit, setRoadEdit] = useState(null) // road for the condition modal
  const [confirm, setConfirm] = useState(null) // { title, message, confirmLabel, onConfirm }
  // Brief full-screen red pulse when a HIGH alert goes out.
  const [flash, setFlash] = useState(false)

  // Only active alerts surface on the dashboard feed (scheduled/resolved hide).
  const activeAlertList = useMemo(
    () => alerts.filter((a) => a.status === 'active'),
    [alerts],
  )

  // Way-id → persisted report (depth in feet + note) for modal prefill.
  const reportByWay = useMemo(() => {
    const m = new Map()
    roadReports.forEach((r) => { if (r.wayId != null) m.set(String(r.wayId), r) })
    return m
  }, [roadReports])

  // Roads flagged on Road Status (painted map) + the admin's named road reports
  // from the modal below, resolved to names + nearest barangay + live depth.
  const flaggedRoads = useMemo(() => {
    if (!roadNetwork) return []
    const byId = new Map(roadNetwork.features.map((f) => [String(f.properties.id), f]))
    const rows = Object.entries(roadStatus).map(([id, status]) => {
      const f = byId.get(String(id))
      const geo = f?.geometry?.coordinates
      const mid = geo ? geo[Math.floor(geo.length / 2)] : null // [lng, lat]
      const pt = mid ? [mid[1], mid[0]] : null
      const report = reportByWay.get(String(id))
      const depth = report?.depth != null
        ? Number(report.depth)
        : (pt && field ? estDepthFromRisk(field.riskAt(pt[0], pt[1])) : 0)
      return {
        id,
        status, // 'flooded' | 'blocked'
        name: report?.name || f?.properties?.name || `Road #${id}`,
        barangay: report?.barangay || (pt ? barangayForPoint(pt[0], pt[1]) : '—'),
        depth,
        updated: report?.updated || 'Live',
      }
    })
    // Named reports that aren't tied to a mapped way (free-text road name).
    // Every report shows here — including ones logged as "Passable" — so an
    // admin always gets visible confirmation that their report was recorded.
    roadReports
      .filter((r) => r.wayId == null)
      .forEach((r) => rows.push({
        id: r.id,
        status: r.status === 'closed' ? 'blocked' : r.status === 'passable' ? 'passable' : 'flooded',
        name: r.name,
        barangay: r.barangay,
        depth: Number(r.depth) || 0,
        updated: r.updated,
      }))
    return rows.sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name))
  }, [roadNetwork, roadStatus, roadReports, reportByWay, field])

  // ── Derived figures ──
  const activeAlerts = activeAlertList.length
  const blockedRoads = flaggedRoads.filter((r) => r.status === 'blocked').length
  const rainfall = weather.current.rain
  const rainHistory = weather.rainHistory
  const incidentCount = incidents.filter((i) => i.status !== 'resolved').length

  // Real hour-over-hour rainfall trend from the live 8-hour history — the only
  // stat with genuine history behind it, so the only one that shows a delta.
  const rainDelta = useMemo(() => {
    if (!Array.isArray(rainHistory) || rainHistory.length < 2) return null
    const d = rainHistory[rainHistory.length - 1] - rainHistory[rainHistory.length - 2]
    if (Math.abs(d) < 0.05) return { dir: 'flat', text: 'steady' }
    return d > 0
      ? { dir: 'up', text: `▲ +${d.toFixed(1)}` }
      : { dir: 'down', text: `▼ ${d.toFixed(1)}` }
  }, [rainHistory])

  const riskCounts = useMemo(() => {
    const high = barangays.filter((b) => levelFromDepth(b.floodDepth) === 'high').length
    const moderate = barangays.filter((b) => levelFromDepth(b.floodDepth) === 'moderate').length
    const low = barangays.filter((b) => levelFromDepth(b.floodDepth) === 'low').length
    const safe = Math.max(0, barangays.length - high - moderate - low)
    const affected = high + moderate
    return { high, moderate, low, safe, affected }
  }, [barangays])

  // Barangays ordered by depth for the 3D risk skyline (deepest → shallowest).
  const skyline = useMemo(
    () => [...barangays].sort((a, b) => b.floodDepth - a.floodDepth),
    [barangays],
  )

  const sortedBarangays = useMemo(() => {
    return [...barangays]
      .filter((b) => riskFilter === 'all' || levelFromDepth(b.floodDepth) === riskFilter)
      .sort((a, b) => b.floodDepth - a.floodDepth || a.name.localeCompare(b.name))
  }, [barangays, riskFilter])

  const detailAlert = useMemo(
    () => (alertDetail ? alerts.find((a) => a.id === alertDetail) || null : null),
    [alerts, alertDetail],
  )
  const brgySample = useMemo(
    () => (brgyDetail ? barangays.find((b) => b.name === brgyDetail) || null : null),
    [barangays, brgyDetail],
  )

  const toastTimer = useRef(null)
  function flashToast(msg, tone = '') {
    clearTimeout(toastTimer.current)
    setToast({ msg, tone })
    toastTimer.current = setTimeout(() => setToast({ msg: '', tone: '' }), tone === 'high' ? 3600 : 2600)
  }

  function handleHazardSubmit(e) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const alert = addAlert({
      title: f.get('title').trim(),
      barangay: f.get('barangay'),
      level: f.get('level'),
      message: f.get('message').trim(),
    })
    setModal(null)
    if (alert.level === 'high') {
      // Escalated feedback for a HIGH alert: red toast + a brief screen pulse.
      setFlash(true)
      setTimeout(() => setFlash(false), 1100)
      flashToast(`🚨 HIGH alert issued for ${alert.barangay}.`, 'high')
    } else {
      flashToast(`Alert issued for ${alert.barangay}.`)
    }
  }

  // Click-to-flag on the dashboard map: opens the SAME road-condition editor
  // as the Road Status page (status + depth in feet + reason), pre-set to the
  // active brush — flagging always captures the "why", never a silent flip.
  function paintRoad(props) {
    const existing = reportByWay.get(String(props.id))
    const f = roadNetwork?.features.find((x) => String(x.properties.id) === String(props.id))
    const geo = f?.geometry?.coordinates
    const mid = geo ? geo[Math.floor(geo.length / 2)] : null // [lng, lat]
    setRoadEdit({
      wayId: props.id,
      name: props.name || existing?.name || `Road #${props.id}`,
      barangay: existing?.barangay || (mid ? barangayForPoint(mid[1], mid[0]) : ''),
      status: roadStatus[props.id] || roadBrush,
      depthFt: existing?.depthFt ?? '',
      reason: existing?.reason || '',
    })
  }

  // Persist a road condition from the modal. reportRoad writes the shared
  // store (localStorage + Supabase), so the change reflects on every map —
  // Flood Map, Road Status, routing — for all users.
  function saveRoadCondition(data) {
    if (data.status === 'open') {
      const existing = reportByWay.get(String(data.wayId))
      if (existing) removeRoadReport(existing.id)
      else setStatus(data.wayId, 'open')
      flashToast(`${data.name} set passable.`)
    } else {
      reportRoad({
        wayId: data.wayId,
        name: data.name,
        barangay: data.barangay,
        status: data.status === 'blocked' ? 'closed' : 'caution',
        depthFt: data.depthFt === '' ? undefined : Math.max(0, Number(data.depthFt)),
        reason: data.reason,
        reportedBy: 'CDRRMO',
      })
      const closed = data.status === 'blocked'
      flashToast(`${data.name} marked ${closed ? 'closed' : 'flooded'}.`, closed ? 'high' : '')
    }
    setRoadEdit(null)
  }

  // Clear a road row (after confirmation): lift the painted flag if it's a
  // mapped way, or withdraw the saved report if it's a free-text one.
  function clearRoad(row) {
    setConfirm({
      title: `Clear ${row.name}?`,
      message: 'This road returns to Passable on every map — admin, barangay and resident.',
      confirmLabel: 'Clear road',
      onConfirm: () => {
        const report = roadReports.find((r) => r.id === row.id || String(r.wayId) === String(row.id))
        if (report) removeRoadReport(report.id)
        else setStatus(row.id, 'open')
        setConfirm(null)
        flashToast(`Cleared ${row.name}.`)
      },
    })
  }

  function resolveAlertConfirmed(alert) {
    setConfirm({
      title: 'Resolve this alert?',
      message: `"${alert.title}" (${alert.barangay}) will be marked resolved and leave the active feed on every portal.`,
      confirmLabel: 'Resolve alert',
      onConfirm: () => {
        resolveAlert(alert.id)
        setConfirm(null)
        setAlertDetail(null)
        flashToast('Alert resolved.')
      },
    })
  }

  return (
    <AdminLayout>
      {/* ── Stat cards ── */}
      <div className="stat-cards">
        <StatCard color="yellow" icon={<BellIcon />} value={activeAlerts} label={t('Active Alerts')} />
        <StatCard color="red" icon={<BarIcon />} value={blockedRoads} label={t('Blocked Roads')} />
        <StatCard color="green" icon={<TriangleIcon />} value={incidentCount} label={t('Incidents')} />
        <StatCard
          color="blue"
          icon={<RainIcon />}
          value={typeof rainfall === 'number' ? rainfall : null}
          format={formatRain}
          label={t('Current Rainfall')}
          delta={rainDelta}
          spark={rainHistory}
        />
      </div>

      {/* ── Live insight strip: rainfall trend · risk gauge · 3D skyline ──
          One dense row so the top of the dashboard reads at a glance. */}
      <div className="viz-strip">
        <div className="section-card viz-card viz-rain">
          <div className="viz-hdr">
            <span className="viz-hdr-title"><RainIcon />{t('Rainfall Trend')}</span>
            <span className="viz-now-chip">{t('Now')} <b>{formatRain(rainfall)}</b></span>
          </div>
          <RainfallChart data={rainHistory} />
        </div>

        <div className="section-card viz-card viz-gauge">
          <div className="viz-hdr">
            <span className="viz-hdr-title"><GaugeIcon />{t('City Flood Risk')}</span>
          </div>
          <RiskGauge counts={riskCounts} total={barangays.length} />
        </div>

        <div className="section-card viz-card viz-sky">
          <div className="viz-hdr">
            <span className="viz-hdr-title"><CubeIcon />{t('Barangay Risk Skyline')}</span>
            <span className="viz-badge" title="Model estimate, not sensor readings">3D · {t('Live')}</span>
          </div>
          <RiskSkyline barangays={skyline} onSelect={setBrgyDetail} />
        </div>
      </div>

      {/* ── Flood Insight filter — sits right above the lists it filters ── */}
      <div className="insight-bar">
        <span className="insight-label">{t('Flood Insight :')}</span>
        <span className="insight-chip blue">{riskCounts.affected} {t('Barangays affected')}</span>
        <span className="insight-chip red">{barangays.length} {t('Barangays')}</span>
        {RISK_FILTERS.map((f) => (
          <span
            key={f.key}
            className={`insight-chip ${f.cls} filter-btn ${riskFilter === f.key ? 'active' : ''}`}
            onClick={() => setRiskFilter(f.key)}
          >
            {riskCounts[f.key]} {t(f.label)}
          </span>
        ))}
        <span className="insight-chip clear" onClick={() => setRiskFilter('all')}>
          {t('Clear Filter')}
        </span>
      </div>

      {/* ── Two column: Alerts + Barangay status ── */}
      <div className="two-col">
        {/* Active Hazard Alerts */}
        <div className="section-card">
          <div className="section-hdr">
            <div className="section-hdr-left">
              <BellIcon />
              <div>
                <div className="section-title">{t('Active Hazard Alerts')}</div>
                <div className="section-sub">{t('Real-time alert feed · click an alert for details')}</div>
              </div>
            </div>
            <button className="btn-issue" onClick={() => setModal('hazard')}>
              <PlusIcon />
              {t('Issue Alert')}
            </button>
          </div>
          <div className="alert-list">
            {activeAlertList.length === 0 ? (
              <div className="empty-state">{t('No active alerts.')}</div>
            ) : (
              activeAlertList.map((a) => (
                <div
                  className={`alert-item sev-${a.level}`}
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setAlertDetail(a.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setAlertDetail(a.id) }}
                >
                  <div className={`alert-stripe ${a.level}`} />
                  <div className="alert-body">
                    <div className="alert-title-row">
                      <span className="alert-name">
                        {a.level === 'high' && <SirenIcon />}
                        {a.title}
                      </span>
                      <span className="alert-time">{a.issued}</span>
                    </div>
                    <div className="alert-desc">{a.barangay} — {a.message}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            className="view-all-link"
            onClick={() => navigate('/admin/alerts')}
          >
            {t('View All Alerts')}
          </button>
        </div>

        {/* Barangay Flood Status */}
        <div className="section-card">
          <div className="section-hdr">
            <div className="section-hdr-left">
              <HomeIcon />
              <div>
                <div className="section-title">{t('Barangay Flood Status')}</div>
                <div className="section-sub">
                  {t('Current monitoring · All {n} Barangays · click one for its profile', { n: barangays.length })}
                </div>
              </div>
            </div>
            <span
              className="section-badge"
              title="Depths are model estimates driven by the live Open-Meteo forecast + flood feeds — not sensor readings."
            >
              {t('Live · Open-Meteo model')}
            </span>
          </div>

          <div className="brgy-list">
            {sortedBarangays.map((b) => {
              const level = levelFromDepth(b.floodDepth)
              const label = level.toUpperCase()
              const fill = Math.min(100, (b.floodDepth / DEPTH_FULL_BAR) * 100)
              return (
                <div
                  className="brgy-item brgy-item--click"
                  key={b.name}
                  role="button"
                  tabIndex={0}
                  title={`Est. flood depth: ~${b.floodDepth.toFixed(2)} m — click for the full profile`}
                  onClick={() => setBrgyDetail(b.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setBrgyDetail(b.name) }}
                >
                  <span className="brgy-name">{b.name}</span>
                  <div className="brgy-bar-track">
                    <div className={`brgy-bar-fill ${level}`} style={{ width: `${fill}%` }} />
                  </div>
                  <span className={`risk-badge ${level}`}>{label}</span>
                </div>
              )
            })}
          </div>
          <div className="brgy-model-note">
            {t('Depths are model estimates (Open-Meteo + terrain), not sensor readings.')}
          </div>

          <button
            type="button"
            className="view-all-link"
            onClick={() => navigate('/admin/barangay')}
          >
            {t('View All Barangays')}
          </button>
        </div>
      </div>

      {/* ── Road Status: interactive 2D map + flagged-roads list ── */}
      <div className="section-card road-card">
        <div className="section-hdr">
          <div className="section-hdr-left">
            <ListIcon />
            <div>
              <div className="section-title">{t('Road Status')}</div>
              <div className="section-sub">{t('Click a road on the map to flag it')}</div>
            </div>
          </div>
          <div className="road-hdr-actions">
            <div className="road-brushes">
              <span className="road-brush-label">{t('Tag as')}</span>
              <button
                type="button"
                className={`road-brush flooded ${roadBrush === 'flooded' ? 'active' : ''}`}
                onClick={() => setRoadBrush('flooded')}
              >
                <span className="road-brush-dot" />
                {t('Flooded')}
              </button>
              <button
                type="button"
                className={`road-brush blocked ${roadBrush === 'blocked' ? 'active' : ''}`}
                onClick={() => setRoadBrush('blocked')}
              >
                <span className="road-brush-dot" />
                {t('Closed')}
              </button>
            </div>
            <button
              type="button"
              className="btn-soft-sm"
              onClick={() => navigate('/admin/road-status')}
            >
              {t('Open Road Status')}
              <ArrowIcon />
            </button>
          </div>
        </div>

        <div className="road-card-body">
          {/* Interactive 2D map — scroll zooms while hovering, page scrolls
              otherwise; click a road to flag it on every map. */}
          <div className="road-map">
            <span className="road-map-badge">2D View</span>
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              scrollWheelZoom
              className="road-map-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.85} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              {roadNetwork && (
                <RoadNetworkLayer roads={roadNetwork} statusMap={roadStatus} onPick={paintRoad} interactive />
              )}
            </MapContainer>
            <div className="road-map-hint">
              {t('Click a road to mark it')}{' '}
              <b style={{ color: ROAD_STATUS[roadBrush].swatch }}>
                {roadBrush === 'blocked' ? t('Closed') : t('Flooded')}
              </b>
            </div>
            <div className="road-map-legend">
              <span><i style={{ background: ROAD_STATUS.flooded.swatch }} /> {t('Flooded')}</span>
              <span><i style={{ background: ROAD_STATUS.blocked.swatch }} /> {t('Closed')}</span>
              <span><i style={{ background: ROAD_STATUS.open.swatch }} /> {t('Passable')}</span>
            </div>
          </div>

          {/* Flagged roads — clicking a road on the map adds it here */}
          <div className="road-list">
            <div className="road-list-head">
              <span>{t('Flagged Roads')}</span>
              <span className="road-list-count">{flaggedRoads.length}</span>
            </div>
            <div className="road-list-scroll">
              {flaggedRoads.length === 0 ? (
                <div className="empty-state">{t('No roads flagged yet. Click a road on the map.')}</div>
              ) : (
                flaggedRoads.map((r) => {
                  const badge = r.status === 'blocked'
                    ? { cls: 'closed', label: 'CLOSED' }
                    : r.status === 'passable'
                      ? { cls: 'passable', label: 'PASSABLE' }
                      : { cls: 'caution', label: 'FLOODED' }
                  return (
                    <div className="road-list-item" key={r.id}>
                      <div className="road-list-main">
                        <span className="road-list-name" title={r.name}>{r.name}</span>
                        <span className="road-list-brgy">{r.barangay} · {r.depth.toFixed(2)} m · {r.updated}</span>
                      </div>
                      <span className={`road-status-badge ${badge.cls}`}>{badge.label}</span>
                      <button
                        type="button"
                        className="road-clear-btn"
                        title="Clear this road"
                        onClick={() => clearRoad(r)}
                      >
                        Clear
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hazard Alert modal (Active Hazard Alerts feed) ── */}
      {modal === 'hazard' && (
        <div className="dash-modal-overlay" onMouseDown={() => setModal(null)}>
          <div
            className="issue-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Issue Hazard Alert"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <div className="section-title">Issue Hazard Alert</div>
                <div className="section-sub">
                  Broadcast a flood hazard warning to a barangay
                </div>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setModal(null)}
                aria-label="Close hazard form"
              >
                ×
              </button>
            </div>

            <form className="issue-form" onSubmit={handleHazardSubmit}>
              <div className="form-grid">
                <label>
                  Barangay
                  <select name="barangay" required defaultValue="">
                    <option value="" disabled>
                      Select Barangay
                    </option>
                    {BARANGAYS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Alert Level
                  <select name="level" required defaultValue="high">
                    {ALERT_LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Alert Title
                <input name="title" type="text" placeholder="Severe Flood Warning" required />
              </label>

              <label>
                Hazard Description
                <textarea
                  name="message"
                  rows={3}
                  placeholder="Describe the hazard, affected areas, and evacuation advice."
                  required
                />
              </label>

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  type="button"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="btn-issue" type="submit">
                  Issue Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Alert detail modal (opened by clicking a feed row) ── */}
      {detailAlert && (
        <div className="dash-modal-overlay" onMouseDown={() => setAlertDetail(null)}>
          <div
            className={`issue-modal alert-detail sev-${detailAlert.level}`}
            role="dialog"
            aria-modal="true"
            aria-label={`Alert: ${detailAlert.title}`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="alert-detail-head">
                {detailAlert.level === 'high' && <SirenIcon />}
                <div>
                  <div className="section-title">{detailAlert.title}</div>
                  <div className="section-sub">Issued {detailAlert.issued}</div>
                </div>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setAlertDetail(null)}
                aria-label="Close alert detail"
              >
                ×
              </button>
            </div>

            <div className="alert-detail-body">
              <div className="alert-detail-row">
                <span className={`alert-level-badge ${detailAlert.level}`}>
                  {ALERT_LEVEL_LABEL[detailAlert.level] || detailAlert.level}
                </span>
                <span className="alert-detail-brgy">Barangay {detailAlert.barangay}</span>
              </div>
              {detailAlert.message && <p className="alert-detail-msg">{detailAlert.message}</p>}

              <div className="modal-actions">
                <button
                  className="btn-cancel"
                  type="button"
                  onClick={() => { setAlertDetail(null); navigate('/admin/alerts') }}
                >
                  Open Alerts Screen
                </button>
                <button
                  className="btn-issue"
                  type="button"
                  onClick={() => resolveAlertConfirmed(detailAlert)}
                >
                  Resolve Alert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Barangay profile modal (reuses the map pages' detail card) ── */}
      {brgySample && (
        <div className="dash-modal-overlay" onMouseDown={() => setBrgyDetail(null)}>
          <div className="dash-bdc-wrap" onMouseDown={(e) => e.stopPropagation()}>
            <BarangayDetailCard sample={brgySample} onClose={() => setBrgyDetail(null)} />
          </div>
        </div>
      )}

      {/* ── Road condition editor (click-to-flag) ── */}
      {roadEdit && (
        <RoadConditionModal
          road={roadEdit}
          onClose={() => setRoadEdit(null)}
          onSave={saveRoadCondition}
        />
      )}

      {/* ── Shared confirmation for destructive actions ── */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── HIGH-alert screen pulse + severity-aware toast ── */}
      {flash && <div className="dash-flash" aria-hidden="true" />}
      <div className={`toast ${toast.msg ? 'show' : ''} ${toast.tone === 'high' ? 'toast--high' : ''}`}>
        {toast.msg}
      </div>
    </AdminLayout>
  )
}

/* ── Count-up animation for the stat numbers ─────────────────────────────── */
function useCountUp(value, duration = 700) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(0) // animate up from zero on first load
  useEffect(() => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      setDisplay(value)
      return undefined
    }
    const from = typeof fromRef.current === 'number' ? fromRef.current : 0
    if (from === value) {
      setDisplay(value)
      return undefined
    }
    let raf
    const t0 = performance.now()
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - (1 - p) ** 3
      setDisplay(from + (value - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      fromRef.current = value
    }
  }, [value, duration])
  return display
}

/* ── Rainfall trend — animated SVG area chart ──────────────────────────────
   A smooth (Catmull-Rom) area curve over the live 8-hour rain history, with a
   gradient fill, a stroke that draws itself in on mount, faint gridlines and a
   pulsing "now" marker. Purely presentational; the data is the same live feed
   the stat-card sparkline uses. */
function RainfallChart({ data }) {
  const series = Array.isArray(data) && data.length ? data : Array(8).fill(0)
  const W = 520
  const H = 116
  const PAD = { l: 6, r: 6, t: 12, b: 8 }
  const max = Math.max(...series, 1)
  const n = series.length
  const peakIdx = series.indexOf(Math.max(...series))
  const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(n - 1, 1)
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const pts = series.map((v, i) => [x(i), y(v)])

  // Catmull-Rom → cubic Bézier for a smooth line without external libs.
  const line = smoothPath(pts)
  const area = `${line} L ${x(n - 1)} ${H - PAD.b} L ${x(0)} ${H - PAD.b} Z`
  const last = pts[pts.length - 1]

  return (
    <div className="rain-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Rainfall over the last 8 hours">
        <defs>
          <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rainStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.33, 0.66].map((g) => (
          <line key={g} className="rc-grid" x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * g} y2={PAD.t + (H - PAD.t - PAD.b) * g} />
        ))}
        {/* area + animated line (re-keys on data so the draw-in replays on change) */}
        <path key={`a-${max}-${n}`} className="rc-area" d={area} fill="url(#rainFill)" />
        <path key={`l-${max}-${series.join(',')}`} className="rc-line" d={line} stroke="url(#rainStroke)" />
        {/* data dots (peak called out) */}
        {pts.map(([cx, cy], i) => (
          series[i] > 0 && i !== pts.length - 1 ? (
            <circle key={i} className={`rc-dot ${i === peakIdx ? 'peak' : ''}`} cx={cx} cy={cy} r={i === peakIdx ? 3 : 1.8} />
          ) : null
        ))}
        {/* now marker */}
        <circle className="rc-now-halo" cx={last[0]} cy={last[1]} r="7" />
        <circle className="rc-now" cx={last[0]} cy={last[1]} r="3.2" />
      </svg>
    </div>
  )
}

/** Smooth an array of [x,y] points into an SVG path (Catmull-Rom → Bézier). */
function smoothPath(p) {
  if (p.length < 2) return ''
  let d = `M ${p[0][0]} ${p[0][1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i]
    const p1 = p[i]
    const p2 = p[i + 1]
    const p3 = p[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`
  }
  return d
}

/* ── City flood-risk gauge — animated concentric ring ──────────────────────
   The four risk classes as a stacked donut that grows its arcs on mount, with
   the dominant class called out in the centre. */
function RiskGauge({ counts, total }) {
  const t = useT()
  const R = 46
  const C = 2 * Math.PI * R
  const order = [
    ['high', counts.high], ['moderate', counts.moderate], ['low', counts.low], ['safe', counts.safe],
  ]
  const denom = Math.max(total, 1)
  let offset = 0
  const arcs = order.map(([key, v]) => {
    const len = (v / denom) * C
    const seg = { key, v, len, dashoffset: -offset }
    offset += len
    return seg
  })
  const worst = counts.high ? 'high' : counts.moderate ? 'moderate' : counts.low ? 'low' : 'safe'
  const worstLabel = { high: t('High'), moderate: t('Moderate'), low: t('Low'), safe: t('Safe') }[worst]
  const affected = counts.high + counts.moderate

  return (
    <div className="risk-gauge">
      <svg viewBox="0 0 120 120" className="rg-svg">
        <defs>
          <filter id="rgGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="60" cy="60" r={R} className="rg-track" />
        <g filter="url(#rgGlow)">
          {arcs.map((s) => (
            <circle
              key={s.key}
              cx="60" cy="60" r={R}
              className="rg-arc"
              stroke={LEVEL_COLOR[s.key]}
              strokeDasharray={`${s.len.toFixed(2)} ${(C - s.len).toFixed(2)}`}
              strokeDashoffset={s.dashoffset.toFixed(2)}
              style={{ opacity: s.v > 0 ? 1 : 0 }}
            />
          ))}
        </g>
        <text x="60" y="56" className="rg-center-num" fill={LEVEL_COLOR[worst]}>{affected}</text>
        <text x="60" y="72" className="rg-center-sub">{t('Barangays affected')}</text>
      </svg>
      <div className="rg-legend">
        {order.map(([key, v]) => (
          <div className={`rg-legend-row ${v > 0 ? '' : 'zero'}`} key={key}>
            <span className="rg-dot" style={{ background: LEVEL_COLOR[key] }} />
            <span className="rg-legend-lbl">{t(key[0].toUpperCase() + key.slice(1))}</span>
            <span className="rg-legend-val">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── 3D barangay risk skyline — CSS-transform isometric towers ─────────────
   A tilted plane of 18 "towers" (one per barangay), height ∝ modeled flood
   depth, colour by risk class, gently auto-orbiting. Hovering a tower lifts it
   and reveals its name + depth; clicking opens the barangay profile. Pure CSS
   3D (no map token needed), so it always renders. Honours reduced-motion. */
function RiskSkyline({ barangays, onSelect }) {
  const t = useT()
  const max = Math.max(0.6, ...barangays.map((b) => b.floodDepth))
  return (
    <div className="skyline-stage">
      <div className="skyline-floor">
        {barangays.map((b, i) => {
          const level = levelFromDepth(b.floodDepth)
          const h = 10 + Math.round((b.floodDepth / max) * 62) // 10–72px
          return (
            <button
              type="button"
              key={b.name}
              className={`sky-tower ${level}`}
              style={{ '--h': `${h}px`, '--d': `${i * 35}ms` }}
              onClick={() => onSelect(b.name)}
              title={`${b.name} · ~${b.floodDepth.toFixed(2)} m`}
            >
              <span className="sky-label">
                <b>{b.name}</b>
                <em>~{b.floodDepth.toFixed(2)} m</em>
              </span>
            </button>
          )
        })}
      </div>
      <div className="skyline-legend">
        {['high', 'moderate', 'low', 'safe'].map((k) => (
          <span key={k}><i style={{ background: LEVEL_COLOR[k] }} />{t(k[0].toUpperCase() + k.slice(1))}</span>
        ))}
      </div>
    </div>
  )
}

/* ── Stat card ── */
function StatCard({ color, icon, value, label, format, delta, spark }) {
  const animated = useCountUp(value)
  const shown = format
    ? format(typeof animated === 'number' ? animated : value)
    : typeof animated === 'number'
      ? Math.round(animated).toLocaleString()
      : value
  const maxSpark = Array.isArray(spark) ? Math.max(...spark, 1) : 1
  return (
    <div className="stat-card">
      <div className={`stat-card-top-bar ${color}`} />
      <div className="stat-card-header">
        <div className={`stat-card-icon ${color}`}>{icon}</div>
        {delta && (
          <span className={`stat-delta ${delta.dir}`} title="vs previous hour (Open-Meteo)">
            {delta.text}
          </span>
        )}
      </div>
      <div className="stat-num">{shown}</div>
      {Array.isArray(spark) && spark.length > 0 && (
        <div className="stat-spark" title="Rainfall, last 8 hours (mm/hr)">
          {spark.map((v, i) => (
            <span
              key={i}
              className={i === spark.length - 1 ? 'on' : ''}
              style={{ height: v > 0 ? `${Math.max(14, (v / maxSpark) * 100)}%` : '3px' }}
            />
          ))}
        </div>
      )}
      <div className="stat-lbl">{label}</div>
    </div>
  )
}

/* ── Icons ── */
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M12 3a9 9 0 0 0-9 9 9 9 0 0 0 2.6 6.3" />
      <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-2.6 6.3" />
      <line x1="13.4" y1="10.6" x2="17" y2="7" />
    </svg>
  )
}
function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}
function BarIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
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
function RainIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="16" y1="13" x2="16" y2="21" />
      <line x1="8" y1="13" x2="8" y2="21" />
      <line x1="12" y1="15" x2="12" y2="23" />
      <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25" />
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}
function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}
function SirenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="alert-siren" aria-label="High alert">
      <path d="M6 18h12v-5a6 6 0 0 0-12 0z" />
      <line x1="4" y1="21" x2="20" y2="21" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="4.5" y1="5" x2="6" y2="6.5" />
      <line x1="19.5" y1="5" x2="18" y2="6.5" />
    </svg>
  )
}
function ListIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#C0181B"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
