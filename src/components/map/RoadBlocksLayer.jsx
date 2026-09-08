/* ============================================================
   RoadBlocksLayer — the closed SECTION, drawn over the open road.

   One layer, used by every map in the product (CDRRMO dashboard, admin road
   screens, resident flood map and routing), because the whole point of a
   partial closure is that everybody has to see the same 200 m — an operator
   deciding to close it, and the person walking towards it.

   WHAT IT DRAWS, AND WHY IT IS DRAWN THIS WAY
   The road underneath is already painted by RoadNetworkLayer in its ordinary
   colour, because most of it is genuinely open. This layer paints ONLY the
   blocked span on top:

     • a wide translucent casing, so the closed stretch reads at city zoom
       without the hairline vanishing into the road it sits on
     • a solid red core with a dashed white overlay — the visual grammar of a
       barrier, and legible to someone who cannot distinguish red from the
       orange "flooded" roads beside it
     • end caps at the two picked points, which are the only two places on the
       road where the answer to "can I get through" changes

   A resolved closure is not drawn at all. A road that has reopened must not
   keep a red line on it: an operator who reopens a road and still sees it
   closed will stop trusting the map, and a resident will walk the long way
   round for nothing.
   ============================================================ */

import { Polyline, CircleMarker, Popup, Tooltip } from 'react-leaflet'
import { activeBlocks } from '../admin/roadBlocks.js'
import { describeDepth } from '../../services/depth.js'
import './roadBlocks.css'

const EFFECT = {
  blocked: { color: '#dc2626', label: 'Closed', verb: 'is currently inaccessible' },
  flooded: { color: '#f97316', label: 'Flooded', verb: 'is flooded and may be impassable' },
}

/**
 * @param blocks      road-block records (useRoadBlocks)
 * @param audience    'admin' | 'resident' — only changes the wording
 * @param onSelect(b) optional click-through (admin list/editor)
 * @param selectedId  drawn emphasised
 * @param showLabels  hover tooltip naming the closure
 */
export default function RoadBlocksLayer({
  blocks = [],
  audience = 'resident',
  onSelect,
  selectedId = null,
  showLabels = true,
}) {
  const rows = activeBlocks(blocks).filter((b) => Array.isArray(b.geometry) && b.geometry.length > 1)
  if (rows.length === 0) return null

  return (
    <>
      {rows.map((b) => (
        <BlockedSpan
          key={`rb-${b.id}`}
          block={b}
          audience={audience}
          onSelect={onSelect}
          selected={selectedId === b.id}
          showLabels={showLabels}
        />
      ))}
    </>
  )
}

function BlockedSpan({ block: b, audience, onSelect, selected, showLabels }) {
  const meta = EFFECT[b.effect] || EFFECT.blocked
  const name = b.roadName || `Road #${b.wayId}`
  const line = b.geometry
  const start = b.start || line[0]
  const end = b.end || line[line.length - 1]
  const handlers = onSelect ? { click: () => onSelect(b) } : undefined

  return (
    <>
      {/* Casing — reads at city zoom without swallowing the road beneath. */}
      <Polyline
        positions={line}
        pathOptions={{
          color: meta.color,
          weight: selected ? 20 : 16,
          opacity: 0.22,
          lineCap: 'butt',
        }}
        interactive={false}
      />
      {/* Core. */}
      <Polyline
        positions={line}
        pathOptions={{
          color: meta.color,
          weight: selected ? 8 : 6,
          opacity: 0.95,
          lineCap: 'butt',
        }}
        eventHandlers={handlers}
      >
        {showLabels && (
          <Tooltip sticky>
            <b>{meta.label}:</b> {name}
          </Tooltip>
        )}
        <Popup>
          <div className="rbl-pop">
            <div className="rbl-pop-kicker" style={{ color: meta.color }}>
              {b.effect === 'blocked' ? 'Road Block Ahead' : 'Flooded Section Ahead'}
            </div>
            <strong>{name}</strong>
            {/* The requirement's sentence, and the one thing a resident needs
                off this popup: it is THIS SECTION, not the whole road. */}
            <div className="rbl-pop-msg">
              {b.scope === 'full'
                ? `This road ${meta.verb}.`
                : `This section of the road ${meta.verb}.`}
            </div>
            {b.scope === 'partial' && (
              <div className="rbl-pop-open">
                The rest of {name} is still open — routes will go around this section.
              </div>
            )}
            <dl className="rbl-pop-facts">
              {b.reason && (<><dt>Reason</dt><dd>{b.reason}</dd></>)}
              {b.depthM != null && (<><dt>Depth</dt><dd>{describeDepth(b.depthM) || `${b.depthM} m`}</dd></>)}
              {b.hazardLevel && (<><dt>Hazard</dt><dd className="rbl-cap">{b.hazardLevel}</dd></>)}
              {b.lengthM != null && b.scope === 'partial' && (
                <><dt>Length</dt><dd>{b.lengthM < 1000 ? `${Math.round(b.lengthM)} m` : `${(b.lengthM / 1000).toFixed(1)} km`}</dd></>
              )}
              <dt>Reported</dt><dd>{b.reported}</dd>
              {audience === 'admin' && b.createdBy && (<><dt>By</dt><dd>{b.createdBy}</dd></>)}
            </dl>
            {audience === 'resident' && (
              <div className="rbl-pop-advice">
                Do not attempt to pass. Follow the route the app generates, or wait
                for CDRRMO to reopen the road.
              </div>
            )}
            {onSelect && audience === 'admin' && (
              <button type="button" className="rbl-pop-open-btn" onClick={() => onSelect(b)}>
                Manage this closure →
              </button>
            )}
          </div>
        </Popup>
      </Polyline>

      {/* The two points where passability changes. Small, deliberate, and the
          same marks the operator saw while picking them. */}
      {[start, end].filter(Boolean).map((p, i) => (
        <CircleMarker
          key={`cap-${i}`}
          center={p}
          radius={selected ? 6 : 5}
          pathOptions={{ color: '#fff', weight: 2, fillColor: meta.color, fillOpacity: 1 }}
          interactive={false}
        />
      ))}
    </>
  )
}
