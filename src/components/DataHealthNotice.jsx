import { useAdminData } from '../context/AdminDataContext.jsx'
import './dataHealthNotice.css'

export default function DataHealthNotice() {
  const { dataHealth, safetyReady, isLoading, refresh } = useAdminData()
  const failures = Object.values(dataHealth).filter((entry) => entry.status === 'error')
  if (isLoading || (safetyReady && !failures.length)) return null
  return (
    <section className="data-health-notice" role="alert">
      <div>
        <strong>{safetyReady ? 'Some records are unavailable.' : 'Current safety data cannot be verified.'}</strong>
        <p>{safetyReady ? 'Some sections may be incomplete or out of date.'
          : 'Missing records do not mean there are no hazards. Route guidance is paused; check with CDRRMO.'}</p>
      </div>
      <button type="button" onClick={refresh}>Retry</button>
    </section>
  )
}
