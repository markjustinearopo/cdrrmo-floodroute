/* ============================================================
   RoadNetwork3DView — the 3D twin of the Road Status map.

   The COMPLETE bundled Cabuyao road network on the Mapbox terrain
   map, coloured by the SAME shared statusMap the Leaflet view uses
   (Passable / Flooded / Closed), with the same hover tooltips and —
   when `onPick` is given — the same click-to-paint behaviour. Used
   by the admin Road Status screen (interactive) and the barangay /
   resident read-only road condition pages.
   ============================================================ */

import Map3D from './Map3D.jsx'
import { useRoadNetwork3D } from './routing3d.js'
import { useCabuyaoRoads } from './routingHelpers.jsx'

export default function RoadNetwork3DView({
  statusMap = {},
  interactive = false,
  onPick,
  onViewChange,
  jurisdiction = null,
  children,
}) {
  const { roads } = useCabuyaoRoads()
  const { onMapLoad } = useRoadNetwork3D({ roads, statusMap, interactive, onPick, jurisdiction })
  return (
    <Map3D onMapLoad={onMapLoad} onViewChange={onViewChange}>
      {children}
    </Map3D>
  )
}
