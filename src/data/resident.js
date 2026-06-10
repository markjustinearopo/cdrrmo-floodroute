/* ============================================================
   Resident-portal session helpers.

   A Resident is a citizen of one barangay (chosen at registration).
   The portal is READ-ONLY: residents consume the same live picture the
   command center and barangay officials produce — risk, alerts, road
   conditions, published evacuation routes and open shelters — scoped to
   their own area. Nothing is demo data; every screen pulls from the
   shared backend and renders an empty state until it answers.

   The barangay a resident belongs to lives in the same place an
   official's does (the user record / the value stored at sign-up), so
   these helpers simply re-expose the shared barangay helpers under
   resident-friendly names.
   ============================================================ */

import {
  getOfficialBarangay,
  officialBarangayLabel,
  safeGet,
  safeSend,
  brgyQuery,
  OFFICIAL_BRGY_KEY,
} from './barangay.js'

export const getResidentBarangay = getOfficialBarangay
export const residentBarangayLabel = officialBarangayLabel
export { safeGet, safeSend, brgyQuery, OFFICIAL_BRGY_KEY }
