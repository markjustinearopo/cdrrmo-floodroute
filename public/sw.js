/* ============================================================================
   Service worker — make the resident portal work with no network.

   WHY THIS EXISTS
   The people this system is for are on a phone, on mobile data, in a storm.
   That is exactly when a network drops, and until now a dropped network meant
   a blank screen: no shelter list, no road conditions, no last alert, nothing.
   A stale route to an evacuation centre is enormously more useful than a
   spinner, and "the water is rising, my phone says nothing" is the failure
   this whole project exists to prevent.

   WHY IT IS HAND-WRITTEN AND NOT vite-plugin-pwa
   The plugin generates a precache manifest of content-hashed filenames at
   build time. That is the better tool for a normal app, but it means adding a
   build-time dependency and a new failure mode to the pipeline. This does the
   same job with runtime caching instead: nothing is precached by filename, so
   nothing needs to know the hashes — assets are cached the first time they are
   fetched, and served from cache after that. Simpler to audit, and the build
   cannot break because of it.

   CACHING STRATEGY, per resource, and why each one differs:

     Navigation (HTML)    network-first, cache fallback.
                          The app shell must be able to update — cache-first
                          here would pin people to an old build forever.
                          Offline, we serve the last shell we saw.

     Hashed assets        cache-first.
     (JS / CSS)           Vite content-hashes these, so a given URL's bytes
                          never change. Safe to serve from cache immediately
                          and never revalidate.

     Map tiles            stale-while-revalidate.
                          Serve the cached tile instantly, refresh in the
                          background. Tiles change rarely and a slightly old
                          basemap is not a safety problem. Capped, because an
                          unbounded tile cache will eat a cheap phone's
                          storage — see TILE_CACHE_LIMIT.

     Supabase reads       network-first, cache fallback.
     (GET only)           Fresh data when there is a network; the last known
                          alerts / shelters / road status when there is not.
                          The UI says which it is showing — see
                          src/components/OfflineBanner.jsx. NEVER cache
                          non-GET: a queued POST replayed later could issue a
                          duplicate alert.

   WHAT IS DELIBERATELY NOT CACHED
     · Anything to /auth-otp, /functions/ — sign-in, one-time codes, SMS.
       Serving a cached auth response would be both broken and dangerous.
     · Any request carrying an Authorization header we would have to store.
       We cache the RESPONSE body only, never credentials.
   ============================================================================ */

const VERSION = 'v2'
const SHELL_CACHE = `cdrrmo-shell-${VERSION}`
const ASSET_CACHE = `cdrrmo-assets-${VERSION}`
const TILE_CACHE = `cdrrmo-tiles-${VERSION}`
const DATA_CACHE = `cdrrmo-data-${VERSION}`

const CACHES = [SHELL_CACHE, ASSET_CACHE, TILE_CACHE, DATA_CACHE]

/* A cheap phone has little room to spare, and map tiles are the one thing here
   that grows without bound. Roughly a few hundred tiles — enough for Cabuyao
   at the zooms residents actually use, not enough to matter on a 16 GB phone. */
const TILE_CACHE_LIMIT = 300

self.addEventListener('install', (event) => {
  // Take over as soon as this build is ready rather than waiting for every
  // old tab to close: during an emergency nobody is going to close tabs.
  self.skipWaiting()
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/'])).catch(() => {}),
  )
})

/**
 * Cache the entry bundle and stylesheet by reading them out of the shell.
 *
 * WHY THIS IS NECESSARY, and it is not obvious:
 * A service worker does not control the page that installs it. On a first
 * visit the browser has already requested /assets/index-<hash>.js before this
 * worker activates, so that request never passes through the fetch handler and
 * never lands in the cache. Every LATER chunk does get cached, which produces
 * the worst possible result offline: the shell HTML loads from cache, asks for
 * an entry bundle that was never stored, and the reader gets a blank screen —
 * an app that looks installed and does nothing.
 *
 * Vite writes the entry URLs into index.html, so the worker fetches the shell
 * once at activation and takes the hashed names from it. No build-time
 * manifest, no plugin, and it stays correct across rebuilds because it reads
 * whatever the current shell actually references.
 */
async function precacheEntryAssets() {
  try {
    const res = await fetch('/', { cache: 'reload' })
    if (!res.ok) return
    const shell = await res.clone().text()
    await (await caches.open(SHELL_CACHE)).put('/', res)

    const urls = [...shell.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)]
      .map((m) => m[1])
    if (!urls.length) return

    const cache = await caches.open(ASSET_CACHE)
    // Individually, not cache.addAll: one 404 must not throw away the rest.
    await Promise.all(urls.map(async (u) => {
      try {
        const asset = await fetch(u)
        if (asset.ok) await cache.put(u, asset)
      } catch { /* offline at activation — the fetch handler will catch it later */ }
    }))
  } catch { /* no network at activation; nothing to precache yet */ }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((n) => n.startsWith('cdrrmo-') && !CACHES.includes(n))
        .map((n) => caches.delete(n)),
    )
    await self.clients.claim()
    await precacheEntryAssets()
  })())
})

/** Keep a cache from growing without bound: oldest entries go first. */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)))
}

function isMapTile(url) {
  return /tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.|\/tiles?\//i.test(url.host + url.pathname)
    || /api\.mapbox\.com/i.test(url.host)
}

function isHashedAsset(url) {
  // Vite emits /assets/name-<hash>.js|css — the hash makes the URL immutable.
  return url.pathname.startsWith('/assets/') && /\.(js|css|woff2?|png|svg|jpg|webp)$/i.test(url.pathname)
}

function isSupabaseRead(url) {
  return /\.supabase\.co$/i.test(url.host) && url.pathname.startsWith('/rest/')
}

function isPublicDataRead(url, request) {
  const table = url.pathname.split('/')[3]
  let anonymous = !request.headers.has('authorization')
  try {
    const token = request.headers.get('authorization').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    anonymous = payload.role === 'anon'
  } catch { /* Unknown bearer formats are never cached. */ }
  return isSupabaseRead(url) && anonymous
    && ['alerts', 'evacuation_centers', 'road_status', 'road_blocks', 'barangays', 'hazard_zones'].includes(table)
}

function isNeverCache(url) {
  // Auth, one-time codes, SMS/email dispatch: always live, never replayed.
  return url.pathname.includes('/functions/')
    || url.pathname.includes('/auth/')
    || url.pathname.includes('auth-otp')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return // never cache or replay a write

  let url
  try { url = new URL(request.url) } catch { return }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (isNeverCache(url)) return

  // ── App shell / navigation: network-first so updates land ────────────────
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        const cache = await caches.open(SHELL_CACHE)
        cache.put('/', fresh.clone())
        return fresh
      } catch {
        const cached = await caches.match('/', { cacheName: SHELL_CACHE })
        return cached || Response.error()
      }
    })())
    return
  }

  // ── Hashed build assets: cache-first, they are immutable ─────────────────
  if (isHashedAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: ASSET_CACHE })
      if (cached) return cached
      const fresh = await fetch(request)
      if (fresh.ok) (await caches.open(ASSET_CACHE)).put(request, fresh.clone())
      return fresh
    })())
    return
  }

  // ── Map tiles: stale-while-revalidate, capped ────────────────────────────
  if (isMapTile(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: TILE_CACHE })
      const network = fetch(request).then(async (res) => {
        if (res.ok) {
          const cache = await caches.open(TILE_CACHE)
          await cache.put(request, res.clone())
          trimCache(TILE_CACHE, TILE_CACHE_LIMIT)
        }
        return res
      }).catch(() => null)
      return cached || (await network) || Response.error()
    })())
    return
  }

  // ── Supabase reads: network-first, fall back to last known ───────────────
  if (isPublicDataRead(url, request)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request)
        if (fresh.ok) {
          const cache = await caches.open(DATA_CACHE)
          // Stamp when this landed so the UI can say how old it is.
          const body = await fresh.clone().blob()
          const headers = new Headers(fresh.headers)
          headers.set('x-cdrrmo-cached-at', new Date().toISOString())
          await cache.put(new Request(request.url), new Response(body, {
            status: fresh.status, statusText: fresh.statusText, headers,
          }))
        }
        return fresh
      } catch {
        const cached = await caches.match(new Request(request.url), { cacheName: DATA_CACHE })
        if (cached) return cached
        throw new Error('offline and nothing cached for this request')
      }
    })())
  }
})

/* The page asks how old its data is, so the offline banner can name a time
   instead of just saying "offline" — "showing information from 4:20 PM" is
   something a person can act on. */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CDRRMO_CLEAR_PRIVATE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('cdrrmo-data-')).map((key) => caches.delete(key)))))
    return
  }
  if (event.data?.type !== 'CDRRMO_CACHE_AGE') return
  event.waitUntil((async () => {
    const cache = await caches.open(DATA_CACHE)
    const keys = await cache.keys()
    let newest = null
    for (const k of keys) {
      const res = await cache.match(k)
      const at = res?.headers.get('x-cdrrmo-cached-at')
      if (at && (!newest || at > newest)) newest = at
    }
    event.source?.postMessage({ type: 'CDRRMO_CACHE_AGE', cachedAt: newest })
  })())
})
