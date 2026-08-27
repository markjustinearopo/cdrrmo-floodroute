import { useEffect, useMemo, useRef, useState } from 'react'
import { CITY_WIDE } from '../../data/cabuyao.js'
import { relativeTime, useNow } from './dashHooks.js'
import './PulseTicker.css'

/* ============================================================
   One stream of everything that has happened.

   The system records four kinds of event — alerts issued, incidents reported,
   resident flood reports filed, roads flagged — and each lived on its own page
   behind its own tab. Nobody watching a flood wants four tabs; they want the
   last hour of the city in one column, newest first, so they can see the shape
   of the event: reports coming in from one barangay, then a road going under,
   then the alert that followed.

   Events that arrive while somebody is looking flash in rather than silently
   appearing at the top, and the relative stamps re-tick on their own, so a
   feed that has gone quiet looks quiet instead of looking broken.
   ============================================================ */

const KIND_META = {
  alert: { label: 'Alert', cls: 'alert' },
  incident: { label: 'Incident', cls: 'incident' },
  report: { label: 'Resident report', cls: 'report' },
  road: { label: 'Road', cls: 'road' },
}

/**
 * @param alerts/incidents/floodReports/roadReports  the shared-store collections
 * @param barangay   scope to one barangay (barangay + resident portals)
 * @param limit      how many rows to show
 * @param onOpen     called with (kind, record) when a row is clicked
 */
export default function PulseTicker({
  alerts = [],
  incidents = [],
  floodReports = [],
  roadReports = [],
  barangay = null,
  limit = 8,
  onOpen,
  title = 'Live Operations Feed',
}) {
  const now = useNow(30000) // relative stamps re-tick without a re-fetch

  const events = useMemo(() => {
    const out = []
    /* A citywide record belongs in every barangay's feed. `CITY_WIDE` is the
       exact string the alert store writes ("All Barangays"); anything else
       without a barangay is treated the same way rather than being dropped. */
    const isCitywide = (b) => !b || b === CITY_WIDE || b === 'All'
    const mine = (b) => !barangay || isCitywide(b) || b === barangay

    for (const a of alerts) {
      if (!mine(a.barangay)) continue
      if (!a.issuedAt) continue
      out.push({
        key: `alert-${a.id}`,
        kind: 'alert',
        at: a.issuedAt,
        level: a.level || 'safe',
        title: a.title,
        detail: isCitywide(a.barangay) ? 'Citywide' : `Brgy. ${a.barangay}`,
        record: a,
      })
    }
    for (const i of incidents) {
      if (!mine(i.barangay)) continue
      if (!i.reportedAt) continue
      out.push({
        key: `incident-${i.id}`,
        kind: 'incident',
        at: i.reportedAt,
        level: i.priority === 'high' ? 'high' : i.priority === 'low' ? 'low' : 'moderate',
        title: i.type || 'Incident reported',
        detail: [i.location, i.barangay && `Brgy. ${i.barangay}`].filter(Boolean).join(' · '),
        record: i,
      })
    }
    for (const r of floodReports) {
      if (!mine(r.barangay)) continue
      if (!r.reportedAt) continue
      out.push({
        key: `report-${r.id}`,
        kind: 'report',
        at: r.reportedAt,
        level: r.level || 'moderate',
        title: `Flood reported${r.depthFt != null ? ` — ${Number(r.depthFt).toFixed(1)} ft` : ''}`,
        detail: [r.barangay && `Brgy. ${r.barangay}`, r.status === 'verified' ? 'verified' : 'awaiting verification']
          .filter(Boolean).join(' · '),
        record: r,
      })
    }
    for (const r of roadReports) {
      if (!mine(r.barangay)) continue
      if (!r.updatedAt) continue
      out.push({
        key: `road-${r.id ?? r.wayId}`,
        kind: 'road',
        at: r.updatedAt,
        level: r.status === 'closed' ? 'high' : 'moderate',
        title: `${r.name || 'Unnamed road'} — ${r.status === 'closed' ? 'impassable' : 'flooded'}`,
        detail: [r.barangay && `Brgy. ${r.barangay}`, r.depthFt != null ? `${Number(r.depthFt).toFixed(1)} ft` : null]
          .filter(Boolean).join(' · '),
        record: r,
      })
    }

    out.sort((a, b) => b.at - a.at)
    return out.slice(0, limit)
  }, [alerts, incidents, floodReports, roadReports, barangay, limit])

  /* Anything whose key was not in the previous render arrived while the reader
     was here, and gets one flash. The very first render is not "new" — the
     whole list would strobe on page load. */
  const seenRef = useRef(null)
  const [fresh, setFresh] = useState(() => new Set())
  useEffect(() => {
    const keys = new Set(events.map((e) => e.key))
    if (seenRef.current === null) {
      seenRef.current = keys
      return undefined
    }
    const added = [...keys].filter((k) => !seenRef.current.has(k))
    seenRef.current = keys
    if (!added.length) return undefined
    setFresh(new Set(added))
    const id = setTimeout(() => setFresh(new Set()), 2600)
    return () => clearTimeout(id)
  }, [events])

  const newestAge = events.length ? relativeTime(events[0].at, now) : null

  return (
    <div className="pt-card">
      <div className="pt-head">
        <span className="pt-title"><ActivityIcon />{title}</span>
        <span className="pt-live"><i />LIVE</span>
      </div>

      {events.length === 0 ? (
        <div className="pt-empty">
          <ActivityIcon />
          <div>
            <b>Nothing logged yet</b>
            <em>
              {barangay
                ? `Alerts, incidents, resident reports and road closures for Brgy. ${barangay} appear here as they happen.`
                : 'Alerts, incidents, resident reports and road closures appear here as they happen.'}
            </em>
          </div>
        </div>
      ) : (
        <>
          <ol className="pt-list">
            {events.map((e, i) => (
              <li
                key={e.key}
                className={`pt-row ${KIND_META[e.kind].cls} ${e.level} ${fresh.has(e.key) ? 'fresh' : ''} ${onOpen ? 'clickable' : ''}`}
                style={{ '--d': `${i * 55}ms` }}
                onClick={onOpen ? () => onOpen(e.kind, e.record) : undefined}
                role={onOpen ? 'button' : undefined}
                tabIndex={onOpen ? 0 : undefined}
                onKeyDown={onOpen ? (ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    onOpen(e.kind, e.record)
                  }
                } : undefined}
              >
                <span className="pt-rail"><i /></span>
                <span className="pt-icon">{iconFor(e.kind)}</span>
                <span className="pt-body">
                  <span className="pt-row-title">{e.title}</span>
                  {e.detail && <span className="pt-row-detail">{e.detail}</span>}
                </span>
                <span className="pt-when">
                  <span className="pt-kind">{KIND_META[e.kind].label}</span>
                  <span className="pt-ago">{relativeTime(e.at, now)}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="pt-foot">
            Newest entry {newestAge}. Updates arrive on their own — no refresh needed.
          </div>
        </>
      )}
    </div>
  )
}

function iconFor(kind) {
  if (kind === 'alert') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    )
  }
  if (kind === 'incident') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    )
  }
  if (kind === 'report') {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      </svg>
    )
  }
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

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}
