/* ============================================================
   offline.js — service-worker registration + "how stale is this?"

   The service worker (public/sw.js) makes the app survive a dropped network.
   This is the page's half of that: it registers the worker, and it answers
   the question the UI has to be able to answer honestly — is what you are
   looking at live, or is it the last thing we managed to fetch, and when
   was that?

   "Offline" on its own is not actionable. "Showing information from 4:20 PM"
   is: a resident can decide for themselves whether half-hour-old road
   conditions are good enough to set out on.
   ============================================================ */

/** Registered in production only: a service worker in front of the Vite dev
 *  server intercepts HMR and makes edits appear not to apply, which costs
 *  more debugging time than it saves. */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Non-fatal by design: no worker just means no offline support, and an
      // app that still loads is better than one that fails over its cache.
      console.warn('[offline] service worker registration failed', err)
    })
  })
}

/**
 * Ask the service worker for the timestamp of the newest cached API response.
 * Resolves to an ISO string, or null when nothing is cached / no worker.
 */
export function getCachedDataAge(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker?.controller
    if (!sw) return resolve(null)

    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      channel.port1.close()
      resolve(null)
    }, timeoutMs)

    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data?.cachedAt ?? null)
      channel.port1.close()
    }

    // The worker replies via event.source, so a plain postMessage is enough;
    // the MessagePort is here purely to bound the wait.
    navigator.serviceWorker.addEventListener('message', function once(event) {
      if (event.data?.type !== 'CDRRMO_CACHE_AGE') return
      navigator.serviceWorker.removeEventListener('message', once)
      clearTimeout(timer)
      resolve(event.data.cachedAt ?? null)
    })

    sw.postMessage({ type: 'CDRRMO_CACHE_AGE' })
  })
}

/** "4:20 PM" in Manila time, for the offline banner. */
export function formatCachedAt(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  })
}
