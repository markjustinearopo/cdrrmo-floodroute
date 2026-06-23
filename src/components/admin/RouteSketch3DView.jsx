/* ============================================================
   RouteSketch3DView — the 3D twin of the route-authoring maps
   (Route Planning · Override Routes · barangay Evacuation Routing ·
   resident Evacuation Routing).

   Declarative wrapper over the native Mapbox layers: a fixed set of
   route lines (draft / planned ghost / override), the same draggable
   .wp-pin stops as the Leaflet views, click-to-add waypoints, the
   optional flagged-roads hazard overlay or full road network — all
   terrain-draped on the shared Map3D.

   `reveal` plays the route-generation animation: when its `key`
   changes (a fresh auto-suggested path, a newly selected route) the
   named line draws itself A→B with the camera riding the tip — a
   3D-only presentation cue, never a data change.

   The set of `lines` (their ids and static styling) must be stable
   per page; only their coords / colour / opacity change over time.
   ============================================================ */

import { useEffect, useRef } from 'react'
import Map3D from './Map3D.jsx'
import {
  useMap3DSetup,
  addRouteLine3D,
  setRouteLine3D,
  setRouteLineStyle,
  syncWaypoints3D,
  addRoadNetwork3D,
  applyRoadStatus3D,
  playRouteReveal3D,
  useEvacCentres3D,
} from './routing3d.js'
import { addCityBoundary, lockMapToBarangay, addHazardRoadsLayer, updateHazardRoadsData, setMapLayerVisible } from './mapbox3dHelpers.js'

export default function RouteSketch3DView({
  lines = [], // [{ id, coords, color, width?, dash?, opacity?, halo?, flow? }]
  pins = [], // [{ key, latlng, label, kind, draggable, onDragEnd }]
  hazard = null, // { roads, statusMap, visible } — flagged-roads-only overlay
  network = null, // { roads, statusMap } — the FULL road network as context
  evac = [], // shared evacuation centres → city-wide dots (matches the 2D markers)
  reveal = null, // { id, key } — fly-along draw of line `id` when `key` changes
  jurisdiction = null, // barangay name → lock the camera/mask to that border
  onMapClick,
  onViewChange,
}) {
  const pinsStore = useRef(new Map())
  const revealKeyRef = useRef(null)
  const cancelRevealRef = useRef(null)

  const initRef = useRef({})
  initRef.current = { lines, hazard, network, jurisdiction }

  const { onMapLoad, mapRef, ready } = useMap3DSetup((map) => {
    const v = initRef.current
    if (v.jurisdiction) lockMapToBarangay(map, v.jurisdiction)
    else addCityBoundary(map)
    if (v.network) {
      addRoadNetwork3D(map, v.network.roads, { interactive: true })
      applyRoadStatus3D(map, v.network.statusMap || {})
    }
    if (v.hazard) {
      addHazardRoadsLayer(map, v.hazard.roads, v.hazard.statusMap, v.hazard.visible !== false)
    }
    for (const line of v.lines) {
      addRouteLine3D(map, line.id, {
        color: line.color,
        halo: line.halo !== false,
        flow: Boolean(line.flow),
        width: line.width ?? 4.5,
        dash: line.dash || null,
        opacity: line.opacity ?? 0.95,
      })
      setRouteLine3D(map, line.id, line.coords)
    }
  })

  // Geometry + restyle (colour/opacity follow the page state, e.g. the route
  // type or which version is active). A line mid-reveal keeps its animated
  // partial geometry — the reveal ends by snapping the full line in place.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const line of lines) {
      if (!(reveal && reveal.id === line.id && cancelRevealRef.current)) {
        setRouteLine3D(map, line.id, line.coords)
      }
      setRouteLineStyle(map, line.id, { color: line.color, opacity: line.opacity })
    }
  }, [lines, ready, mapRef, reveal])

  // Route-generation reveal: a fresh key flies the camera along the line.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !reveal) return
    if (reveal.key == null || reveal.key === revealKeyRef.current) return
    revealKeyRef.current = reveal.key
    const line = lines.find((l) => l.id === reveal.id)
    if (!line || !Array.isArray(line.coords) || line.coords.length < 2) return
    cancelRevealRef.current?.()
    const cancel = playRouteReveal3D(map, reveal.id, line.coords, {
      onDone: () => {
        cancelRevealRef.current = null
      },
    })
    cancelRevealRef.current = () => {
      cancel()
      cancelRevealRef.current = null
    }
  }, [reveal, lines, ready, mapRef])

  useEffect(
    () => () => {
      cancelRevealRef.current?.()
    },
    [],
  )

  // Hazard overlay follows the shared statusMap + page toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !hazard) return
    updateHazardRoadsData(map, hazard.roads, hazard.statusMap)
    setMapLayerVisible(map, 'hazard-roads', hazard.visible !== false)
  }, [hazard, ready, mapRef])

  // Full-network road conditions follow the shared statusMap.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !network) return
    applyRoadStatus3D(map, network.statusMap || {})
  }, [network, ready, mapRef])

  // Stops / waypoints.
  useEffect(() => {
    if (ready && mapRef.current) syncWaypoints3D(mapRef.current, pinsStore.current, pins)
  }, [pins, ready, mapRef])

  // Shared evacuation centres (city-wide) — same dots the 2D maps show.
  useEvacCentres3D(mapRef, ready, evac)

  return (
    <Map3D
      onMapLoad={onMapLoad}
      onViewChange={onViewChange}
      onMapClick={onMapClick ? (lngLat) => onMapClick([lngLat.lat, lngLat.lng]) : undefined}
    />
  )
}
