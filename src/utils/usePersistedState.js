import { useState, useEffect } from 'react'

/** True for a plain `{}` object — not an array, not null, not a class instance. */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Drop-in replacement for useState that persists its value in localStorage
 * using JSON serialization. Works for objects, arrays, booleans and numbers.
 * State survives page navigation and logout because it lives in localStorage,
 * not in session or React state alone.
 *
 * OBJECT DEFAULTS ARE MERGED, not replaced. This matters: these keys hold the
 * map layer-toggle bags, and the stored value was previously used verbatim.
 * So the moment a new layer was added to a map, every returning user — anyone
 * with a stored value from before — got `undefined` for it, which reads as OFF.
 * The layer was shipped and invisible, with no way to discover the switch had
 * ever existed. Merging the stored object OVER the default means new keys
 * arrive at their intended default while every choice the user already made is
 * kept, and no version-key bump is needed to ship a layer.
 *
 * @param {string} key           - Unique localStorage key (use cdrrmo-layers-* prefix)
 * @param {*}      defaultValue  - Initial value when nothing is stored yet
 */
export function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        const stored = JSON.parse(raw)
        if (isPlainObject(defaultValue) && isPlainObject(stored)) {
          return { ...defaultValue, ...stored }
        }
        return stored
      }
    } catch {
      /* corrupt entry / private mode — fall through to the default */
    }
    return defaultValue
  })

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)) } catch {}
  }, [key, state])

  return [state, setState]
}
