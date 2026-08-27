import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AdminLayout from '../../components/admin/AdminLayout.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ReportBuilder from '../../components/admin/report/ReportBuilder.jsx'
import ReportDocument from '../../components/admin/report/ReportDocument.jsx'
import {
  PRESETS, clearDraft, defaultSpec, deleteTemplate, loadDraft, loadTemplates,
  migrate, saveDraft, saveTemplate, sheetPx,
} from '../../components/admin/report/reportSpec.js'
import { levelFromDepth } from '../../components/admin/mapHelpers.jsx'
import { useFloodRisk, barangayRiskSamples } from '../../components/admin/floodRisk.js'
import { getCabuyaoRoads, useRoadStatus } from '../../components/admin/routingHelpers.jsx'
import {
  useFloodAreas, useEvacCenters, useAlerts, useIncidents, useRoadReports, nowLabel,
} from '../../context/AdminDataContext.jsx'
import { barangayAt } from '../../data/cabuyaoBarangays.js'
import { depthMeters, formatMeters } from '../../services/depth.js'
import './Reports.css'

/**
 * CDRRMO Admin — Reports.
 *
 * A document editor, not a form. The left rail arranges the report — which
 * blocks appear, in what order, which columns each table shows, how it is
 * filtered, and how the paper is set up — while every word in the document is
 * edited by clicking it on the page. The two never overlap, which is what
 * keeps a screen with this much power readable.
 *
 * What comes out is an LGU document: Republic-of-the-Philippines letterhead,
 * a bordered reference block, numbered sections, a sharp vector situation map
 * and real signature lines. It prints through the browser's Save-as-PDF, and
 * the on-screen page is the exact width of the chosen sheet so nothing shifts
 * between the preview and the print dialog.
 */
export default function Reports() {
  /* One-tap SITREP: /admin/reports?sitrep=1 skips the builder entirely and goes
     straight to the print dialog with the full situation report and the whole
     city in scope — which is exactly what a SITREP is. */
  const [params] = useSearchParams()
  const autoSitrep = params.get('sitrep') === '1'

  const { field } = useFloodRisk()
  const { floodAreas } = useFloodAreas()
  const { evacuationCenters } = useEvacCenters()
  const { alerts } = useAlerts()
  const { incidents } = useIncidents()
  const { roadReports } = useRoadReports()
  const [roadStatus] = useRoadStatus()
  const roadNetwork = useMemo(() => getCabuyaoRoads(), [])
  const samples = useMemo(() => barangayRiskSamples(field), [field])

  /* The spec IS the report. A SITREP link always starts from the standard
     document; otherwise pick up wherever the officer left off. */
  const [spec, setSpec] = useState(() => (
    autoSitrep ? PRESETS[0].build() : (loadDraft() || defaultSpec())
  ))
  const [templates, setTemplates] = useState(() => loadTemplates())
  const [editing, setEditing] = useState(true)
  const [generatedAt, setGeneratedAt] = useState(() => nowLabel())
  const [confirm, setConfirm] = useState(null)
  const [flash, setFlash] = useState('')
  const [fitWidth, setFitWidth] = useState(true)
  const [stageW, setStageW] = useState(0)
  const stageRef = useRef(null)

  /* A landscape A4 sheet is 1122px wide; a laptop leaves well under that once
     the nav rail and the builder have taken their share. Rather than shrink
     the paper permanently (the preview would stop being the printed page) the
     sheet is ZOOMED to fit, which reflows rather than transforms — so text
     stays crisp and the print rules can simply reset it to 1. */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => setStageW(entry.contentRect.width))
    ro.observe(el)
    setStageW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* Auto-save the working draft. An officer who wanders off to check a road
     status should not come back to a blank report. A SITREP link is a
     throwaway render, so it deliberately does not overwrite that draft. */
  useEffect(() => {
    if (!autoSitrep) saveDraft(spec)
  }, [spec, autoSitrep])

  useEffect(() => {
    if (!flash) return undefined
    const id = window.setTimeout(() => setFlash(''), 2600)
    return () => window.clearTimeout(id)
  }, [flash])

  /* Fire the print dialog once, and only after the live feeds have answered —
     printing an empty situation map would be worse than useless. The extra
     frame lets the SVG map paint before the dialog freezes it. */
  const printedRef = useRef(false)
  useEffect(() => {
    if (!autoSitrep || printedRef.current || !field) return undefined
    // The latch is set INSIDE the timer, not before it. React double-invokes
    // effects in development: arming it up front meant the first pass set the
    // latch and its cleanup cancelled the only timer, so the dialog never
    // opened at all.
    const id = window.setTimeout(() => {
      if (printedRef.current) return
      printedRef.current = true
      window.print()
    }, 700)
    return () => window.clearTimeout(id)
  }, [autoSitrep, field])

  /* ── Spec editing ─────────────────────────────────────────────────────── */
  /* `patch` may be a plain object or a function of the current spec — the
     latter for anything derived from what is already there, such as toggling a
     barangay in and out of the coverage. */
  const update = useCallback((patch) => setSpec((s) => ({
    ...s, ...(typeof patch === 'function' ? patch(s) : patch),
  })), [])
  const updateBlock = useCallback((id, patch) => setSpec((s) => ({
    ...s, blocks: s.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  })), [])
  /* The nested objects — page, letterhead, a block's options — each get their
     own updater that merges against the CURRENT state rather than whatever the
     caller last rendered with. Spreading a prop instead (`{...page, ...patch}`)
     silently loses every update but the last whenever two land in one batch. */
  const updatePage = useCallback((patch) => setSpec((s) => ({
    ...s, page: { ...s.page, ...patch },
  })), [])
  const updateLetterhead = useCallback((patch) => setSpec((s) => ({
    ...s, letterhead: { ...s.letterhead, ...patch },
  })), [])
  /* `patch` may be a function of the block's current options, which is how a
     toggle inside options.columns stays safe at any click speed. */
  const updateOpts = useCallback((id, patch) => setSpec((s) => ({
    ...s,
    blocks: s.blocks.map((b) => (b.id === id
      ? { ...b, opts: { ...b.opts, ...(typeof patch === 'function' ? patch(b.opts) : patch) } }
      : b)),
  })), [])
  const updateMeta = useCallback((id, patch) => setSpec((s) => ({
    ...s, meta: s.meta.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  })), [])
  const setBlocks = useCallback((blocks) => setSpec((s) => ({ ...s, blocks })), [])
  const setMetaList = useCallback((meta) => setSpec((s) => ({ ...s, meta })), [])

  /* Loading a template throws away whatever is on the page, so it asks first —
     unless the report is still the untouched default. */
  const replaceSpec = (next, message) => {
    setSpec(migrate(next))
    setFlash(message)
  }
  const confirmReplace = (title, message, run) => setConfirm({
    title, message, confirmLabel: 'Replace', tone: 'default', onConfirm: run,
  })

  const handlePreset = (preset) => confirmReplace(
    `Start from “${preset.name}”?`,
    'This replaces the report currently on the page, including any wording you have typed.',
    () => replaceSpec(preset.build(), `Loaded ${preset.name}`),
  )
  const handleLoadTemplate = (tpl) => confirmReplace(
    `Load “${tpl.name}”?`,
    'This replaces the report currently on the page, including any wording you have typed.',
    () => replaceSpec(tpl.spec, `Loaded ${tpl.name}`),
  )
  const handleSaveTemplate = (name) => {
    setTemplates(saveTemplate(name, spec))
    setFlash(`Saved “${name}”`)
  }
  const handleDeleteTemplate = (tpl) => setConfirm({
    title: `Delete “${tpl.name}”?`,
    message: 'The saved template is removed from this browser. Reports already printed are unaffected.',
    confirmLabel: 'Delete',
    tone: 'danger',
    onConfirm: () => { setTemplates(deleteTemplate(tpl.id)); setFlash('Template deleted') },
  })
  const handleReset = () => confirmReplace(
    'Reset the report?',
    'Everything goes back to the default full situation report. Saved templates are kept.',
    () => { clearDraft(); replaceSpec(defaultSpec(), 'Reset to the default report') },
  )

  /* Stamp the generation time at the moment the officer exports, not whenever
     the page happened to mount. */
  const handlePrint = () => {
    setGeneratedAt(nowLabel())
    window.requestAnimationFrame(() => window.setTimeout(() => window.print(), 80))
  }

  /* ── Scoped datasets ──────────────────────────────────────────────────── */
  const scope = spec.scope
  const scopeKey = scope.join('|')

  const inScope = useCallback(
    (b) => scope.length === 0 || scope.includes(b),
    [scopeKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const fAreas = useMemo(() => floodAreas.filter((a) => inScope(a.barangay)), [floodAreas, inScope])
  const evac = useMemo(() => evacuationCenters.filter((c) => inScope(c.barangay)), [evacuationCenters, inScope])
  const activeAlerts = useMemo(
    () => alerts.filter((a) => a.status === 'active' && (scope.length === 0 || inScope(a.barangay) || a.barangay === 'All')),
    [alerts, inScope, scope.length],
  )
  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved' && inScope(i.barangay)),
    [incidents, inScope],
  )
  const scopedSamples = useMemo(() => samples.filter((b) => inScope(b.name)), [samples, inScope])

  /* Flagged roads → drawable lines + table rows. The barangay comes from the
     report when an officer typed one, and is otherwise resolved from the
     segment's midpoint, which is what lets a road table be scoped and carry a
     Barangay column at all. */
  const roadLines = useMemo(() => {
    if (!roadNetwork) return []
    const byId = new Map(roadNetwork.features.map((f) => [String(f.properties.id), f]))
    const reportByWay = new Map(roadReports.filter((r) => r.wayId != null).map((r) => [String(r.wayId), r]))
    return Object.entries(roadStatus)
      .map(([id, status]) => {
        const f = byId.get(String(id))
        if (!f) return null
        const report = reportByWay.get(String(id))
        const latlngs = f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
        const mid = latlngs[Math.floor(latlngs.length / 2)] || latlngs[0]
        const barangay = report?.barangay || (mid ? barangayAt(mid[0], mid[1]) : '') || ''
        return {
          id,
          status,
          name: report?.name || f.properties.name || 'Unnamed road',
          barangay,
          depthFt: report?.depthFt,
          reason: report?.reason || '',
          updated: report?.updated || '',
          latlngs,
        }
      })
      .filter(Boolean)
      .filter((r) => scope.length === 0 || !r.barangay || scope.includes(r.barangay))
  }, [roadNetwork, roadStatus, roadReports, scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Everything the document needs, in one bundle ─────────────────────── */
  const data = useMemo(() => {
    const deepestM = Math.max(0, ...fAreas.map((a) => depthMeters(a) || 0))
    const deepestLabel = formatMeters(deepestM) || '—'
    const capacity = evac.reduce((n, c) => n + (Number(c.capacity) || 0), 0)
    const occupancy = evac.reduce((n, c) => n + (Number(c.occupancy) || 0), 0)

    /* Per-barangay tallies for the risk table's optional count columns. */
    const tally = (list, key) => list.reduce((m, row) => {
      const b = row[key]
      if (b) m[b] = (m[b] || 0) + 1
      return m
    }, {})
    const areaBy = tally(fAreas, 'barangay')
    const roadBy = tally(roadLines, 'barangay')
    const evacBy = tally(evac, 'barangay')

    return {
      generatedAt,
      scopeLabel: scope.length === 0
        ? 'City-wide — all 18 barangays'
        : `${scope.length} barangay${scope.length > 1 ? 's' : ''}: ${scope.join(', ')}`,
      floodAreas: fAreas,
      evac,
      alerts: activeAlerts,
      incidents: openIncidents,
      roadLines,
      samples: scopedSamples.map((b) => ({
        ...b,
        areaCount: areaBy[b.name] || 0,
        roadCount: roadBy[b.name] || 0,
        evacCount: evacBy[b.name] || 0,
      })),
      deepestLabel,
      stats: {
        floodAreas: fAreas.length,
        roadsClosed: roadLines.filter((r) => r.status === 'blocked').length,
        roadsFlooded: roadLines.filter((r) => r.status === 'flooded').length,
        evacOpen: evac.filter((c) => c.status !== 'closed').length,
        evacCapacity: capacity.toLocaleString(),
        evacOccupancy: occupancy.toLocaleString(),
        alerts: activeAlerts.length,
        incidents: openIncidents.length,
        highRisk: scopedSamples.filter((b) => levelFromDepth(b.floodDepth) === 'high').length,
        deepest: deepestLabel,
      },
    }
  }, [fAreas, evac, activeAlerts, openIncidents, roadLines, scopedSamples, generatedAt, scopeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = spec.blocks.filter((b) => b.on).length
  const sheetWidth = sheetPx(spec.page).totalPx
  const zoom = fitWidth && stageW > 0 && sheetWidth > stageW
    ? Math.max(0.45, Math.floor((stageW / sheetWidth) * 100) / 100)
    : 1

  return (
    <AdminLayout>
      <div className="reports">
        <ReportBuilder
          spec={spec}
          templates={templates}
          editing={editing}
          onChange={update}
          onPageChange={updatePage}
          onLetterheadChange={updateLetterhead}
          onBlockChange={updateBlock}
          onOptsChange={updateOpts}
          onMetaChange={updateMeta}
          onBlocksChange={setBlocks}
          onMetaListChange={setMetaList}
          onLoadPreset={handlePreset}
          onLoadTemplate={handleLoadTemplate}
          onSaveTemplate={handleSaveTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onReset={handleReset}
          onToggleEditing={setEditing}
          onPrint={handlePrint}
        />

        <div className="report-stage" ref={stageRef}>
          <div className="report-sheetbar">
            <span className="rs-chip">{spec.page.paper === 'letter' ? 'Letter' : 'A4'}</span>
            <span className="rs-chip">{spec.page.orientation === 'landscape' ? 'Landscape' : 'Portrait'}</span>
            <span className="rs-sep" />
            <span className="rs-meta">{activeCount} block{activeCount === 1 ? '' : 's'}</span>
            <span className="rs-sep" />
            <span className={`rs-mode ${editing ? 'edit' : ''}`}>
              {editing ? 'Click any text to edit it' : 'Preview — text locked'}
            </span>
            <div className="rs-zoom">
              <button type="button" className={fitWidth ? 'on' : ''} onClick={() => setFitWidth(true)}>
                Fit{zoom < 1 ? ` ${Math.round(zoom * 100)}%` : ''}
              </button>
              <button type="button" className={fitWidth ? '' : 'on'} onClick={() => setFitWidth(false)}>
                Actual size
              </button>
            </div>
          </div>

          <div className="report-sheet">
            <ReportDocument
              spec={spec}
              data={data}
              editing={editing}
              zoom={zoom}
              onChange={update}
              onLetterheadChange={updateLetterhead}
              onBlockChange={updateBlock}
              onOptsChange={updateOpts}
              onMetaChange={updateMeta}
            />
          </div>
        </div>

        {flash && <div className="report-flash" role="status">{flash}</div>}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          tone={confirm.tone}
          onConfirm={() => { confirm.onConfirm(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </AdminLayout>
  )
}
