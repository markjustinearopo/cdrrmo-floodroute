import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Tooltip, useMapEvents, useMap } from 'react-leaflet'
import DialogOverlay from '../DialogOverlay.jsx'
import LocationLookup from '../map/LocationLookup.jsx'
import GeometryControls from '../map/GeometryControls.jsx'
import { CABUYAO_CENTER, CABUYAO_ZOOM } from './mapHelpers.jsx'
import { barangayForPoint } from '../../data/cabuyaoBarangays.js'
import { geometryError, geometryFromPoints } from '../../utils/mapGeometry.js'
import { selectAreaRoads } from '../../utils/roadAreaSelection.js'
import { wayLatLngs } from './roadBlocks.js'
import './roadAreaCondition.css'

function PickPoints({ points, onPick }) {
  const map = useMap()
  useMapEvents({ click: e => onPick([e.latlng.lat, e.latlng.lng]) })
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 16))
    else if (points.length > 1) map.fitBounds(points, { padding: [24, 24], maxZoom: 17 })
  }, [map, points])
  return null
}

export default function RoadAreaConditionModal({ roads, blocks = [], barangay, onClose, onConfirm, proposal = false }) {
  const [mode, setMode] = useState('points')
  const [points, setPoints] = useState([])
  const [excluded, setExcluded] = useState([])
  const [status, setStatus] = useState('flooded')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selection = useMemo(() => selectAreaRoads(roads?.features || [], points, mode, f => {
    if (!barangay) return true
    const line = wayLatLngs(f), mid = line[Math.floor(line.length / 2)]
    return mid && barangayForPoint(...mid) === barangay
  }), [roads, points, mode, barangay])
  const chosen = selection.roads.filter(f => !excluded.includes(String(f.properties.id)))
  const ids = new Set(chosen.map(f => String(f.properties.id)))
  const partials = blocks.filter(b => b.status !== 'resolved' && ids.has(String(b.wayId)))
  const invalid = geometryError(points, mode)
  const color = { flooded: '#f97316', blocked: '#dc2626', open: '#16a34a' }[status]

  function changePoints(next) { setPoints(next); setExcluded([]); setError('') }
  function pick(point) {
    if (busy) return
    const area = barangayForPoint(...point)
    if (!area || (barangay && area !== barangay)) return setError(barangay ? `Choose points inside Brgy. ${barangay}.` : 'Choose a location inside Cabuyao.')
    if (mode !== 'point' && points.length >= 30) return setError('Use no more than 30 points.')
    changePoints(mode === 'point' ? [point] : [...points, point])
  }
  async function save() {
    if (busy || invalid || !chosen.length || selection.missed) return
    if (!proposal && status === 'open' && partials.length) return setError('These roads have active section closures. Reopen those sections with the existing closure controls before marking the roads Passable.')
    setBusy(true); setError('')
    try {
      await onConfirm({ roads: chosen.map(f => {
        const line = wayLatLngs(f), mid = line[Math.floor(line.length / 2)]
        return { wayId: f.properties.id, name: f.properties.name || `Road #${f.properties.id}`, barangay: barangayForPoint(...mid) }
      }), status, reason: reason.trim(), geometry: geometryFromPoints(points, mode) })
      onClose()
    } catch (e) { setError(e.message || 'Could not save the road conditions.'); setBusy(false) }
  }
  return (
    <DialogOverlay className="mng-overlay" onDismiss={busy ? undefined : onClose}>
      <div className="mng-modal road-area-modal" role="dialog" aria-modal="true" aria-label="Multiple-point road conditions" onMouseDown={e => e.stopPropagation()}>
        <div className="mng-modal-head">
          <div><div className="mng-modal-title">Multiple-point road conditions</div><div className="mng-modal-sub">Select several locations or outline a compound, then review the roads.</div></div>
          <button type="button" className="mng-modal-close" aria-label="Close" onClick={onClose} disabled={busy}>×</button>
        </div>
        <div className="road-area-body">
          <fieldset disabled={busy}>
            <LocationLookup point={points.at(-1)} onPick={pick} />
            <GeometryControls mode={mode} onMode={next => { setMode(next); setExcluded([]) }} points={points} onPoints={changePoints} />
            <MapContainer center={CABUYAO_CENTER} zoom={CABUYAO_ZOOM} className="road-area-map">
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <PickPoints points={points} onPick={pick} />
              {chosen.map(f => <Polyline key={f.properties.id} positions={wayLatLngs(f)} pathOptions={{ color, weight: 6 }} interactive={false} />)}
              {mode === 'area' && !invalid && <Polygon positions={points} pathOptions={{ color, fillOpacity: 0.12 }} interactive={false} />}
              {points.map((p, i) => <CircleMarker key={i} center={p} radius={6} pathOptions={{ color: '#fff', fillColor: '#c0181b', fillOpacity: 1 }} interactive={false}><Tooltip permanent>{i + 1}</Tooltip></CircleMarker>)}
            </MapContainer>
            <p>Points select the nearest mapped road within 40 m. A boundary selects mapped roads touching that area. {barangay && `Only roads assigned to Brgy. ${barangay} are available.`}</p>
            {selection.missed > 0 && <p role="alert">{selection.missed} point(s) have no mapped road nearby. Move or remove them. Use a flood report for an unmapped flooded area.</p>}
            <h3>Review selected roads · {chosen.length}</h3>
            <p><b>This changes the entire selected roads.</b> For only part of one road, cancel and use the existing Select Start Point / Select End Point section tool.</p>
            <div className="road-area-list">
              {selection.roads.map(f => <label key={f.properties.id}><input type="checkbox" checked={!excluded.includes(String(f.properties.id))} onChange={e => setExcluded(prev => e.target.checked ? prev.filter(id => id !== String(f.properties.id)) : [...prev, String(f.properties.id)])} />{f.properties.name || `Road #${f.properties.id}`} <small>#{f.properties.id}</small></label>)}
              {!selection.roads.length && <p>No roads selected yet.</p>}
            </div>
            <label className="road-area-field">Condition<select value={status} onChange={e => setStatus(e.target.value)}><option value="flooded">Flooded</option><option value="blocked">Closed / blocked</option><option value="open">Passable</option></select></label>
            {status === 'open' && partials.length > 0 && <p role="status">{partials.length} active section closure(s) remain. {proposal ? 'CDRRMO must review them before reopening.' : 'Reopen them with the existing closure controls first.'}</p>}
            <label className="road-area-field">Reason / field observations<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Flooding throughout the compound; roads checked by the coordinator." /></label>
            {proposal && <p>Changes remain pending until CDRRMO approves each road.</p>}
          </fieldset>
          {error && <p role="alert" className="road-area-error">{error}</p>}
        </div>
        <div className="road-area-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="mng-btn" onClick={save} disabled={busy || Boolean(invalid) || !chosen.length || selection.missed > 0 || (!proposal && status === 'open' && partials.length > 0)}>{busy ? 'Saving…' : `${proposal ? 'Submit' : 'Apply'} ${chosen.length} road condition${chosen.length === 1 ? '' : 's'}`}</button></div>
      </div>
    </DialogOverlay>
  )
}
