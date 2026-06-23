import { Navigate, Outlet } from 'react-router-dom'
import api from '../services/api.js'

/* Which accounts.role belongs to which portal. (accounts.role is constrained to
   admin/staff/barangay/resident; the extra keys are tolerated for safety.) */
const ROLE_GROUP = {
  admin: 'admin', staff: 'admin', operator: 'admin', viewer: 'admin',
  barangay: 'barangay', officer: 'barangay',
  resident: 'resident',
}
const HOME = {
  admin: '/admin/dashboard',
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
  if (!user || !api.getToken()) return <Navigate to="/login" replace />

  const userGroup = ROLE_GROUP[user.role]
  if (group && userGroup && userGroup !== group) {
    return <Navigate to={HOME[userGroup] || '/login'} replace />
  }
  return <Outlet />
}
