import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { registerServiceWorker } from './services/offline.js'
import './index.css'
import 'leaflet/dist/leaflet.css'

// Offline support: see public/sw.js. Production only — a worker in front of
// the dev server swallows HMR.
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
