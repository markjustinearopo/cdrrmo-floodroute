import { useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM, CabuyaoLock, CoordReadout } from '../../components/admin/mapHelpers.jsx'
import {
  ROAD_STATUS,
  RoadNetworkLayer,
  useCabuyaoRoads,
  useRoadStatus,
} from '../../components/admin/routingHelpers.jsx'
import { MapViewToggle, use3DPreference } from '../../components/admin/Map3D.jsx'
import { MapGuideButton } from '../../components/MapGuide.jsx'
import { residentRoadStatusSteps } from '../../components/mapGuideSteps.jsx'
import RoadNetwork3DView from '../../components/admin/RoadNetwork3DView.jsx'
import MapSearchBar from '../../components/map/MapSearchBar.jsx'
import SearchResultLayer from '../../components/map/SearchResultLayer.jsx'
import { buildLocalIndex } from '../../components/map/searchTools.js'
import { useEvacCenters, useRoadBlocks } from '../../context/AdminDataContext.jsx'
import RoadBlocksLayer from '../../components/map/RoadBlocksLayer.jsx'
import { activeBlocks } from '../../components/admin/roadBlocks.js'
import { describeDepth } from '../../services/depth.js'
import '../admin/RoadStatus.css'
import '../../components/map/roadBlocks.css'
import OneWayArrowsLayer from '../../components/map/OneWayArrowsLayer.jsx'

/**
 * CDRRMO Resident — Road Status (Routing).
 *
 * READ-ONLY view of which roads are flooded or closed, so a resident can avoid
 * them. The conditions are exactly the ones CDRRMO and barangay officials tag
 * (shared store) — residents only look. The complete Cabuyao road network
 * (OpenStreetMap, bundled) underlays the flagged roads as a static overlay.
 */

export default function RoadStatus() {
  const { roads } = useCabuyaoRoads()
  const [statusMap] = useRoadStatus() // read-only consumption of the shared conditions
  const [coords, setCoords] = useState(null)
  const [use3D, setUse3D] = use3DPreference()

  /* Partial closures — a blocked SECTION of a road whose rest is open. These
     cannot appear in `statusMap`, which holds one status per whole way, so a
     screen reading only that map would tell a resident their road is fine
     while 200 m of it is under water. This is the page they open to ask
     exactly that question, so the sections get their own list below. */
  const { roadBlocks } = useRoadBlocks()
  const sections = useMemo(
    () => activeBlocks(roadBlocks)
      .filter((b) => b.scope === 'partial')
      .sort((a, b) => (
        // Impassable before merely flooded, then longest closure first.
        (a.effect === b.effect ? 0 : a.effect === 'blocked' ? -1 : 1)
        || (b.lengthM || 0) - (a.lengthM || 0)
      )),
    [roadBlocks],
  )

  /* Finding a specific street is the whole point of this page — a resident
     checks it to answer "is MY road passable?", and hunting for it by dragging
     a city-wide network of 4,853 segments is not an answer. Same search as the
     flood maps: barangays and evacuation centres locally, streets and
     landmarks from OSM. */
  const { evacuationCenters } = useEvacCenters()
  const [searchResult, setSearchResult] = useState(null)
  const localIndex = useMemo(
    () => buildLocalIndex({ evacCenters: evacuationCenters }),
    [evacuationCenters],
  )

  const counts = useMemo(() => {
    const c = { flooded: 0, blocked: 0 }
    Object.values(statusMap).forEach((s) => {
      if (c[s] != null) c[s]++
    })
    const total = roads?.features.length || 0
    return { ...c, total, open: Math.max(total - c.flooded - c.blocked, 0) }
  }, [statusMap, roads])

  /* Grouped by STREET, not by OSM way.
     A street is split into however many ways OSM happened to draw it, so the
     raw list repeated "Crimson Street" five times in a row — which reads as a
     broken list, not as five flooded stretches. A resident scanning "which
     roads do I avoid" wants street names; the segment count carries the extent.
     Where one street has both flooded and closed stretches the WORSE status
     wins, because that is the one that changes what they do.
     Unnamed local roads have no name to scan for, so they collapse into a
     single honest row per status instead of pages of "Road #240385". */
  const flagged = useMemo(() => {
    if (!roads) return []
    const byId = new Map(roads.features.map((f) => [String(f.properties.id), f.properties]))
    // Keyed by name AND status, never by name alone: a street with two flooded
    // stretches and one closed one is two facts, and folding them into one row
    // would have to overstate one of them.
    const groups = new Map()
    for (const [id, status] of Object.entries(statusMap)) {
      const props = byId.get(String(id))
      if (!props) continue
      /* A label is enough to scan for, whether or not it is the way's own OSM
         street name: "Saint Joseph Village road · 6 stretches" tells a
         resident where to avoid, and "Unnamed local roads · 6" does not. Only
         ways with no label at all fall into the catch-all row. */
      const label = props.nameSource ? props.name : null
      const key = label ? `${label} ${status}` : ` unnamed ${status}`
      const prev = groups.get(key)
      if (prev) prev.count++
      else {
        groups.set(key, {
          id: key,
          status,
          count: 1,
          named: Boolean(label),
          name: label || 'Unnamed local roads',
        })
      }
    }
    return [...groups.values()].sort((a, b) =>
      // Closed first — those are the ones with no way through at all — then
      // named streets before the unnamed catch-all, then alphabetical.
      (a.status === b.status ? 0 : a.status === 'blocked' ? -1 : 1)
      || (b.named - a.named)
      || a.name.localeCompare(b.name))
  }, [statusMap, roads])

  return (
    <ResidentLayout mainClassName="main--flush">
      <div className="road-status">
        <div className="rs-toolbar">
          <div className="rs-title">
            <RoadIcon />
            <span>Road Status</span>
          </div>

          <div className="rs-brushes">
            <span className="rs-brush-label" style={{ marginRight: 0 }}>Which roads to avoid right now</span>
          </div>

          <div className="rs-source">
            <span className="rs-source-dot" />
            OpenStreetMap · {roads ? `${roads.features.length.toLocaleString()} roads` : 'Overpass'}
          </div>

          <MapGuideButton steps={residentRoadStatusSteps} title="How to use Road Status" />
          <MapViewToggle value={use3D} onChange={setUse3D} />
        </div>

        <div className="rs-body">
          <div className="rs-map-area">
            {use3D ? (
              /* Same network + shared conditions, on terrain. Read-only: no
                 click-to-paint, residents only view conditions. */
              <RoadNetwork3DView statusMap={statusMap} interactive={false} onViewChange={setCoords} />
            ) : (
            <MapContainer
              center={CABUYAO_CENTER}
              zoom={CABUYAO_ZOOM}
              zoomControl={false}
              attributionControl={false}
              className="rs-leaflet"
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={0.8} />
              <ZoomControl position="bottomright" />
              <CabuyaoLock />
              {roads && <RoadNetworkLayer roads={roads} statusMap={statusMap} interactive={false} />}
              {roads && <OneWayArrowsLayer roads={roads} />}
              {/* The exact closed stretch, over a road drawn in its ordinary
                  colour because the rest of it is genuinely open. */}
              <RoadBlocksLayer blocks={roadBlocks} audience="resident" />
              <SearchResultLayer result={searchResult} />
              <CoordReadout onChange={setCoords} />
            </MapContainer>
            )}

            {/* 2D only — the result layer draws through Leaflet. */}
            {!use3D && <MapSearchBar localIndex={localIndex} onSelect={setSearchResult} />}

            <div className="rs-coords">
              {coords
                ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E | Zoom: ${coords.zoom}`
                : 'No map data'}
            </div>
          </div>

          <aside className="rs-panel">
            <section className="rs-section">
              <h3 className="rs-section-title">Network Conditions</h3>
              <div className="rs-summary">
                <div className="rs-sum rs-sum--blocked">
                  <div className="rs-sum-val">{counts.blocked}</div>
                  <div className="rs-sum-lbl">Closed</div>
                </div>
                <div className="rs-sum rs-sum--flooded">
                  <div className="rs-sum-val">{counts.flooded}</div>
                  <div className="rs-sum-lbl">Flooded</div>
                </div>
                <div className="rs-sum rs-sum--open">
                  <div className="rs-sum-val">{counts.open}</div>
                  <div className="rs-sum-lbl">Passable</div>
                </div>
              </div>
              <div className="rs-total">{counts.total.toLocaleString()} road segments mapped — every street in Cabuyao</div>
              {/* Counted separately, never folded into "Closed". A road with a
                  200 m closure is not a closed road, and adding it to that
                  figure would make the number mean two different things. */}
              {sections.length > 0 && (
                <div className="rs-total rs-total--sections">
                  Plus <b>{sections.length}</b> partial closure{sections.length > 1 ? 's' : ''} —
                  {' '}sections of roads that are otherwise open.
                </div>
              )}
            </section>

            <section className="rs-section">
              <h3 className="rs-section-title">Legend</h3>
              <div className="rs-legend">
                {Object.entries(ROAD_STATUS).map(([key, m]) => (
                  <div className="rs-legend-row" key={key}>
                    <span className="rs-legend-line" style={{ background: m.line, opacity: key === 'open' ? 0.6 : 1 }} />
                    <span className="rs-legend-name">{m.label}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Blocked sections ──────────────────────────────────────────
                Its own list, above "Roads to Avoid", because it makes a
                different claim: not "avoid this road" but "this stretch of it
                is shut and the rest is fine". Putting these rows in the list
                below would say the first thing, which is the misinformation
                this whole feature exists to remove. */}
            {sections.length > 0 && (
              <section className="rs-section">
                <div className="rs-flagged-head">
                  <h3 className="rs-section-title">
                    Blocked Sections
                    <span className="rs-pill">{sections.length}</span>
                  </h3>
                </div>
                <ul className="rs-flagged">
                  {sections.map((b) => (
                    <li className="rbs-row" key={b.id}>
                      <span className={`rbs-dot ${b.effect}`} />
                      <span className="rbs-main">
                        <span className="rbs-name">{b.roadName || `Road #${b.wayId}`}</span>
                        <span className="rbs-meta">
                          {b.barangay ? `${b.barangay} · ` : ''}
                          {b.effect === 'blocked'
                            ? 'This section is currently inaccessible'
                            : 'This section is flooded — pass with caution'}
                        </span>
                        {(b.reason || b.depthM != null) && (
                          <span className="rbs-reason">
                            {b.reason}
                            {b.reason && b.depthM != null ? ' · ' : ''}
                            {b.depthM != null ? describeDepth(b.depthM) : ''}
                          </span>
                        )}
                      </span>
                      {b.lengthM != null && <span className="rbs-len">{b.lengthM} m</span>}
                    </li>
                  ))}
                </ul>
                <div className="rs-total">
                  The rest of each road above stays open — routes go around the
                  closed section.
                </div>
              </section>
            )}

            <section className="rs-section rs-section--grow">
              <div className="rs-flagged-head">
                <h3 className="rs-section-title">
                  Roads to Avoid
                  {/* Segments, not rows — so this agrees with the 64 CLOSED /
                      163 FLOODED figures beside the map instead of quietly
                      reporting a different, smaller number for the same thing. */}
                  {flagged.length > 0 && (
                    <span className="rs-pill">{flagged.reduce((n, r) => n + r.count, 0)}</span>
                  )}
                </h3>
              </div>
              {flagged.length === 0 ? (
                <div className="rs-empty">No roads are flagged flooded or closed right now.</div>
              ) : (
                <ul className="rs-flagged">
                  {flagged.map((r) => (
                    <li className="rs-flagged-row" key={r.id}>
                      <span className="rs-flagged-line" style={{ background: ROAD_STATUS[r.status].swatch }} />
                      <span className="rs-flagged-name" title={r.name}>
                        {r.name}
                        {r.count > 1 && <em className="rs-flagged-count">{r.count} stretches</em>}
                      </span>
                      <span className={`rs-badge ${r.status}`}>{ROAD_STATUS[r.status].label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rs-section rs-note">
              <SparkIcon />
              <span>
                Road conditions are reported by CDRRMO and barangay officials and update
                live. Always follow on-the-ground advice from responders.
              </span>
            </section>
          </aside>
        </div>
      </div>
    </ResidentLayout>
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
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  )
}
