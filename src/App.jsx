import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AdminDataProvider } from './context/AdminDataContext.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import SimulationBanner from './components/SimulationBanner.jsx'
import SkipLink from './components/SkipLink.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'

/* ── Portal route trees, lazy ─────────────────────────────────────────────
   Every page below used to be a static import, so visiting /login pulled in
   the full admin command center — Mapbox GL, deck.gl, the report builder,
   every settings tab — before a single byte of the resident's own screen
   loaded. One bundle, 4 MB, for a landing page someone opens on 3G during a
   typhoon.

   React.lazy turns each import into its own chunk, fetched only when that
   route is actually visited. A resident who never opens /admin/* never
   downloads it. This is step one of two: splitting by route stops the wrong
   PAGES from loading; Mapbox/deck.gl specifically are still pulled in by any
   page that imports Map3D (several resident pages do, for the 3D toggle),
   so that is a second, separate pass — see Map3D.jsx and routing3d.js.
   ────────────────────────────────────────────────────────────────────────── */
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard.jsx'))
const AdminFloodMap = lazy(() => import('./pages/admin/FloodMap.jsx'))
const AdminFloodReports = lazy(() => import('./pages/admin/FloodReports.jsx'))
const AdminReports = lazy(() => import('./pages/admin/Reports.jsx'))
const AdminRouting = lazy(() => import('./pages/admin/Routing.jsx'))
const AdminRoadStatus = lazy(() => import('./pages/admin/RoadStatus.jsx'))
const AdminAlerts = lazy(() => import('./pages/admin/Alerts.jsx'))
const AdminIncidents = lazy(() => import('./pages/admin/Incidents.jsx'))
const AdminRescue = lazy(() => import('./pages/admin/Rescue.jsx'))
const AdminEvacuation = lazy(() => import('./pages/admin/Evacuation.jsx'))
const AdminSettings = lazy(() => import('./pages/admin/Settings.jsx'))
const AdminNotifications = lazy(() => import('./pages/admin/Notifications.jsx'))
const BarangayDashboard = lazy(() => import('./pages/barangay/Dashboard.jsx'))
const BarangayFloodMap = lazy(() => import('./pages/barangay/FloodMap.jsx'))
const BarangayHazardLayer = lazy(() => import('./pages/barangay/HazardLayer.jsx'))
const BarangayRoadStatus = lazy(() => import('./pages/barangay/RoadStatus.jsx'))
const BarangayEvacuationRouting = lazy(() => import('./pages/barangay/EvacuationRouting.jsx'))
const BarangayAlerts = lazy(() => import('./pages/barangay/Alerts.jsx'))
const BarangayIncidents = lazy(() => import('./pages/barangay/Incidents.jsx'))
const BarangayEvacuation = lazy(() => import('./pages/barangay/Evacuation.jsx'))
const BarangayOperations = lazy(() => import('./pages/barangay/Operations.jsx'))
const ResidentDashboard = lazy(() => import('./pages/resident/Dashboard.jsx'))
const ResidentFloodMap = lazy(() => import('./pages/resident/FloodMap.jsx'))
const ResidentRoadStatus = lazy(() => import('./pages/resident/RoadStatus.jsx'))
const ResidentEvacuationRouting = lazy(() => import('./pages/resident/EvacuationRouting.jsx'))
const ResidentAlerts = lazy(() => import('./pages/resident/Alerts.jsx'))
const ResidentEvacuation = lazy(() => import('./pages/resident/Evacuation.jsx'))
const ResidentFloodReports = lazy(() => import('./pages/resident/FloodReports.jsx'))

/* Shown for the one moment a lazy chunk is in flight — normally imperceptible
   on a warm cache, real on a cold 3G load, which is exactly the condition
   this whole change is for. Deliberately plain: no logo fetch, no extra
   chunk of its own, just text so it never becomes something else to wait on. */
function RouteLoading() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', color: '#8a8a8a', fontSize: '0.9rem',
    }}>
      Loading…
    </div>
  )
}

/**
 * Web-Based Flood Risk-Aware Route System — route map.
 *
 * Auth pages are converted from the original static codebase.
 * The role dashboards (admin / barangay / resident) are added here
 * as each screen is ported.
 */
export default function App() {
  return (
    // The shared data layer wraps every portal: a record created in the admin
    // command center is the same record the barangay/resident screens read.
    <Suspense fallback={<RouteLoading />}>
    {/* First in the tab order, in every portal: skip the eight-to-eleven
        sidebar links and land on the page itself. */}
    <SkipLink />
    {/* Above everything, in every portal: when the network is gone, say so
        and say how old the data on screen is. Stale information that looks
        live is the more dangerous failure. */}
    <OfflineBanner />
    <SimulationBanner />
    <AdminDataProvider>
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Shared authentication pages */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* CDRRMO Administrator portal — guarded (admin/staff roles). */}
      <Route element={<RequireAuth group="admin" />}>
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/flood-map" element={<AdminFloodMap />} />
        <Route path="/admin/flood-reports" element={<AdminFloodReports />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/routing" element={<AdminRouting />} />
        <Route path="/admin/road-status" element={<AdminRoadStatus />} />
        <Route path="/admin/alerts" element={<AdminAlerts />} />
        <Route path="/admin/incidents" element={<AdminIncidents />} />
        {/* Automatic rescue requests — residents the router could not get out. */}
        <Route path="/admin/rescue" element={<AdminRescue />} />
        <Route path="/admin/evacuation" element={<AdminEvacuation />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/notifications" element={<AdminNotifications />} />

        {/* Settings used to be five separate screens plus the barangay roster.
            Keep the old paths alive for one release so bookmarks and any
            hard-coded links land on the matching tab instead of the login page. */}
        <Route path="/admin/users" element={<Navigate to="/admin/settings?tab=users" replace />} />
        <Route path="/admin/roles" element={<Navigate to="/admin/settings?tab=users" replace />} />
        <Route path="/admin/system-config" element={<Navigate to="/admin/settings" replace />} />
        <Route path="/admin/alert-settings" element={<Navigate to="/admin/settings?tab=alerts" replace />} />
        <Route path="/admin/integrations" element={<Navigate to="/admin/settings?tab=integrations" replace />} />
        <Route path="/admin/barangay" element={<Navigate to="/admin/settings?tab=barangays" replace />} />

        {/* Routing was four screens calling the same engine; they are now tabs. */}
        {/* Hazard Layer and Flood-Prone Areas are layers on the Flood Map now. */}
        <Route path="/admin/hazard-layer" element={<Navigate to="/admin/flood-map" replace />} />
        <Route path="/admin/flood-areas" element={<Navigate to="/admin/flood-map" replace />} />

        <Route path="/admin/auto-route" element={<Navigate to="/admin/routing" replace />} />
        <Route path="/admin/route-planning" element={<Navigate to="/admin/routing?tab=draw" replace />} />
        <Route path="/admin/override-routes" element={<Navigate to="/admin/routing?tab=override" replace />} />
        <Route path="/admin/saved-routes" element={<Navigate to="/admin/routing?tab=saved" replace />} />
      </Route>

      {/* Barangay Official portal — guarded, single-barangay jurisdiction. */}
      <Route element={<RequireAuth group="barangay" />}>
        <Route path="/barangay/dashboard" element={<BarangayDashboard />} />
        <Route path="/barangay/flood-map" element={<BarangayFloodMap />} />
        <Route path="/barangay/hazard-layer" element={<BarangayHazardLayer />} />
        <Route path="/barangay/road-status" element={<BarangayRoadStatus />} />
        <Route path="/barangay/evacuation-routing" element={<BarangayEvacuationRouting />} />
        <Route path="/barangay/alerts" element={<BarangayAlerts />} />
        <Route path="/barangay/incidents" element={<BarangayIncidents />} />
        <Route path="/barangay/evacuation" element={<BarangayEvacuation />} />
        <Route path="/barangay/operations" element={<BarangayOperations />} />
      </Route>

      {/* Resident portal — guarded, read-only, scoped to the resident's barangay. */}
      <Route element={<RequireAuth group="resident" />}>
        <Route path="/resident/dashboard" element={<ResidentDashboard />} />
        <Route path="/resident/flood-map" element={<ResidentFloodMap />} />
        {/* Hazard Layer was this map with three of its overlays; what was
            unique to it is the Flood Map's Hazard tab now. */}
        <Route path="/resident/hazard-layer" element={<Navigate to="/resident/flood-map" replace />} />
        <Route path="/resident/road-status" element={<ResidentRoadStatus />} />
        <Route path="/resident/flood-reports" element={<ResidentFloodReports />} />
        <Route path="/resident/evacuation-routing" element={<ResidentEvacuationRouting />} />
        <Route path="/resident/alerts" element={<ResidentAlerts />} />
        <Route path="/resident/evacuation" element={<ResidentEvacuation />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </AdminDataProvider>
    </Suspense>
  )
}
