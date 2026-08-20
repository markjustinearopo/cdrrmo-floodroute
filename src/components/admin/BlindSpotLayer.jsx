import { useEffect, useMemo } from 'react'
import { CircleMarker } from 'react-leaflet'
import { blindSpotNodes } from '../../services/cutoffAnalysis.js'

/**
 * The blind-spot layer — every part of the road network with no surviving
 * route to any open evacuation centre at the given water level.
 *
 * Same computation as the cutoff table, asked spatially instead of per
 * barangay. Raise the level and the red grows; drag the time scrubber forward
 * and it grows with the forecast.
 *
 * Rendered as translucent dots on the cut-off road nodes rather than a filled
 * polygon on purpose. A smooth boundary would imply the model knows exactly
 * where "cut off" stops and "fine" starts, and it does not — it knows which
 * pieces of the graph lost their connection. Dots show the actual computed
 * thing; a hull would be a drawing.
 */
export default function BlindSpotLayer({ roads, centres, statusMap, level = 0, onSummary }) {
  const result = useMemo(() => {
    if (!roads || !centres?.length || level <= 0) return null
    return blindSpotNodes({ roads, centres, statusMap, level })
  }, [roads, centres, statusMap, level])

  const points = result?.points || []

  /* Hand the count back up so the map chrome can label it honestly.
     This has to be an EFFECT, not a memo: reporting during render is a setState
     on the parent mid-render, which React warns about and which can leave the
     readout showing a count from the previous level. */
  useEffect(() => {
    onSummary?.(result ? { count: points.length, total: result.total, level } : null)
  }, [result, points.length, level, onSummary])

  if (!result || points.length === 0) return null

  // Thin very dense sets so a whole-city blind spot still renders smoothly.
  const stride = points.length > 4000 ? 3 : points.length > 1500 ? 2 : 1
  const shown = stride === 1 ? points : points.filter((_, i) => i % stride === 0)

  return shown.map((pt, i) => (
    <CircleMarker
      key={`bs-${i}`}
      center={pt}
      radius={7}
      interactive={false}
      pathOptions={{
        stroke: false,
        fillColor: '#dc2626',
        fillOpacity: 0.16,
      }}
    />
  ))
}
