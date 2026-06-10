import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import AdminDashboard from './pages/admin/Dashboard.jsx'
import AdminFloodMap from './pages/admin/FloodMap.jsx'
import AdminHazardLayer from './pages/admin/HazardLayer.jsx'
import AdminAutoRoute from './pages/admin/AutoRoute.jsx'
import AdminRoutePlanning from './pages/admin/RoutePlanning.jsx'
import AdminRoadStatus from './pages/admin/RoadStatus.jsx'
import AdminOverrideRoutes from './pages/admin/OverrideRoutes.jsx'
import AdminAlerts from './pages/admin/Alerts.jsx'
import AdminBarangay from './pages/admin/Barangay.jsx'
import AdminIncidents from './pages/admin/Incidents.jsx'
import AdminEvacuation from './pages/admin/Evacuation.jsx'
import AdminUserManagement from './pages/admin/UserManagement.jsx'
import AdminSystemConfig from './pages/admin/SystemConfig.jsx'
import AdminRoles from './pages/admin/Roles.jsx'
import AdminIntegrations from './pages/admin/Integrations.jsx'
import AdminAlertSettings from './pages/admin/AlertSettings.jsx'
import BarangayDashboard from './pages/barangay/Dashboard.jsx'
import BarangayFloodMap from './pages/barangay/FloodMap.jsx'
import BarangayHazardLayer from './pages/barangay/HazardLayer.jsx'
import BarangayRoadStatus from './pages/barangay/RoadStatus.jsx'
import BarangayEvacuationRouting from './pages/barangay/EvacuationRouting.jsx'
import BarangayAlerts from './pages/barangay/Alerts.jsx'
import BarangayIncidents from './pages/barangay/Incidents.jsx'
import BarangayEvacuation from './pages/barangay/Evacuation.jsx'
import BarangayOperations from './pages/barangay/Operations.jsx'
import ResidentDashboard from './pages/resident/Dashboard.jsx'
import ResidentFloodMap from './pages/resident/FloodMap.jsx'
import ResidentHazardLayer from './pages/resident/HazardLayer.jsx'
import ResidentRoadStatus from './pages/resident/RoadStatus.jsx'
import ResidentEvacuationRouting from './pages/resident/EvacuationRouting.jsx'
import ResidentAlerts from './pages/resident/Alerts.jsx'
import ResidentEvacuation from './pages/resident/Evacuation.jsx'

/**
 * Web-Based Flood Risk-Aware Route System — route map.
 *
 * Auth pages are converted from the original static codebase.
 * The role dashboards (admin / barangay / resident) are added here
 * as each screen is ported.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Shared authentication pages */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Role dashboards are registered here as they are ported. */}
      <Route path="/admin/dashboard" element={<AdminDashboard />} />
      <Route path="/admin/flood-map" element={<AdminFloodMap />} />
      <Route path="/admin/hazard-layer" element={<AdminHazardLayer />} />
      <Route path="/admin/auto-route" element={<AdminAutoRoute />} />
      <Route path="/admin/route-planning" element={<AdminRoutePlanning />} />
      <Route path="/admin/road-status" element={<AdminRoadStatus />} />
      <Route path="/admin/override-routes" element={<AdminOverrideRoutes />} />
      <Route path="/admin/alerts" element={<AdminAlerts />} />
      <Route path="/admin/barangay" element={<AdminBarangay />} />
      <Route path="/admin/incidents" element={<AdminIncidents />} />
      <Route path="/admin/evacuation" element={<AdminEvacuation />} />
      <Route path="/admin/users" element={<AdminUserManagement />} />
      <Route path="/admin/system-config" element={<AdminSystemConfig />} />
      <Route path="/admin/roles" element={<AdminRoles />} />
      <Route path="/admin/integrations" element={<AdminIntegrations />} />
      <Route path="/admin/alert-settings" element={<AdminAlertSettings />} />

      {/* Barangay Official portal — single-barangay jurisdiction. */}
      <Route path="/barangay/dashboard" element={<BarangayDashboard />} />
      <Route path="/barangay/flood-map" element={<BarangayFloodMap />} />
      <Route path="/barangay/hazard-layer" element={<BarangayHazardLayer />} />
      <Route path="/barangay/road-status" element={<BarangayRoadStatus />} />
      <Route path="/barangay/evacuation-routing" element={<BarangayEvacuationRouting />} />
      <Route path="/barangay/alerts" element={<BarangayAlerts />} />
      <Route path="/barangay/incidents" element={<BarangayIncidents />} />
      <Route path="/barangay/evacuation" element={<BarangayEvacuation />} />
      <Route path="/barangay/operations" element={<BarangayOperations />} />

      {/* Resident portal — read-only, scoped to the resident's own barangay. */}
      <Route path="/resident/dashboard" element={<ResidentDashboard />} />
      <Route path="/resident/flood-map" element={<ResidentFloodMap />} />
      <Route path="/resident/hazard-layer" element={<ResidentHazardLayer />} />
      <Route path="/resident/road-status" element={<ResidentRoadStatus />} />
      <Route path="/resident/evacuation-routing" element={<ResidentEvacuationRouting />} />
      <Route path="/resident/alerts" element={<ResidentAlerts />} />
      <Route path="/resident/evacuation" element={<ResidentEvacuation />} />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
