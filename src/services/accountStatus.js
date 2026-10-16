export const ACCOUNT_NOTICE_KEY = 'cdrrmo_account_notice'

export function accountNotice() {
  try { return sessionStorage.getItem(ACCOUNT_NOTICE_KEY) || '' } catch { return '' }
}

export function statusMessage(status) {
  if (status === 'suspended') return 'Your account is suspended. Contact your barangay or CDRRMO to restore access. You can still use community maps, alerts, road status and evacuation guidance.'
  if (status === 'inactive' || status === 'pending') return `Your account is ${status}. Contact your barangay or CDRRMO for assistance. Community maps and evacuation guidance remain available.`
  return 'Your account session has changed. Please sign in again. Community maps and evacuation guidance remain available.'
}
