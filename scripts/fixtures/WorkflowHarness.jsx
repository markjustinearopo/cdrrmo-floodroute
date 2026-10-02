import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdminDataProvider, useAdminData } from '../../src/context/AdminDataContext.jsx'
import { useRescueTrigger } from '../../src/hooks/useRescueTrigger.js'
import NoSafeRouteAlert from '../../src/components/resident/NoSafeRouteAlert.jsx'
import DataHealthNotice from '../../src/components/DataHealthNotice.jsx'

function Harness() {
  const rescue = useRescueTrigger()
  const data = useAdminData()
  window.workflow = { rescue, data }
  return <>
    <DataHealthNotice />
    <output id="workflow-status">{data.isLoading ? 'loading' : data.safetyReady ? 'ready' : 'unavailable'}</output>
    <NoSafeRouteAlert open={Boolean(rescue.alert)} location={rescue.alert?.location}
      evidence={rescue.alert?.evidence} summary={rescue.alert?.summary}
      request={rescue.request} sendError={rescue.sendError} filing={rescue.filing}
      onClose={rescue.dismiss} onRetry={rescue.retry} />
  </>
}
createRoot(document.getElementById('workflow-root')).render(<AdminDataProvider><Harness /></AdminDataProvider>)
