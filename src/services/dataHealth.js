export const SAFETY_COLLECTIONS = ['alerts', 'roadReports', 'roadBlocks', 'evacuationCenters']
export const SAFETY_MAX_AGE_MS = 180_000

export function safetyDataReady(health, now = Date.now()) {
  return SAFETY_COLLECTIONS.every((name) => health[name]?.status === 'ready'
    && now - health[name].lastSuccess < SAFETY_MAX_AGE_MS)
}

export function collectionNamesForRole(role, allNames) {
  if (role === 'admin' || role === 'staff') return allNames
  const publicNames = [...SAFETY_COLLECTIONS, 'savedRoutes', 'floodAreas']
  if (!role) return publicNames
  const ownNames = [...publicNames, 'floodReports', 'rescueRequests', 'users', 'notifications', 'barangayAssignments']
  return role === 'barangay' ? [...ownNames, 'incidents', 'roadChangeRequests'] : ownNames
}

export function retryDelay(failures) {
  return Math.min(300_000, 30_000 * 2 ** Math.min(4, Math.max(0, failures - 1)))
}
