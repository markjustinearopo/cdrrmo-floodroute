/* ============================================================
   systemConfig — the ONE runtime source of truth for the settings
   an operator changes on System Configuration.

   Before this, System Configuration saved a blob that nothing read:
   thresholds, distance units, auto-refresh, registration and
   maintenance all persisted but never took effect. Now every screen
   that cares reads the live config from here, and a save propagates
   instantly (same-tab custom event) and across tabs (storage event).

   Transport mirrors the rest of the app: a localStorage cache for an
   instant, synchronous read (used inside hot render paths like
   levelFromDepth) plus the shared Supabase app_settings row so the
   config follows the operator to any device.
   ============================================================ */

import { useSyncExternalStore } from 'react'
import db from './db.js'

const CACHE_KEY = 'cdrrmo_system_config' // localStorage (instant, synchronous)
const DB_KEY = 'system_config'           // shared app_settings row
const EVENT = 'cdrrmo-systemconfig'      // same-tab change signal

/* Defaults — the shipped behaviour. A missing/blank config reads exactly like
   the old hard-coded constants, so wiring these in changes nothing until an
   operator actually edits a value. */
export const SYSTEM_CONFIG_DEFAULTS = {
  systemName: 'CDRRMO FloodRoute',
  organization: 'Cabuyao City CDRRMO',
  timezone: 'Asia/Manila',
  language: 'en',
  dateFormat: 'dmy',
  depthLow: 0.1,
  depthModerate: 0.3,
  depthHigh: 0.5,
  mapZoom: 13,
  distanceUnit: 'km',
  retentionDays: 90,
  autoRefresh: true,
  maintenance: false,
  allowRegistration: true,
  debugLogging: false,
}

/* ── Synchronous cache ──────────────────────────────────────────────────── */
let cache = readCache()

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY))
    return { ...SYSTEM_CONFIG_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  } catch {
    return { ...SYSTEM_CONFIG_DEFAULTS }
  }
}

/** Current config, merged over defaults. Safe to call in a render hot path. */
export function getSystemConfig() {
  return cache
}

/* ── Change notification (same tab + cross tab) ─────────────────────────── */
const listeners = new Set()
function emit() {
  cache = { ...cache }
  listeners.forEach((fn) => fn())
}
function subscribe(fn) {
  listeners.add(fn)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}
function onStorage(e) {
  if (e.key === CACHE_KEY) {
    cache = readCache()
    listeners.forEach((fn) => fn())
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener(EVENT, () => {
    cache = readCache()
    listeners.forEach((fn) => fn())
  })
}

/** Subscribe a component to the live config. Re-renders on any save. */
export function useSystemConfig() {
  return useSyncExternalStore(subscribe, getSystemConfig, getSystemConfig)
}

/* ── Writers ────────────────────────────────────────────────────────────── */
/** Persist the config: instant local cache + broadcast + shared backend. */
export function saveSystemConfig(cfg) {
  const merged = { ...SYSTEM_CONFIG_DEFAULTS, ...cfg }
  localStorage.setItem(CACHE_KEY, JSON.stringify(merged))
  cache = merged
  window.dispatchEvent(new Event(EVENT))
  return db.appSettings.set(DB_KEY, merged).catch((e) => {
    console.error('[systemConfig] remote save failed', e)
  })
}

/** Revert to the shipped defaults everywhere. */
export function resetSystemConfig() {
  localStorage.removeItem(CACHE_KEY)
  cache = { ...SYSTEM_CONFIG_DEFAULTS }
  window.dispatchEvent(new Event(EVENT))
  return db.appSettings.remove(DB_KEY).catch((e) => {
    console.error('[systemConfig] remote reset failed', e)
  })
}

/** Pull the shared config from Supabase, refresh the cache, return it. */
export async function loadSystemConfigRemote() {
  try {
    const remote = await db.appSettings.get(DB_KEY)
    if (remote && typeof remote === 'object') {
      const merged = { ...SYSTEM_CONFIG_DEFAULTS, ...remote }
      localStorage.setItem(CACHE_KEY, JSON.stringify(merged))
      cache = merged
      window.dispatchEvent(new Event(EVENT))
      return merged
    }
  } catch (e) {
    console.error('[systemConfig] remote load failed', e)
  }
  return cache
}

/* ── Derived helpers consumed across the app ────────────────────────────── */

/** Live flood-depth thresholds (metres), coherent + ascending, with fallbacks. */
export function liveThresholds() {
  const c = cache
  const low = Number(c.depthLow)
  const moderate = Number(c.depthModerate)
  const high = Number(c.depthHigh)
  return {
    low: Number.isFinite(low) ? low : SYSTEM_CONFIG_DEFAULTS.depthLow,
    moderate: Number.isFinite(moderate) ? moderate : SYSTEM_CONFIG_DEFAULTS.depthModerate,
    high: Number.isFinite(high) ? high : SYSTEM_CONFIG_DEFAULTS.depthHigh,
  }
}

/**
 * Risk class from a modeled flood depth (m), using the OPERATOR-configured
 * thresholds. This is the single implementation every screen delegates to, so
 * changing a threshold on System Configuration re-grades every badge at once.
 */
export function levelFromDepth(depth) {
  const t = liveThresholds()
  if (depth >= t.high) return 'high'
  if (depth >= t.moderate) return 'moderate'
  if (depth >= t.low) return 'low'
  return 'safe'
}

/** Format a distance in metres honouring the configured unit (km / miles). */
export function formatDistance(m) {
  if (!m) return cache.distanceUnit === 'mi' ? '0 mi' : '0 m'
  if (cache.distanceUnit === 'mi') {
    const miles = m / 1609.344
    return miles < 0.1 ? `${Math.round(m * 3.28084)} ft` : `${miles.toFixed(2)} mi`
  }
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}
