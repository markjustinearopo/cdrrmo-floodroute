import { useEffect, useState } from 'react'
import { getCachedDataAge, formatCachedAt } from '../services/offline.js'
import './OfflineBanner.css'

/**
 * "You are offline — showing information from 4:20 PM."
 *
 * Shown across all three portals whenever the browser reports no network.
 * The point is the TIME, not the word "offline": a resident deciding whether
 * to walk to a shelter needs to know whether the road conditions they are
 * reading are five minutes old or five hours old. Without that, stale data
 * is indistinguishable from live data, which is the more dangerous failure —
 * the app looks like it is working and quietly tells you yesterday's news.
 *
 * Deliberately not dismissable. It occupies one line and it is the only
 * signal that what is on screen may no longer be true.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [cachedAt, setCachedAt] = useState(null)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  // Only ask the worker when we actually go offline — there is no reason to
  // wake it on every render while the network is fine.
  useEffect(() => {
    if (!offline) { setCachedAt(null); return }
    let alive = true
    getCachedDataAge().then((iso) => { if (alive) setCachedAt(iso) })
    return () => { alive = false }
  }, [offline])

  if (!offline) return null

  const stamp = formatCachedAt(cachedAt)

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 1l22 22" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span>
        <b>You are offline.</b>{' '}
        {stamp
          ? <>Showing information saved at {stamp}. It may have changed.</>
          : <>Only previously loaded resources may be available. Current safety data cannot be verified.</>}
        {' '}Road conditions and reports include simulated records.
      </span>
    </div>
  )
}
