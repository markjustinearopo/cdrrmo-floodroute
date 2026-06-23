/* ============================================================
   External-service catalogue for API Integrations.

   Pulled out of the Integrations settings screen so the Flood Map's
   System Modules panel can render the same services with live status.
   Only the DYNAMIC part (enabled / status / configured values) is
   persisted by AdminDataContext — this catalogue is the fixed copy:
   names, categories, descriptions and the fields each Configure
   modal renders. `fields` drive the modal; the first non-secret
   field is echoed (masked where needed) on the card.
   ============================================================ */

export const INTEGRATION_CATALOG = [
  {
    id: 'weather', name: 'Open-Meteo · Weather & Wind', category: 'Data Feed', icon: 'cloud',
    desc: 'Live rainfall, wind and 7-day forecast from the keyless Open-Meteo Forecast API — feeds the header chips, dashboards and the flood-risk model. An API key is optional (only needed for higher rate limits).',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://api.open-meteo.com/v1/forecast' },
      { key: 'apiKey', label: 'Open-Meteo API Key', type: 'password', placeholder: 'Optional — keyless by default' },
    ],
    enabled: true, status: 'connected',
    values: { endpoint: 'https://api.open-meteo.com/v1/forecast' },
    // Keyless endpoint a "Test connection" probe can actually reach.
    testUrl: 'https://api.open-meteo.com/v1/forecast?latitude=14.27&longitude=121.13&current=rain',
  },
  {
    id: 'floodhub', name: 'Open-Meteo · Flood Forecast', category: 'Data Feed', icon: 'activity',
    desc: 'River-discharge & flood forecast from the keyless Open-Meteo Flood API (GloFAS / Copernicus model) — feeds the real-time hazard layer and flood-aware routing. An API key is optional (only needed for higher rate limits).',
    fields: [
      { key: 'endpoint', label: 'API Endpoint', type: 'text', placeholder: 'https://flood-api.open-meteo.com/v1/flood' },
      { key: 'apiKey', label: 'Open-Meteo API Key', type: 'password', placeholder: 'Optional — keyless by default' },
    ],
    enabled: true, status: 'connected',
    values: { endpoint: 'https://flood-api.open-meteo.com/v1/flood' },
    testUrl: 'https://flood-api.open-meteo.com/v1/flood?latitude=14.27&longitude=121.13&daily=river_discharge&forecast_days=1',
  },
  {
    id: 'email', name: 'Email Alerts (Resend)', category: 'Notifications', icon: 'mail',
    desc: 'Send flood alert emails via Supabase Edge Functions + Resend. Free tier: 3,000 emails/month. Add your RESEND_API_KEY as a Supabase secret, then enter it below to connect.',
    fields: [
      { key: 'apiKey', label: 'Resend API Key', type: 'password', placeholder: 're_••••••••' },
      { key: 'fromEmail', label: 'From Address', type: 'text', placeholder: 'CDRRMO Alerts <alerts@cabuyao.gov.ph>' },
    ],
    enabled: false, status: 'disconnected',
  },
  {
    id: 'maptiles', name: 'Map Tiles', category: 'Mapping', icon: 'map',
    desc: 'Base map imagery for the Flood Map, Hazard Layer and routing screens.',
    fields: [
      { key: 'endpoint', label: 'Tile URL Template', type: 'text', placeholder: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
    ],
    enabled: true, status: 'connected',
    values: { endpoint: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
    testUrl: 'https://tile.openstreetmap.org/13/6854/3742.png',
  },
  {
    id: 'push', name: 'Push Notifications', category: 'Notifications', icon: 'bell',
    desc: 'Browser push alerts for staff using the command-center web app.',
    fields: [
      { key: 'publicKey', label: 'VAPID Public Key', type: 'text', placeholder: 'Enter public key' },
      { key: 'privateKey', label: 'VAPID Private Key', type: 'password', placeholder: 'Enter private key' },
    ],
    enabled: false, status: 'disconnected',
  },
]

export const INTEGRATION_STATUS_LABEL = {
  connected: 'Connected',
  disconnected: 'Not Connected',
  error: 'Error',
}

export const INTEGRATION_SECRET_KEYS = new Set(['apiKey', 'password', 'privateKey'])
