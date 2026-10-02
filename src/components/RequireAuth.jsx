import { Navigate, Outlet } from 'react-router-dom'
import api from '../services/api.js'
import FirstLoginPasswordPrompt from './FirstLoginPasswordPrompt.jsx'

/* Which accounts.role belongs to which portal. (accounts.role is constrained to
   admin/staff/barangay/resident; the extra keys are tolerated for safety.) */
const ROLE_GROUP = {
  admin: 'admin', staff: 'admin', operator: 'admin', viewer: 'admin',
  barangay: 'barangay', officer: 'barangay',
  resident: 'resident',
}
const HOME = {
  // The map, not the dashboard — see getRoleForRedirect in services/api.js.
  admin: '/admin/flood-map',
  barangay: '/barangay/dashboard',
  resident: '/resident/dashboard',
}

/**
 * Route guard used as a layout route in App.jsx. Renders the nested portal
 * routes only for a signed-in user whose role belongs to `group`. Otherwise it
 * redirects to /login (no session) or to the user's own portal home (signed in
 * but trying to reach a portal they don't belong to). This stops direct-URL
 * access to dashboards by unauthenticated users.
 */
export default function RequireAuth({ group }) {
  const user = api.getUser()
  /* Deliberately not checking api.getToken() here too: the break-glass
     fallback (services/api.js, legacyLogin) starts a session with a user but
     no signed token, since it has no path to the signing secret. Whether a
     request actually succeeds against Postgres is decided server-side by RLS
     (see supabase/PENDING_MIGRATIONS.sql, 2026-08-30 section) — this guard is
     only ever a client-side routing convenience, never enforcement. */
  if (!user) return <Navigate to="/login" replace />

  const userGroup = ROLE_GROUP[user.role]
  if (!userGroup) return <Navigate to="/login" replace />
  if (group && userGroup && userGroup !== group) {
    return <Navigate to={HOME[userGroup] || '/login'} replace />
  }
  return (
    <>
      <Outlet />
      {/* Greets officials on their first sign-in to set their own password. */}
      <FirstLoginPasswordPrompt />
    </>
  )
}
