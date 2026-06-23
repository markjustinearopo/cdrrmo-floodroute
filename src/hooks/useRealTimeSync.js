/* ============================================================
   useRealTimeSync — the admin topbar's "live" chip.

   The actual data polling + Supabase realtime subscription now live in
   AdminDataProvider, so EVERY portal (admin / barangay / resident) stays
   in sync without each one wiring its own timer. This hook is just the
   admin chip's view of that: it exposes `lastUpdated` (bumped only when
   data really changes), an "X seconds ago" label that re-ticks every
   second, and a manual `refresh()` for the topbar button.
   ============================================================ */

import { useEffect, useState } from 'react'
import { useAdminData } from '../context/AdminDataContext.jsx'

export function relativeTime(ts) {
  if (!ts) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

export function useRealTimeSync() {
  const { lastUpdated, refresh } = useAdminData()
  const [, setTick] = useState(0)

  // Re-render every second so the "X seconds ago" label stays current.
  // (Polling + realtime sync are handled centrally in AdminDataProvider.)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return { lastUpdated, refresh, label: relativeTime(lastUpdated) }
}
