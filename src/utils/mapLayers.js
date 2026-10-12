export const MAX_MAP_LAYERS = 3
export function limitMapLayers(value, keys = Object.keys(value || {})) {
  let count = 0
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    keys.map((key) => [key, Boolean(source[key]) && count++ < MAX_MAP_LAYERS]),
  )
}
export function updateMapLayers(current, update, keys) {
  const safe = limitMapLayers(current, keys)
  const next = typeof update === 'function' ? update(safe) : update
  const added = Object.keys(next || {}).some((k) => keys.includes(k) && next[k] && !safe[k])
  if (added && keys.filter((k) => next[k]).length > MAX_MAP_LAYERS) return safe
  return limitMapLayers(next, keys)
}
