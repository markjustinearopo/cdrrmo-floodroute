/* ============================================================
   MapStatusLine — the one bottom-of-map status strip.

   WHY IT EXISTS: the live "Updated HH:MM PHT" pill and the coordinate
   readout used to be two independently positioned boxes — the stamp
   centred on the bottom edge, the coordinates pinned bottom-left. Both
   claimed the same 12px row, so from roughly 700px down the centred
   pill drifted left until it sat directly ON TOP of the coordinates
   (105px of overlap at 375px, on all three flood maps).

   Two absolutely-positioned siblings can't be made to avoid each other
   with offsets alone — one of them always wins at some width. So they
   are one element now: a single strip laid out in flow, which cannot
   overlap itself at any viewport size, capped short of the bottom-right
   zoom control so it can't reach that either.

   `children` carries the map-specific extras (the admin map's risk ramp
   and its vertical-exaggeration note); those are dropped on phone widths
   by the stylesheet rather than allowed to push the strip wide.
   ============================================================ */

import './mapStatusLine.css'

/**
 * @param updated   formatted PHT time string (formatPHT())
 * @param coords    { lat, lng, zoom } from <CoordReadout>, or null before the
 *                  map reports its first view
 * @param forecast  when set, the strip reads as a PROJECTION rather than live
 *                  — e.g. "+6h from 3:42 PM PHT" — and turns amber
 * @param children  extra inline chips (legend ramp, scale note …)
 */
export default function MapStatusLine({ updated, coords, forecast = null, children }) {
  return (
    <div className={`map-statusline ${forecast ? 'map-statusline--forecast' : ''}`}>
      <span className={`msl-live ${forecast ? 'msl-live--forecast' : ''}`}>
        <i className="msl-dot" aria-hidden="true" />
        {forecast ? `Forecast · ${forecast}` : `Live · Updated ${updated} PHT`}
      </span>
      <span className="msl-coords">
        {coords
          ? `${coords.lat.toFixed(4)} N, ${coords.lng.toFixed(4)} E · z${coords.zoom}`
          : 'No map data'}
      </span>
      {children}
    </div>
  )
}
