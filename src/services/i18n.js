/* ============================================================
   i18n — lightweight English / Filipino switch for the admin UI.

   The "Default Language" select on System Configuration finally does
   something: components call t('English source') and get the Filipino
   string when the operator picks Filipino, or the original English
   otherwise. Keying by the English source means any string that isn't
   translated yet simply stays English — nothing ever breaks, and the
   dictionary can grow page by page.

   Language is read live from the shared systemConfig service, so
   switching it re-renders every screen that uses useT() instantly.
   ============================================================ */

import { useSystemConfig } from './systemConfig.js'

/* Filipino (Tagalog) strings, keyed by their English source. Kept flat and
   grouped by area for easy extension. Missing keys fall back to English. */
const FIL = {
  // ── Sidebar sections ──
  Monitor: 'Pagsubaybay',
  Routing: 'Ruta',
  Manage: 'Pamahalaan',
  Settings: 'Mga Setting',

  // ── Sidebar items ──
  Dashboard: 'Dashboard',
  'Flood Map': 'Mapa ng Baha',
  'Flood-Prone Areas': 'Mga Lugar na Bahain',
  'Hazard Layer': 'Layer ng Panganib',
  Reports: 'Mga Ulat',
  'Auto Route': 'Awtomatikong Ruta',
  'Road Status': 'Kalagayan ng Daan',
  'Route Planning': 'Pagpaplano ng Ruta',
  'Override Routes': 'I-override na Ruta',
  'Saved Routes': 'Mga Nakaimbak na Ruta',
  Alerts: 'Mga Alerto',
  Barangay: 'Barangay',
  'Flood Reports': 'Mga Ulat ng Baha',
  Incidents: 'Mga Insidente',
  Evacuation: 'Paglikas',
  'User Management': 'Pamamahala ng User',
  'System Configuration': 'Konpigurasyon ng Sistema',
  'Permissions & Roles': 'Pahintulot at Tungkulin',
  'API Integrations': 'API na Integrasyon',
  'Alert Settings': 'Setting ng Alerto',
  Signout: 'Mag-sign out',

  // ── Topbar / banners ──
  'Flood Alert Active:': 'Aktibong Alerto sa Baha:',
  'Flood Status:': 'Kalagayan ng Baha:',
  'No active flood issue reported.': 'Walang aktibong isyu ng baha.',
  'No elevated flood risk reported.': 'Walang mataas na panganib ng baha.',
  'Rainfall:': 'Ulan:',
  'Wind:': 'Hangin:',
  Updated: 'Na-update',
  'Command Center': 'Command Center',
  'Maintenance mode is ON.': 'Naka-ON ang maintenance mode.',
  'The public-facing app is offline for updates — administrators keep full access.':
    'Offline ang app para sa publiko habang ina-update — buo pa ang akses ng mga administrator.',

  // ── Dashboard: stat cards ──
  'Active Alerts': 'Aktibong Alerto',
  'Blocked Roads': 'Saradong Daan',
  'Current Rainfall': 'Kasalukuyang Ulan',

  // ── Dashboard: sections ──
  'Rainfall Trend': 'Takbo ng Ulan',
  'Live · last 8 hours (Open-Meteo) · mm/hr': 'Live · nakaraang 8 oras (Open-Meteo) · mm/oras',
  Now: 'Ngayon',
  'City Flood Risk': 'Panganib ng Baha sa Lungsod',
  'All {n} barangays, by class': 'Lahat ng {n} barangay, ayon sa uri',
  'Barangay Risk Skyline': 'Skyline ng Panganib ng Barangay',
  '3D view · tower height = modeled flood depth · click one for its profile':
    '3D view · taas ng tore = tinatayang lalim ng baha · pindutin para sa profile',
  'Live · Open-Meteo model': 'Live · modelo ng Open-Meteo',
  'Active Hazard Alerts': 'Aktibong Alerto sa Panganib',
  'Real-time alert feed · click an alert for details': 'Real-time na alerto · pindutin para sa detalye',
  'Issue Alert': 'Maglabas ng Alerto',
  'No active alerts.': 'Walang aktibong alerto.',
  'View All Alerts': 'Tingnan Lahat ng Alerto',
  'Barangay Flood Status': 'Kalagayan ng Baha sa Barangay',
  'Current monitoring · All {n} Barangays · click one for its profile':
    'Kasalukuyang pagsubaybay · Lahat ng {n} Barangay · pindutin para sa profile',
  'Depths are model estimates (Open-Meteo + terrain), not sensor readings.':
    'Ang lalim ay tinatayang modelo (Open-Meteo + terrain), hindi mula sa sensor.',
  'View All Barangays': 'Tingnan Lahat ng Barangay',
  'Road Status': 'Kalagayan ng Daan',
  'Click a road on the map to flag it': 'Pindutin ang daan sa mapa para i-flag',
  'Tag as': 'I-tag bilang',
  Flooded: 'Binabaha',
  Closed: 'Sarado',
  Passable: 'Madadaanan',
  'Open Road Status': 'Buksan ang Kalagayan ng Daan',
  'Flagged Roads': 'Mga Na-flag na Daan',
  'No roads flagged yet. Click a road on the map.': 'Wala pang na-flag na daan. Pindutin ang daan sa mapa.',
  'Click a road to mark it': 'Pindutin ang daan para markahan',

  // ── Dashboard: flood insight bar ──
  'Flood Insight :': 'Pananaw sa Baha :',
  'Barangays affected': 'Barangay na apektado',
  Barangays: 'Barangay',
  High: 'Mataas',
  Moderate: 'Katamtaman',
  Low: 'Mababa',
  'Clear Filter': 'I-clear ang Filter',

  // ── Risk classes / shared ──
  Safe: 'Ligtas',
  overall: 'kabuuan',
  Live: 'Live',
}

const DICTS = { fil: FIL }

/**
 * Translate an English source string for a language.
 * `vars` fills {name} placeholders (works in both languages).
 */
export function translate(key, lang = 'en', vars) {
  let s = (lang !== 'en' && DICTS[lang] && DICTS[lang][key]) || key
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k])
  return s
}

/** Hook: returns a `t(key, vars)` bound to the operator's current language. */
export function useT() {
  const { language } = useSystemConfig()
  return (key, vars) => translate(key, language || 'en', vars)
}
