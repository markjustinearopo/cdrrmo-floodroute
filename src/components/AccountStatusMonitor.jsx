import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api.js'
import supabase from '../services/supabase.js'
import { ACCOUNT_NOTICE_KEY, statusMessage } from '../services/accountStatus.js'

// Independent of dashboard auto-refresh: access checks must keep running when
// operators pause data refresh. Recheck when returning to a background tab.
export default function AccountStatusMonitor() {
  const navigate = useNavigate()
  useEffect(() => {
    let disposed = false
    const pending = new Set()
    async function check() {
      const token = api.getToken()
      if (!token || document.hidden || !navigator.onLine || pending.has(token)) return
      pending.add(token)
      try {
        const { data, error } = await supabase.functions.invoke('account-status', { body: {} })
        if (disposed || api.getToken() !== token || error || !data || data.sessionCurrent !== false) return
        const resident = api.getUser()?.role === 'resident'
        sessionStorage.setItem(ACCOUNT_NOTICE_KEY, statusMessage(data.status))
        api.clearToken()
        navigate(resident ? '/community' : '/login', { replace: true })
      } catch { /* Network failure is not evidence of suspension. RLS still enforces access. */ }
      finally { pending.delete(token) }
    }
    check()
    const interval = setInterval(check, 15_000)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    window.addEventListener('cdrrmo-session', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      disposed = true
      clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      window.removeEventListener('cdrrmo-session', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [navigate])
  return null
}
