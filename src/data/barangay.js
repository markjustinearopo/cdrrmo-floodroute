/* ============================================================
   Barangay-portal session helpers.

   A Barangay Official manages a SINGLE barangay — their own
   jurisdiction. Which barangay that is comes from the logged-in
   user record (the backend returns it on /auth/login) or, until the
   API is wired in, from the barangay they picked on the login screen.

   Nothing here is demo data: collections start empty and every screen
   pulls its live records from the same Node/Express + database backend
   the admin portal uses, so a report filed by a barangay shows up in
   the city command center and vice-versa.
   ============================================================ */

import { useCallback, useState } from 'react'
import api from '../services/api.js'
import { BARANGAY_NAMES } from './cabuyaoBarangays.js'

// Key the login screen writes the chosen barangay to, so the portal can
// scope itself even before the auth backend exists.
export const OFFICIAL_BRGY_KEY = 'cdrrmo_brgy'

// Map of lower-cased name → canonical name, so a stale or differently-cased
// value ('Banay-banay') resolves to the one the rest of the system keys on
// ('Banay-Banay'). The geometry, risk samples and shared records all use the
// canonical spelling, so scoping silently breaks without this.
const CANON_BY_LOWER = new Map(BARANGAY_NAMES.map((n) => [n.toLowerCase(), n]))

/**
 * Normalise any barangay name to the canonical spelling used across the system.
 * Returns the input unchanged if it isn't a known barangay (so non-barangay
 * labels pass through), and '' for empty input.
 */
export function canonicalBarangay(name) {
  if (!name) return ''
  return CANON_BY_LOWER.get(String(name).trim().toLowerCase()) || name
}

/**
 * The barangay this official governs. Prefers the authenticated user's
 * record, falling back to the login selection. Empty string when unknown
 * (e.g. the portal was opened directly without signing in). Always returned in
 * the canonical spelling so map/risk/record scoping lines up.
 */
export function getOfficialBarangay() {
  const user = api.getUser?.()
  return canonicalBarangay(user?.barangay || localStorage.getItem(OFFICIAL_BRGY_KEY) || '')
}

/** A safe display label for the header/titles when no barangay is set yet. */
export function officialBarangayLabel() {
  return getOfficialBarangay() || 'Your Barangay'
}

// Map jurisdiction preference: 'mine' (locked to the official's own barangay
// border) or 'city' (whole-city situational context). Persisted per browser so
// the choice carries across the barangay map screens.
const JURISDICTION_KEY = 'cdrrmo_jurisdiction'

/**
 * The barangay map jurisdiction toggle, modeled on use3DPreference(): returns
 * `[view, setView]` where view is 'mine' | 'city'. Defaults to 'mine' so an
 * official is confined to their own jurisdiction unless they opt into the
 * city-wide context view.
 */
export function useJurisdictionView() {
  const [view, setViewState] = useState(
    () => (localStorage.getItem(JURISDICTION_KEY) === 'city' ? 'city' : 'mine'),
  )
  const setView = useCallback((v) => {
    const next = v === 'city' ? 'city' : 'mine'
    setViewState(next)
    try {
      localStorage.setItem(JURISDICTION_KEY, next)
    } catch {
      /* private mode */
    }
  }, [])
  return [view, setView]
}
