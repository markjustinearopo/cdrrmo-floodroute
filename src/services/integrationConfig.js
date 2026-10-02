const FIELDS = new Set(['endpoint', 'provider', 'senderName', 'fromEmail', 'publicKey'])

export function publicIntegrationConfig(config = {}, strict = false) {
  const result = {}
  for (const [key, value] of Object.entries(config || {})) {
    if (!FIELDS.has(key) || typeof value !== 'string') {
      if (strict) throw new Error('Only public integration metadata can be saved. Credentials belong in server secrets.')
      continue
    }
    result[key] = value
  }
  return result
}
