import { useState, useEffect } from 'react'

/**
 * Drop-in replacement for useState that persists its value in localStorage
 * using JSON serialization. Works for objects, arrays, booleans and numbers.
 * State survives page navigation and logout because it lives in localStorage,
 * not in session or React state alone.
 *
 * @param {string} key           - Unique localStorage key (use cdrrmo-layers-* prefix)
 * @param {*}      defaultValue  - Initial value when nothing is stored yet
 */
export function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw)
    } catch {}
    return defaultValue
  })

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)) } catch {}
  }, [key, state])

  return [state, setState]
}
