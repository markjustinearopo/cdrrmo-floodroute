import { useCallback } from 'react'
import { usePersistedState } from '../utils/usePersistedState.js'
import { limitMapLayers, updateMapLayers } from '../utils/mapLayers.js'
export function useMapLayers(key, defaults) {
  const [stored, setStored] = usePersistedState(key, defaults)
  const keyNames = Object.keys(defaults).join('|')
  const layers = limitMapLayers(stored, keyNames.split('|'))
  const setLayers = useCallback(
    (update) => setStored((current) => updateMapLayers(current, update, keyNames.split('|'))),
    [setStored, keyNames],
  )
  return [layers, setLayers]
}
