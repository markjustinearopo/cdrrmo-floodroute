/* ============================================================
   SaveErrorToast — "that change did NOT save".

   Every mutation in this app is optimistic: the record appears
   immediately and the write goes to Supabase in the background. When
   that write fails, the reconciling refetch removes the record again.
   Without this toast the whole sequence is silent — an operator issues
   an alert, watches it appear, watches it disappear, and has no reason
   to think the city was not warned.

   Deliberately NOT auto-dismissed: a lost write is not an ambient
   notification, it is something the operator has to see and act on. It
   stays until dismissed.
   ============================================================ */

import './SaveErrorToast.css'

/* Collection key → what the operator actually did. */
const WHAT = {
  alerts: 'The alert was not saved',
  incidents: 'The incident was not saved',
  floodReports: 'The flood report was not saved',
  evacuationCenters: 'The evacuation centre was not saved',
  users: 'The account was not saved',
  roadReports: 'The road condition was not saved',
  savedRoutes: 'The route was not saved',
  floodAreas: 'The flood-prone area was not saved',
  notifications: 'The notification was not saved',
  integrations: 'The integration setting was not saved',
  barangayAssignments: 'The barangay assignment was not saved',
  roadChangeRequests: 'The road change request was not saved',
}

export default function SaveErrorToast({ error, onDismiss }) {
  if (!error) return null
  const title = WHAT[error.collection] || 'That change was not saved'

  return (
    <div className="save-err" role="alert" aria-live="assertive">
      <span className="save-err-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </span>
      <span className="save-err-body">
        <b>{title}</b>
        <small>{error.message}</small>
        <small className="save-err-hint">
          It was rolled back and is NOT in the database. Try again, or contact CDRRMO IT support.
        </small>
      </span>
      <button type="button" className="save-err-x" onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}
