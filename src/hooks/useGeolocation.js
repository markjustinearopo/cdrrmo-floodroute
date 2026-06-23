import { useCallback, useRef, useState } from 'react'

/**
 * Thin wrapper around the browser's HTML5 Geolocation API.
 *
 * The system relies on each user's REAL device location, which the browser
 * only releases after an explicit permission grant — so this hook never asks on
 * mount. A screen calls `locate()` (e.g. from a "Locate me" button) and only
 * then is the permission prompt shown. The returned position is the device's
 * true coordinates anywhere in the world; callers decide what to do with it
 * (drop a "you are here" pin, fly the map there, measure distance to a shelter).
 *
 * Returns:
 *   coords   — { lat, lng, accuracy } | null
 *   error    — human-readable string | null
 *   loading  — true while a fix is in flight
 *   locate() — Promise<coords>; rejects with the error string
 *   clear()  — drop the current fix/error (e.g. to hide the pin)
 */
export function useGeolocation() {
  const [coords, setCoords] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  // Guard against setting state after the consumer unmounts mid-request.
  const aliveRef = useRef(true)

  const locate = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        const msg = 'Location is not supported on this device.'
        setError(msg)
        reject(msg)
        return
      }
      setLoading(true)
      setError(null)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!aliveRef.current) return
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }
          setCoords(next)
          setLoading(false)
          resolve(next)
        },
        (err) => {
          if (!aliveRef.current) return
          // Map the raw GeolocationPositionError to a friendly message.
          const msg =
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Enable it in your browser to use this.'
              : err.code === err.POSITION_UNAVAILABLE
                ? 'Your location is currently unavailable. Try again in a moment.'
                : err.code === err.TIMEOUT
                  ? 'Timed out getting your location. Please try again.'
                  : 'Could not get your location.'
          setError(msg)
          setLoading(false)
          reject(msg)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      )
    })
  }, [])

  const clear = useCallback(() => {
    setCoords(null)
    setError(null)
  }, [])

  return { coords, error, loading, locate, clear }
}

export default useGeolocation
