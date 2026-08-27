import { Fragment } from 'react'
import Editable from './Editable.jsx'
import ReportMap from './ReportMap.jsx'
import { RISK_META, levelFromDepth } from '../mapHelpers.jsx'
import { ROAD_STATUS } from '../routingHelpers.jsx'
import { COLUMN_CATALOGUE, STAT_CATALOGUE, TABLE_BLOCKS, sheetPx } from './reportSpec.js'
import {
  FLOOD_SEVERITY_META, FLOOD_TYPE_LABEL, floodSeverity, formatFloodDepth,
} from '../../../data/floodAreas.js'
import { depthMeters } from '../../../services/depth.js'

/* ============================================================
   The document itself — and the only thing that prints.

   It renders the spec: letterhead, reference block, then whatever blocks are
   switched on, in the order the officer put them. Every run of prose is an
   <Editable>, so the page IS the editor; the builder panel beside it only
   handles structure, data and paper setup.
   ============================================================ */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']

/* Order used whenever a table sorts by "worst first". */
const LEVEL_RANK = { high: 3, moderate: 2, low: 1, safe: 0 }
const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }

export default function ReportDocument({
  spec, data, editing, zoom = 1,
  onChange, onLetterheadChange, onBlockChange, onOptsChange, onMetaChange,
}) {
  const { page } = spec
  const { contentPx, padPx, marginMm } = sheetPx(page)

  const visible = spec.blocks.filter((b) => b.on)
  // Numbering runs over the content sections only: a page break is furniture
  // and a signature block is not a numbered part of the report.
  let counter = 0
  const numberOf = (b) => {
    if (b.type === 'pagebreak' || b.type === 'signatories') return ''
    counter += 1
    if (page.numbering === 'none') return ''
    if (page.numbering === 'numeric') return `${counter}.`
    return `${ROMAN[counter - 1] || counter}.`
  }

  return (
    <>
      {/* The print sheet has to match what is on screen, so the rule is written
          from the spec rather than fixed in the stylesheet. */}
      <style>{`@page { size: ${page.paper === 'letter' ? 'Letter' : 'A4'} ${page.orientation}; margin: ${marginMm}mm; }`}</style>

      <article
        id="report-doc"
        className={`report-doc tf-${page.typeface} dn-${page.density} ac-${page.accent}${editing ? ' is-editing' : ''}`}
        style={{ '--doc-w': `${contentPx}px`, '--doc-pad': `${padPx}px`, zoom }}
      >
        {spec.showClassification && (
          <div className="rd-class">
            <Editable
              value={spec.classification}
              onChange={(v) => onChange({ classification: v })}
              placeholder="Classification"
              disabled={!editing}
            />
          </div>
        )}

        {spec.letterhead.show && (
          <header className="rd-letterhead">
            {spec.letterhead.logo && (
              <img className="rd-seal" src="/cdrrmo-logo.png" alt="" />
            )}
            <div className="rd-lh-text">
              <Editable className="rd-lh-1" value={spec.letterhead.line1} placeholder="Republic of the Philippines" disabled={!editing}
                onChange={(v) => onLetterheadChange({ line1: v })} />
              <Editable className="rd-lh-1" value={spec.letterhead.line2} placeholder="Province" disabled={!editing}
                onChange={(v) => onLetterheadChange({ line2: v })} />
              <Editable className="rd-lh-2" value={spec.letterhead.line3} placeholder="City" disabled={!editing}
                onChange={(v) => onLetterheadChange({ line3: v })} />
              <Editable className="rd-lh-3" value={spec.letterhead.office} placeholder="Office" disabled={!editing}
                onChange={(v) => onLetterheadChange({ office: v })} />
              <Editable className="rd-lh-4" value={spec.letterhead.address} placeholder="Office address" disabled={!editing}
                onChange={(v) => onLetterheadChange({ address: v })} />
            </div>
            {spec.letterhead.logo && <div className="rd-seal-spacer" aria-hidden="true" />}
          </header>
        )}

        <div className="rd-rule" />

        <div className="rd-titleblock">
          <Editable as="h1" className="rd-title" value={spec.title} placeholder="Report title" disabled={!editing}
            onChange={(v) => onChange({ title: v })} />
          {(spec.subtitle || editing) && (
            <Editable className="rd-subtitle" value={spec.subtitle} placeholder="Subtitle (optional)" disabled={!editing}
              onChange={(v) => onChange({ subtitle: v })} />
          )}
        </div>

        <MetaTable spec={spec} data={data} editing={editing} onMetaChange={onMetaChange} />

        {visible.map((b) => (
          <Fragment key={b.id}>
            {b.type === 'pagebreak'
              ? <div className="rd-pagebreak"><span>Page break</span></div>
              : (
                <Block
                  block={b}
                  number={numberOf(b)}
                  spec={spec}
                  data={data}
                  editing={editing}
                  onBlockChange={onBlockChange}
                  onOptsChange={onOptsChange}
                />
              )}
          </Fragment>
        ))}

        {spec.showFooter && (
          <footer className="rd-footer">
            <Editable className="rd-foot-note" multiline value={spec.footerNote}
              placeholder="Closing note / disclaimer" disabled={!editing}
              onChange={(v) => onChange({ footerNote: v })} />
            <div className="rd-foot-meta">
              {spec.letterhead.office} · Generated {data.generatedAt} PHT
            </div>
          </footer>
        )}
      </article>
    </>
  )
}

/* ── Reference block ──────────────────────────────────────────────────────
   The bordered two-column grid every LGU document opens with. Rows are part
   of the spec, so an officer can add "Weather Source" or "Data As Of" and it
   prints like it was always there. */
function MetaTable({ spec, data, editing, onMetaChange }) {
  const rows = spec.meta.filter((m) => m.on)
  if (rows.length === 0) return null
  const autoValue = (row) => {
    if (row.auto === 'generated') return `${data.generatedAt} PHT`
    if (row.auto === 'scope') return data.scopeLabel
    return null
  }
  return (
    <dl className="rd-meta">
      {rows.map((row) => {
        const auto = autoValue(row)
        return (
          <div className="rd-meta-row" key={row.id}>
            <dt>
              <Editable value={row.label} placeholder="Label" disabled={!editing}
                onChange={(v) => onMetaChange(row.id, { label: v })} />
            </dt>
            <dd>
              {auto !== null
                ? <span className="rd-meta-auto">{auto}</span>
                : (
                  <Editable value={row.value} placeholder="—" disabled={!editing}
                    onChange={(v) => onMetaChange(row.id, { value: v })} />
                )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

/* ── One block ───────────────────────────────────────────────────────────── */
function Block({ block, number, spec, data, editing, onBlockChange, onOptsChange }) {
  const { type, opts } = block
  const rows = TABLE_BLOCKS.includes(type) ? rowsFor(block, data) : null
  const count = rows ? rows.length : null

  /* An untitled block prints with no heading at all — that is how a signature
     block belongs on paper. The heading still appears while editing so the
     officer can see there is one to fill in. */
  const showHeading = Boolean(block.title) || editing

  return (
    <section className={`rd-section rd-sec-${type}`}>
      {showHeading && (
        <h2 className="rd-sec-title">
          {number && <span className="rd-sec-num">{number}</span>}
          <Editable className="rd-sec-name" value={block.title} placeholder="Untitled — click to add a heading" disabled={!editing}
            onChange={(v) => onBlockChange(block.id, { title: v })} />
          {opts.showCount && count !== null && <span className="rd-sec-count">{count}</span>}
        </h2>
      )}

      {type === 'summary' && <SummaryBlock opts={opts} data={data} spec={spec} editing={editing}
        onOptsChange={(p) => onOptsChange(block.id, p)} />}

      {type === 'map' && <MapBlock opts={opts} spec={spec} data={data} editing={editing}
        onOptsChange={(p) => onOptsChange(block.id, p)} />}

      {type === 'text' && (
        <Editable className="rd-prose" multiline value={opts.body} disabled={!editing}
          placeholder="Write here — findings, actions taken, recommendations…"
          onChange={(v) => onOptsChange(block.id, { body: v })} />
      )}

      {type === 'signatories' && <Signatories opts={opts} editing={editing}
        onOptsChange={(p) => onOptsChange(block.id, p)} />}

      {rows && (
        <>
          <DataTable type={type} rows={rows} opts={opts} />
          {(opts.note || editing) && (
            <Editable className="rd-tablenote" multiline value={opts.note} disabled={!editing}
              placeholder="Table note (optional) — source, caveat, cut-off time…"
              onChange={(v) => onOptsChange(block.id, { note: v })} />
          )}
        </>
      )}
    </section>
  )
}

/* ── Executive summary ───────────────────────────────────────────────────── */
function SummaryBlock({ opts, data, spec, editing, onOptsChange }) {
  const chosen = opts.stats
    .map((k) => STAT_CATALOGUE.find((s) => s.key === k))
    .filter(Boolean)

  return (
    <>
      {opts.showStats && chosen.length > 0 && (
        <div className="rd-stats">
          {chosen.map((s) => (
            <div className="rd-stat" key={s.key}>
              <div className="rd-stat-n">{data.stats[s.key]}</div>
              <div className="rd-stat-l">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {opts.showNarrative && (
        <Editable
          className="rd-prose"
          multiline
          value={opts.narrative || autoNarrative(spec, data)}
          disabled={!editing}
          placeholder="Overview"
          onChange={(v) => onOptsChange({ narrative: v === autoNarrative(spec, data) ? '' : v })}
        />
      )}
    </>
  )
}

/** The paragraph the report writes for itself until an officer overrides it. */
function autoNarrative(spec, data) {
  const where = spec.scope.length === 0
    ? 'the entire City of Cabuyao'
    : `Barangay ${spec.scope.join(', ')}`
  const s = data.stats
  const parts = [
    `This report consolidates the flood and road situation for ${where} as of ${data.generatedAt} PHT.`,
    `It documents ${s.floodAreas} flood-prone ${plural(s.floodAreas, 'area', 'areas')} on record, ${s.roadsClosed} road ${plural(s.roadsClosed, 'segment', 'segments')} closed to traffic and ${s.roadsFlooded} passable only with caution.`,
    `${s.evacOpen} evacuation ${plural(s.evacOpen, 'centre is', 'centres are')} operating, with a combined capacity of ${s.evacCapacity} and ${s.evacOccupancy} presently sheltered.`,
  ]
  if (Number(s.alerts) > 0 || Number(s.incidents) > 0) {
    parts.push(`${s.alerts} flood ${plural(s.alerts, 'alert remains', 'alerts remain')} in force and ${s.incidents} ${plural(s.incidents, 'incident is', 'incidents are')} still open.`)
  }
  if (data.deepestLabel !== '—') {
    parts.push(`The deepest flooding documented within this coverage is ${data.deepestLabel}.`)
  }
  return parts.join(' ')
}
function plural(n, one, many) {
  return Number(String(n).replace(/[^0-9.]/g, '')) === 1 ? one : many
}

/* ── Situation map ───────────────────────────────────────────────────────── */
function MapBlock({ opts, spec, data, editing, onOptsChange }) {
  return (
    <>
      <ReportMap
        scope={spec.scope}
        opts={opts}
        samples={data.samples}
        floodAreas={data.floodAreas}
        evac={data.evac}
        roadLines={data.roadLines}
      />
      {opts.legend && (
        <div className="rd-legend">
          {opts.barangayRisk && ['high', 'moderate', 'low', 'safe'].map((k) => (
            <span key={k} className="rd-leg"><i style={{ background: RISK_META[k].color }} />{RISK_META[k].label} risk</span>
          ))}
          {opts.floodAreas && ['high', 'moderate', 'low'].map((k) => (
            <span key={`f-${k}`} className="rd-leg"><i className="dot" style={{ background: FLOOD_SEVERITY_META[k].color }} />Flood-prone · {FLOOD_SEVERITY_META[k].label}</span>
          ))}
          {opts.roads && (
            <>
              <span className="rd-leg"><i className="line" style={{ background: ROAD_STATUS.blocked.swatch }} />Road closed</span>
              <span className="rd-leg"><i className="line" style={{ background: ROAD_STATUS.flooded.swatch }} />Road flooded</span>
            </>
          )}
          {opts.evac && <span className="rd-leg"><i style={{ background: '#16A34A' }} />Evacuation centre</span>}
        </div>
      )}
      {(opts.caption || editing) && (
        <Editable className="rd-caption" value={opts.caption} disabled={!editing}
          placeholder="Figure caption (optional)"
          onChange={(v) => onOptsChange({ caption: v })} />
      )}
    </>
  )
}

/* ── Signature block ─────────────────────────────────────────────────────── */
function Signatories({ opts, editing, onOptsChange }) {
  const setRow = (id, patch) => onOptsChange((o) => ({
    rows: o.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }))
  return (
    <div className="rd-signs" data-cols={opts.columns}>
      {opts.rows.map((r) => (
        <div className="rd-sign" key={r.id}>
          <Editable className="rd-sign-label" value={r.label} placeholder="Prepared by:" disabled={!editing}
            onChange={(v) => setRow(r.id, { label: v })} />
          <Editable className="rd-sign-name" value={r.name} placeholder="Full name" disabled={!editing}
            onChange={(v) => setRow(r.id, { name: v })} />
          <div className="rd-sign-rule" />
          <Editable className="rd-sign-pos" value={r.position} placeholder="Position / designation" disabled={!editing}
            onChange={(v) => setRow(r.id, { position: v })} />
        </div>
      ))}
    </div>
  )
}

/* ── Tables ──────────────────────────────────────────────────────────────── */
function DataTable({ type, rows, opts }) {
  const cols = (COLUMN_CATALOGUE[type] || []).filter((c) => opts.columns[c.key])
  if (cols.length === 0) {
    return <p className="rd-empty">No columns selected for this table.</p>
  }
  if (rows.length === 0) {
    return <p className="rd-empty">{EMPTY_MSG[type] || 'No records for this coverage.'}</p>
  }
  return (
    <table className={`rd-table ${opts.zebra ? 'zebra' : ''}`}>
      <thead>
        <tr>
          <th className="rd-th-idx">#</th>
          {cols.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.__key || i}>
            <td className="rd-td-idx">{i + 1}</td>
            {cols.map((c) => (
              <td key={c.key} className={c.num ? 'num' : ''}>{cell(type, c.key, row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const EMPTY_MSG = {
  roads: 'No roads are currently flagged flooded or closed.',
  alerts: 'No flood alerts are in force.',
  incidents: 'No open incidents.',
  evac: 'No evacuation centres registered for this coverage.',
  floodAreas: 'No flood-prone areas on record for this coverage.',
}

function cell(type, key, r) {
  if (type === 'floodAreas') {
    const sev = floodSeverity(r)
    switch (key) {
      case 'name': return <span className="rd-strong">{r.name}</span>
      case 'barangay': return r.barangay
      case 'depth': return <span className="rd-fig" style={{ color: FLOOD_SEVERITY_META[sev].color }}>{formatFloodDepth(r)}</span>
      case 'severity': return <Tag tone={sev}>{FLOOD_SEVERITY_META[sev].label}</Tag>
      case 'type': return FLOOD_TYPE_LABEL[r.type] || '—'
      case 'causes': return (r.causes || []).join(', ') || '—'
      case 'source': return r.sourceStorms || '—'
      case 'notes': return r.notes || '—'
      default: return '—'
    }
  }
  if (type === 'roads') {
    switch (key) {
      case 'name': return <span className="rd-strong">{r.name || 'Unnamed road'}</span>
      case 'barangay': return r.barangay || '—'
      case 'status': return <Tag tone={r.status === 'blocked' ? 'high' : 'moderate'}>{ROAD_STATUS[r.status]?.label || r.status}</Tag>
      case 'depth': return r.depthFt != null ? <span className="rd-fig">{r.depthFt} ft</span> : '—'
      case 'reason': return r.reason || '—'
      case 'updated': return r.updated || '—'
      default: return '—'
    }
  }
  if (type === 'evac') {
    const cap = Number(r.capacity) || 0
    const occ = Number(r.occupancy) || 0
    switch (key) {
      case 'name': return <span className="rd-strong">{r.name}</span>
      case 'barangay': return r.barangay
      case 'capacity': return cap.toLocaleString()
      case 'occupancy': return occ.toLocaleString()
      case 'available': return Math.max(0, cap - occ).toLocaleString()
      case 'utilisation': return cap ? `${Math.round((occ / cap) * 100)}%` : '—'
      case 'status': return <Tag tone={r.status === 'closed' ? 'high' : r.status === 'full' ? 'moderate' : 'safe'}>{r.status}</Tag>
      case 'manager': return r.manager || '—'
      case 'contact': return r.contact || '—'
      default: return '—'
    }
  }
  if (type === 'alerts') {
    switch (key) {
      case 'level': return <Tag tone={r.level}>{r.level}</Tag>
      case 'title': return <span className="rd-strong">{r.title}</span>
      case 'barangay': return r.barangay
      case 'message': return r.message || '—'
      case 'issued': return r.issued || '—'
      default: return '—'
    }
  }
  if (type === 'incidents') {
    switch (key) {
      case 'type': return <span className="rd-strong">{r.type}</span>
      case 'barangay': return r.barangay
      case 'priority': return <Tag tone={PRIORITY_RANK[r.priority] >= 3 ? 'high' : 'moderate'}>{r.priority}</Tag>
      case 'status': return r.status
      case 'team': return r.team || 'Unassigned'
      case 'location': return r.location || '—'
      case 'reported': return r.reported || '—'
      default: return '—'
    }
  }
  if (type === 'barangays') {
    switch (key) {
      case 'name': return <span className="rd-strong">{r.name}</span>
      case 'level': return <Tag tone={r.level}>{RISK_META[r.level].label}</Tag>
      case 'depth': return <span className="rd-fig">{r.floodDepth.toFixed(2)} m</span>
      case 'areas': return r.areaCount
      case 'roads': return r.roadCount
      case 'evac': return r.evacCount
      default: return '—'
    }
  }
  return '—'
}

function Tag({ tone, children }) {
  return <span className={`rd-tag tone-${tone}`}>{children}</span>
}

/* ── Filtering and sorting ────────────────────────────────────────────────
   Applied here rather than in the page so a duplicated block can carry its own
   filter — the whole reason a road advisory can hold a "closed" table and a
   "flooded" table at once. */
function rowsFor(block, data) {
  const { type, opts } = block
  const f = opts.filters || {}
  let rows = []

  if (type === 'floodAreas') {
    rows = data.floodAreas.filter((a) => {
      const sev = floodSeverity(a)
      if (f.severity === 'high' && sev !== 'high') return false
      if (f.severity === 'moderate' && sev === 'low') return false
      if (f.type !== 'all' && a.type !== f.type) return false
      return true
    })
    rows = sortBy(rows, opts.sort, {
      depth: (a, b) => (depthMeters(b) || 0) - (depthMeters(a) || 0),
      name: (a, b) => a.name.localeCompare(b.name),
      barangay: (a, b) => a.barangay.localeCompare(b.barangay) || a.name.localeCompare(b.name),
    })
  } else if (type === 'roads') {
    rows = data.roadLines.filter((r) => f.status === 'all' || r.status === f.status)
    rows = sortBy(rows, opts.sort, {
      name: (a, b) => (a.name || '').localeCompare(b.name || ''),
      severity: (a, b) => (b.status === 'blocked' ? 1 : 0) - (a.status === 'blocked' ? 1 : 0) || (a.name || '').localeCompare(b.name || ''),
      depth: (a, b) => (b.depthFt || 0) - (a.depthFt || 0),
    })
  } else if (type === 'evac') {
    rows = data.evac.filter((c) => {
      if (f.status === 'all') return true
      if (f.status === 'operational') return c.status !== 'closed'
      return c.status === f.status
    })
    rows = sortBy(rows, opts.sort, {
      name: (a, b) => a.name.localeCompare(b.name),
      barangay: (a, b) => a.barangay.localeCompare(b.barangay) || a.name.localeCompare(b.name),
      occupancy: (a, b) => (b.occupancy || 0) - (a.occupancy || 0),
      available: (a, b) => ((b.capacity || 0) - (b.occupancy || 0)) - ((a.capacity || 0) - (a.occupancy || 0)),
    })
  } else if (type === 'alerts') {
    rows = data.alerts.filter((a) => {
      if (f.level === 'all') return true
      if (f.level === 'high') return a.level === 'high'
      return a.level === 'high' || a.level === 'moderate'
    })
    rows = sortBy(rows, opts.sort, {
      level: (a, b) => (LEVEL_RANK[b.level] || 0) - (LEVEL_RANK[a.level] || 0),
      issued: (a, b) => (b.issuedAt || 0) - (a.issuedAt || 0),
      barangay: (a, b) => String(a.barangay).localeCompare(String(b.barangay)),
    })
  } else if (type === 'incidents') {
    rows = data.incidents.filter((i) => {
      if (f.priority === 'all') return true
      if (f.priority === 'critical') return i.priority === 'critical'
      return (PRIORITY_RANK[i.priority] || 0) >= 3
    })
    rows = sortBy(rows, opts.sort, {
      priority: (a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0),
      reported: (a, b) => (b.reportedAt || 0) - (a.reportedAt || 0),
      barangay: (a, b) => String(a.barangay).localeCompare(String(b.barangay)),
    })
  } else if (type === 'barangays') {
    rows = data.samples
      .map((b) => ({ ...b, level: levelFromDepth(b.floodDepth) }))
      .filter((b) => {
        if (f.level === 'high') return b.level === 'high'
        if (f.level === 'atrisk') return b.level !== 'safe'
        return true
      })
    rows = sortBy(rows, opts.sort, {
      depth: (a, b) => b.floodDepth - a.floodDepth,
      name: (a, b) => a.name.localeCompare(b.name),
    })
  }

  const limit = Number(opts.limit) || 0
  return limit > 0 ? rows.slice(0, limit) : rows
}

function sortBy(rows, key, comparators) {
  const cmp = comparators[key] || Object.values(comparators)[0]
  return [...rows].sort(cmp)
}
