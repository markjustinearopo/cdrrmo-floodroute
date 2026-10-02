export function alertScopes(barangay: unknown, barangays: unknown) {
  const values = Array.isArray(barangays) && barangays.length ? barangays : barangay ? [barangay] : ['All']
  if (values.length > 18 || values.some((value) => typeof value !== 'string' || !/^[a-zA-Z0-9 .'-]{1,100}$/.test(value))) throw new Error('Invalid barangay scope.')
  if (values.some((value) => value === 'All' || value === 'All Barangays')) return []
  return [...new Set(values as string[])]
}
