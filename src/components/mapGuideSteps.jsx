/* ============================================================
   mapGuideSteps.jsx — what each map's Tutorial actually says.

   One walkthrough per map screen, across all three portals:

     adminFloodMapSteps        CDRRMO · Flood Map
     adminRoutingSteps         CDRRMO · Routing
     barangayFloodMapSteps     Barangay · Flood Map
     barangayHazardSteps       Barangay · Flood Hazard Layers
     barangayRoutingSteps      Barangay · Evacuation Routing
     residentFloodMapSteps     Resident · Flood Map
     residentRoadStatusSteps   Resident · Road Status

   (Resident · Evacuation Routing keeps its own steps in
   components/resident/RoutingGuide.jsx — it is the one screen whose guide also
   opens by itself the first time.)

   Two rules held throughout:

   DESCRIBE THE SCREEN THAT EXISTS. Every control named here is a control that
   is really there, under the name it really carries — "Nearest safe centre",
   "Auto-suggest", "Add flood-prone area". A tutorial that describes an
   imagined UI is worse than no tutorial, because the reader concludes they are
   the one who is lost. If a control is renamed, its step changes with it.

   DRAW IT. Each step carries a diagram of that part of the screen, built from
   the shared .mg-* vocabulary in mapGuide.css. The artwork is deliberately
   flat and schematic: it should read at a glance as "the panel on the left",
   not compete with the real map for detail.
   ============================================================ */

/* ── Shared artwork ───────────────────────────────────────────────────────
   Drawn on one 260×150 canvas so every step sits at the same scale and the
   reader's eye does not have to re-anchor between cards. Several diagrams are
   reused across portals — the layer rail and the forecast clock look the same
   to CDRRMO and to a barangay official, because they are the same. */

function Frame({ children, label }) {
  return (
    <svg viewBox="0 0 260 150" className="mguide-art" role="img" aria-label={label}>
      <rect x="0" y="0" width="260" height="150" rx="12" className="mg-bg" />
      {children}
    </svg>
  )
}

/* A generic street grid, used as the ground under most diagrams. */
function Streets() {
  return (
    <g>
      <path d="M-4 108 L70 74 L130 96 L192 46 L264 68" className="mg-road" />
      <path d="M44 -4 L96 58 L106 132" className="mg-road mg-road--thin" />
      <path d="M198 -4 L174 84 L236 128" className="mg-road mg-road--thin" />
    </g>
  )
}

/* The pointing finger + pulse that says "press this one". */
function Tap({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="0" cy="0" r="5" className="mg-tap-ring" />
      <path d="M0 -3 v10 l-4 -2 -2 3 6 8 h9 l3 -9 v-7 a2 2 0 0 0 -4 0 v-2 a2 2 0 0 0 -4 0 v-1 a2 2 0 0 0 -4 0 Z" className="mg-tap" />
    </g>
  )
}

function ArtCityRisk() {
  return (
    <Frame label="The map coloured by barangay risk level">
      <path d="M12 14 L92 8 L104 60 L24 68 Z" className="mg-poly mg-poly--low" />
      <path d="M92 8 L174 16 L168 64 L104 60 Z" className="mg-poly mg-poly--med" />
      <path d="M174 16 L248 24 L242 72 L168 64 Z" className="mg-poly mg-poly--low" />
      <path d="M24 68 L104 60 L112 114 L32 122 Z" className="mg-poly mg-poly--high" />
      <path d="M104 60 L168 64 L174 118 L112 114 Z" className="mg-poly mg-poly--med" />
      <path d="M168 64 L242 72 L246 122 L174 118 Z" className="mg-poly mg-poly--low" />

      <g>
        <circle cx="20" cy="138" r="4.5" fill="#86efac" />
        <text x="29" y="141" className="mg-t mg-t--sm">Low</text>
        <circle cx="72" cy="138" r="4.5" fill="#fdba74" />
        <text x="81" y="141" className="mg-t mg-t--sm">Moderate</text>
        <circle cx="146" cy="138" r="4.5" fill="#fca5a5" />
        <text x="155" y="141" className="mg-t mg-t--sm">High</text>
      </g>
    </Frame>
  )
}

function ArtLayerPanel() {
  const rows = [
    { y: 58, c: '#C0181B', label: 'Hazard', on: true },
    { y: 78, c: '#2563EB', label: 'Inundation', on: true },
    { y: 98, c: '#1A7A4A', label: 'Evac centres', on: false },
    { y: 118, c: '#B45309', label: 'Flagged roads', on: false },
  ]
  return (
    <Frame label="The layer panel on the left of the map">
      <Streets />
      <ellipse cx="196" cy="72" rx="46" ry="32" className="mg-band--low" opacity="0.75" />
      <ellipse cx="196" cy="72" rx="26" ry="18" className="mg-band--med" opacity="0.85" />

      <rect x="12" y="14" width="132" height="124" rx="10" className="mg-panel" />
      <text x="24" y="34" className="mg-t mg-t--md">Map Layers</text>
      <line x1="22" y1="44" x2="134" y2="44" className="mg-rule" />
      {rows.map((r) => (
        <g key={r.label}>
          <rect x="24" y={r.y - 7} width="10" height="10" rx="3" fill={r.c} />
          <text x="40" y={r.y + 2} className="mg-t mg-t--sm">{r.label}</text>
          <rect x="108" y={r.y - 6} width="22" height="12" rx="6" className={r.on ? 'mg-sw mg-sw--on' : 'mg-sw'} />
          <circle cx={r.on ? 124 : 114} cy={r.y} r="4" className="mg-knob" />
        </g>
      ))}
      <Tap x={119} y={98} />
    </Frame>
  )
}

function ArtHazardBands() {
  return (
    <Frame label="The three hazard bands and what their colours mean">
      <Streets />
      <ellipse cx="88" cy="72" rx="74" ry="52" className="mg-band--low" opacity="0.85" />
      <ellipse cx="88" cy="74" rx="48" ry="33" className="mg-band--med" opacity="0.9" />
      <ellipse cx="86" cy="76" rx="22" ry="15" className="mg-band--high" opacity="0.95" />

      <rect x="170" y="20" width="78" height="80" rx="9" className="mg-panel" />
      <text x="180" y="37" className="mg-t mg-t--md">Hazard</text>
      <rect x="180" y="46" width="12" height="9" rx="2" className="mg-band--low" />
      <text x="198" y="54" className="mg-t mg-t--sm">Low</text>
      <rect x="180" y="64" width="12" height="9" rx="2" className="mg-band--med" />
      <text x="198" y="72" className="mg-t mg-t--sm">Medium</text>
      <rect x="180" y="82" width="12" height="9" rx="2" className="mg-band--high" />
      <text x="198" y="90" className="mg-t mg-t--sm">High</text>
      <text x="170" y="120" className="mg-t mg-t--sm mg-t--mute">Project NOAH</text>
      <text x="170" y="132" className="mg-t mg-t--sm mg-t--mute">100-year flood</text>
    </Frame>
  )
}

function ArtScrubber() {
  return (
    <Frame label="The forecast clock under the map, moved forward six hours">
      <path d="M14 30 L96 24 L104 74 L22 82 Z" className="mg-poly mg-poly--med" />
      <path d="M104 24 L246 30 L240 74 L104 74 Z" className="mg-poly mg-poly--high" />
      <path d="M22 82 L104 74 L110 104 L26 104 Z" className="mg-poly mg-poly--high" />
      <path d="M110 74 L240 74 L240 104 L110 104 Z" className="mg-poly mg-poly--med" />
      <rect x="10" y="18" width="240" height="90" rx="10" className="mg-forecast-frame" />

      <g className="mg-chip" transform="translate(74 8)">
        <rect width="112" height="20" rx="10" fill="#f59e0b" />
        <text x="12" y="14" className="mg-t mg-t--sm mg-t--inv">Forecast · Today 3 PM</text>
      </g>

      <line x1="26" y1="128" x2="234" y2="128" className="mg-track" />
      <line x1="26" y1="128" x2="150" y2="128" className="mg-track--done" />
      <circle cx="150" cy="128" r="7" className="mg-thumb" />
      <text x="26" y="145" className="mg-t mg-t--sm mg-t--mute">Now</text>
      <text x="222" y="145" className="mg-t mg-t--sm mg-t--mute">+24h</text>
    </Frame>
  )
}

function ArtMarkers() {
  return (
    <Frame label="Markers on the map and the card that opens when one is clicked">
      <Streets />
      <path d="M-4 108 L70 74" className="mg-road mg-flooded" />
      <g transform="translate(28 88)">
        <path d="M0 20 L0 8 L12 0 L24 8 L24 20 Z" className="mg-pin mg-pin--evac" />
      </g>
      <g transform="translate(150 26)">
        <path d="M10 0 C4 8 0 12 0 17 a10 10 0 0 0 20 0 c0 -5 -4 -9 -10 -17 Z" className="mg-pin mg-pin--incident" />
      </g>

      <rect x="96" y="62" width="128" height="60" rx="9" className="mg-panel" />
      <text x="107" y="80" className="mg-t mg-t--md">Cabuyao Central ES</text>
      <text x="107" y="94" className="mg-t mg-t--sm mg-t--mute">Open · 312 / 500 evacuees</text>
      <rect x="107" y="102" width="106" height="6" rx="3" fill="#e2e8f0" />
      <rect x="107" y="102" width="66" height="6" rx="3" fill="#16a34a" />
      {/* Below-right of the shelter pin: the hand is pointing AT the marker,
          so it must not sit on top of it. */}
      <Tap x={64} y={104} />
    </Frame>
  )
}

function ArtSearch() {
  return (
    <Frame label="The search box above the map and the 2D / 3D switch">
      <Streets />
      <rect x="18" y="16" width="152" height="28" rx="14" className="mg-input" />
      <g transform="translate(32 24)">
        <circle cx="5" cy="5" r="5" className="mg-glass" />
        <path d="M9 9 l4 4" className="mg-glass" />
      </g>
      <text x="48" y="34" className="mg-t mg-t--sm mg-t--mute">Mabini Street</text>

      <rect x="18" y="50" width="152" height="56" rx="9" className="mg-panel" />
      <text x="30" y="68" className="mg-t mg-t--sm">Mabini St · Brgy. Baclaran</text>
      <line x1="28" y1="78" x2="160" y2="78" className="mg-rule" />
      <text x="30" y="94" className="mg-t mg-t--sm">Cabuyao Central ES</text>

      <rect x="182" y="16" width="60" height="28" rx="8" className="mg-panel" />
      <rect x="184" y="18" width="28" height="24" rx="7" className="mg-tab--on" />
      <text x="192" y="34" className="mg-t mg-t--sm mg-t--inv">2D</text>
      <text x="219" y="34" className="mg-t mg-t--sm mg-t--mute">3D</text>
      <Tap x={228} y={48} />
    </Frame>
  )
}

function ArtFloodAreas() {
  return (
    <Frame label="Flood-prone area pins with their recorded depth">
      <Streets />
      <g transform="translate(52 46)">
        <path d="M10 0 C4 8 0 12 0 17 a10 10 0 0 0 20 0 c0 -5 -4 -9 -10 -17 Z" className="mg-pin mg-pin--area" />
      </g>
      <text x="76" y="60" className="mg-t mg-t--sm">Purok 3 · 4 ft</text>
      <g transform="translate(150 84)">
        <path d="M10 0 C4 8 0 12 0 17 a10 10 0 0 0 20 0 c0 -5 -4 -9 -10 -17 Z" className="mg-pin mg-pin--area" />
      </g>
      <text x="174" y="98" className="mg-t mg-t--sm">Riverside · 6 ft</text>

      <g transform="translate(18 116)">
        <rect width="146" height="24" rx="8" fill="#0f766e" />
        <path d="M18 12 h12 M24 6 v12" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <text x="40" y="16" className="mg-t mg-t--sm mg-t--inv">Add flood-prone area</text>
      </g>
      <Tap x={172} y={126} />
    </Frame>
  )
}

function ArtTabs() {
  const tabs = [
    { x: 14, w: 62, label: 'Generate', on: true },
    { x: 80, w: 46, label: 'Draw' },
    { x: 130, w: 62, label: 'Override' },
    { x: 196, w: 50, label: 'Saved' },
  ]
  return (
    <Frame label="The four routing modes across the top of the screen">
      {tabs.map((t) => (
        <g key={t.label}>
          <rect x={t.x} y="14" width={t.w} height="26" rx="8" className={t.on ? 'mg-tab--on' : 'mg-tab'} />
          <text x={t.x + t.w / 2} y="31" className={`mg-t mg-t--sm mg-t--mid ${t.on ? 'mg-t--inv' : ''}`}>{t.label}</text>
        </g>
      ))}
      <rect x="14" y="52" width="232" height="84" rx="10" className="mg-panel" />
      <path d="M40 116 L74 116 L74 74 L164 74 L200 74" className="mg-route" />
      <circle cx="40" cy="116" r="7" className="mg-you" />
      <g transform="translate(190 62)">
        <path d="M0 20 L0 8 L12 0 L24 8 L24 20 Z" className="mg-pin mg-pin--evac" />
      </g>
      <Tap x={45} y={44} />
    </Frame>
  )
}

function ArtSolve() {
  return (
    <Frame label="A route solved around a flooded road">
      <path d="M40 106 L212 106" className="mg-road mg-flooded" />
      <text x="126" y="126" className="mg-t mg-t--sm mg-t--mid mg-t--warn">flooded — not used</text>
      <path d="M40 106 L74 106 L74 46 L182 46 L212 46 L212 100" className="mg-route" />
      <path d="M40 106 L74 106 L74 46 L182 46 L212 46 L212 100" className="mg-route-flow" />
      <circle cx="40" cy="106" r="8" className="mg-you" />
      <text x="20" y="90" className="mg-t mg-t--sm">Origin</text>
      <g transform="translate(200 96)">
        <path d="M0 20 L0 8 L12 0 L24 8 L24 20 Z" className="mg-pin mg-pin--evac" />
      </g>
      <g transform="translate(14 12)">
        <rect width="104" height="22" rx="11" fill="#0f766e" />
        <text x="14" y="15" className="mg-t mg-t--sm mg-t--inv">Generate Route</text>
      </g>
    </Frame>
  )
}

function ArtDrawStops() {
  const stops = [
    { x: 42, y: 112, n: '1' },
    { x: 104, y: 70, n: '2' },
    { x: 178, y: 96, n: '3' },
  ]
  return (
    <Frame label="Stops clicked onto the map in order">
      <Streets />
      <path d="M42 112 L104 70 L178 96" className="mg-route mg-route--ghost" />
      {stops.map((s) => (
        <g key={s.n}>
          <circle cx={s.x} cy={s.y} r="11" className="mg-stop" />
          <text x={s.x} y={s.y + 4} className="mg-t mg-t--sm mg-t--mid mg-t--inv">{s.n}</text>
        </g>
      ))}
      <Tap x={224} y={52} />
      <text x="196" y="40" className="mg-t mg-t--sm mg-t--mute">click to add</text>
    </Frame>
  )
}

function ArtAutoSuggest() {
  return (
    <Frame label="A hand-drawn line snapped onto real roads">
      <Streets />
      <path d="M40 112 L112 66 L206 88" className="mg-route mg-route--ghost" />
      <path d="M40 112 L70 112 L70 66 L118 66 L118 88 L206 88" className="mg-route" />
      <path d="M40 112 L70 112 L70 66 L118 66 L118 88 L206 88" className="mg-route-flow" />
      <circle cx="40" cy="112" r="7" className="mg-you" />
      <circle cx="206" cy="88" r="7" className="mg-stop" />
      <g transform="translate(74 12)">
        <rect width="112" height="22" rx="11" fill="#0f766e" />
        <path d="M18 11 l3 -6 3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 Z" fill="#fff" />
        <text x="38" y="15" className="mg-t mg-t--sm mg-t--inv">Auto-suggest</text>
      </g>
    </Frame>
  )
}

function ArtResult() {
  const metrics = [
    { x: 30, val: '2.4 km', lbl: 'Distance' },
    { x: 106, val: '31 min', lbl: 'Walk ETA' },
    { x: 182, val: '4', lbl: 'Stops' },
  ]
  return (
    <Frame label="The route details panel with distance, walking time and stops">
      <rect x="14" y="12" width="232" height="126" rx="10" className="mg-panel" />
      <text x="28" y="32" className="mg-t mg-t--md">Route Details</text>
      <line x1="26" y1="42" x2="234" y2="42" className="mg-rule" />
      {metrics.map((m) => (
        <g key={m.lbl}>
          <text x={m.x + 22} y="66" className="mg-t mg-t--lg mg-t--mid">{m.val}</text>
          <text x={m.x + 22} y="80" className="mg-t mg-t--sm mg-t--mid mg-t--mute">{m.lbl}</text>
        </g>
      ))}
      <circle cx="32" cy="98" r="4" fill="#f97316" />
      <text x="42" y="101" className="mg-t mg-t--sm">Avoids 3 flagged roads</text>
      <g transform="translate(26 112)">
        <rect width="208" height="20" rx="8" fill="#0f766e" />
        <text x="104" y="14" className="mg-t mg-t--sm mg-t--mid mg-t--inv">Save Route</text>
      </g>
      <Tap x={140} y={140} />
    </Frame>
  )
}

function ArtSaved() {
  const rows = [
    { y: 46, c: '#0f766e', name: 'Baclaran → Central ES' },
    { y: 74, c: '#b45309', name: 'Relief run · Purok 4' },
    { y: 102, c: '#2563eb', name: 'Responder access route' },
  ]
  return (
    <Frame label="The saved-route library, with one route being replaced">
      <rect x="14" y="12" width="232" height="126" rx="10" className="mg-panel" />
      <text x="28" y="32" className="mg-t mg-t--md">Saved Routes</text>
      {rows.map((r) => (
        <g key={r.name}>
          <line x1="26" y1={r.y - 12} x2="234" y2={r.y - 12} className="mg-rule" />
          <circle cx="34" cy={r.y} r="4.5" fill={r.c} />
          <text x="46" y={r.y + 3} className="mg-t mg-t--sm">{r.name}</text>
          <rect x="176" y={r.y - 9} width="52" height="18" rx="6" className="mg-tab" />
          <text x="202" y={r.y + 3} className="mg-t mg-t--sm mg-t--mid mg-t--on">Override</text>
        </g>
      ))}
      <Tap x={214} y={84} />
    </Frame>
  )
}

function ArtJurisdiction() {
  return (
    <Frame label="The map locked to your own barangay, with the switch to the whole city">
      <path d="M12 44 L92 36 L104 88 L24 96 Z" className="mg-poly mg-poly--off" />
      <path d="M174 44 L248 52 L242 100 L168 92 Z" className="mg-poly mg-poly--off" />
      <path d="M24 96 L104 88 L112 132 L32 138 Z" className="mg-poly mg-poly--off" />
      <path d="M92 36 L174 44 L168 92 L104 88 Z" className="mg-poly mg-poly--med" stroke="#0f766e" strokeWidth="2.5" />
      <text x="136" y="70" className="mg-t mg-t--sm mg-t--mid">Brgy. Baclaran</text>

      <rect x="60" y="8" width="140" height="24" rx="8" className="mg-panel" />
      <rect x="62" y="10" width="70" height="20" rx="7" className="mg-tab--on" />
      <text x="97" y="24" className="mg-t mg-t--sm mg-t--mid mg-t--inv">My barangay</text>
      <text x="166" y="24" className="mg-t mg-t--sm mg-t--mid mg-t--mute">Whole city</text>
    </Frame>
  )
}

function ArtRoadFlag() {
  return (
    <Frame label="A road reported as flooded, waiting for CDRRMO approval">
      <Streets />
      <path d="M-4 108 L70 74 L130 96" className="mg-road mg-flooded" />
      <rect x="96" y="20" width="150" height="56" rx="9" className="mg-panel" />
      <text x="108" y="38" className="mg-t mg-t--md">Mabini St</text>
      <circle cx="112" cy="52" r="4" fill="#f97316" />
      <text x="122" y="55" className="mg-t mg-t--sm">Flooded · 1.5 ft deep</text>
      <text x="108" y="70" className="mg-t mg-t--sm mg-t--mute">Passable with care</text>
      <g transform="translate(60 116)">
        <rect width="150" height="22" rx="11" fill="#f1f5f9" stroke="#cbd5e1" />
        <circle cx="16" cy="11" r="4" fill="#f59e0b" />
        <text x="28" y="15" className="mg-t mg-t--sm">Waiting for CDRRMO approval</text>
      </g>
    </Frame>
  )
}

/* ── Resident-only artwork ───────────────────────────────────────────────
   A resident does not flag roads, publish routes or read a forecast clock.
   What they do is look up their own street, avoid the water, and tell CDRRMO
   what they can see — so these three diagrams cover that and nothing else. */

function ArtRoadColours() {
  const rows = [
    { y: 34, cls: 'mg-road', label: 'Passable', note: 'normal road' },
    { y: 74, cls: 'mg-road mg-flooded', label: 'Flooded', note: 'water on the road — avoid' },
    { y: 114, cls: 'mg-road mg-closed', label: 'Closed', note: 'impassable, do not attempt' },
  ]
  return (
    <Frame label="What the road colours mean: passable, flooded, closed">
      {rows.map((r) => (
        <g key={r.label}>
          <path d={`M22 ${r.y} h64`} className={r.cls} />
          <text x="100" y={r.y - 2} className="mg-t mg-t--md">{r.label}</text>
          <text x="100" y={r.y + 12} className="mg-t mg-t--sm mg-t--mute">{r.note}</text>
        </g>
      ))}
    </Frame>
  )
}

function ArtFlaggedList() {
  const rows = [
    { y: 52, name: 'Mabini Street', badge: 'Flooded', fill: '#f97316' },
    { y: 82, name: 'Riverside Road', badge: 'Closed', fill: '#dc2626' },
    { y: 112, name: 'Purok 4 access', badge: 'Flooded', fill: '#f97316' },
  ]
  return (
    <Frame label="The list of roads currently flagged as flooded or closed">
      <rect x="14" y="12" width="232" height="126" rx="10" className="mg-panel" />
      <text x="28" y="34" className="mg-t mg-t--md">Roads to avoid right now</text>
      {rows.map((r) => (
        <g key={r.name}>
          <line x1="26" y1={r.y - 14} x2="234" y2={r.y - 14} className="mg-rule" />
          <text x="30" y={r.y + 2} className="mg-t mg-t--sm">{r.name}</text>
          <rect x="166" y={r.y - 10} width="62" height="17" rx="6" fill={r.fill} />
          <text x="197" y={r.y + 2} className="mg-t mg-t--sm mg-t--mid mg-t--inv">{r.badge}</text>
        </g>
      ))}
    </Frame>
  )
}

function ArtReport() {
  return (
    <Frame label="Reporting the flooding you can see from where you are">
      <g transform="translate(56 10)">
        <rect width="148" height="24" rx="8" fill="#b91c1c" />
        <path d="M18 17 v-10 h10 l-2 3 2 3 h-10" fill="#fff" />
        <text x="40" y="16" className="mg-t mg-t--sm mg-t--inv">Report Flood Status</text>
      </g>
      <rect x="24" y="44" width="212" height="96" rx="10" className="mg-panel" />
      <text x="38" y="62" className="mg-t mg-t--sm mg-t--mute">Flood level / status</text>
      <rect x="38" y="70" width="54" height="19" rx="7" className="mg-tab" />
      <text x="65" y="83" className="mg-t mg-t--sm mg-t--mid">Low</text>
      <rect x="96" y="70" width="66" height="19" rx="7" className="mg-tab--on" />
      <text x="129" y="83" className="mg-t mg-t--sm mg-t--mid mg-t--inv">Moderate</text>
      <rect x="166" y="70" width="54" height="19" rx="7" className="mg-tab" />
      <text x="193" y="83" className="mg-t mg-t--sm mg-t--mid">Severe</text>
      <text x="38" y="107" className="mg-t mg-t--sm mg-t--mute">Water depth</text>
      <rect x="96" y="96" width="60" height="18" rx="6" className="mg-input" />
      <text x="104" y="109" className="mg-t mg-t--sm">2.5</text>
      <text x="162" y="109" className="mg-t mg-t--sm mg-t--mute">feet</text>
      <circle cx="44" cy="128" r="4" fill="#16a34a" />
      <text x="54" y="131" className="mg-t mg-t--sm">Sent to CDRRMO for checking</text>
      <Tap x={129} y={92} />
    </Frame>
  )
}

function ArtStats() {
  const stats = [
    { x: 28, val: '4.8', unit: 'km²', lbl: 'At-risk area' },
    { x: 104, val: '0.42', unit: 'm', lbl: 'Avg depth' },
    { x: 180, val: '5', unit: '', lbl: 'High-risk brgys' },
  ]
  return (
    <Frame label="The live hazard summary beside the map">
      <rect x="14" y="12" width="232" height="126" rx="10" className="mg-panel" />
      <text x="28" y="32" className="mg-t mg-t--md">Hazard Summary</text>
      <line x1="26" y1="42" x2="234" y2="42" className="mg-rule" />
      {stats.map((s) => (
        <g key={s.lbl}>
          <text x={s.x + 22} y="68" className="mg-t mg-t--lg mg-t--mid">{s.val}{s.unit}</text>
          <text x={s.x + 22} y="82" className="mg-t mg-t--sm mg-t--mid mg-t--mute">{s.lbl}</text>
        </g>
      ))}
      <line x1="26" y1="98" x2="234" y2="98" className="mg-rule" />
      <circle cx="34" cy="114" r="4" fill="#16a34a" />
      <text x="44" y="117" className="mg-t mg-t--sm">Live · updated 2:41 PM PHT</text>
      <text x="28" y="132" className="mg-t mg-t--sm mg-t--mute">Source: Open-Meteo · OpenStreetMap</text>
    </Frame>
  )
}

/* ── CDRRMO · Flood Map ─────────────────────────────────────────────────── */

export const adminFloodMapSteps = [
  {
    key: 'read',
    art: ArtCityRisk,
    title: 'Read the map first',
    tagalog: 'Ang kulay ng bawat barangay ang antas ng panganib nito.',
    body: (
      <>
        Each barangay is shaded by its current flood risk — <b>green</b> is low,{' '}
        <b>orange</b> moderate, <b>red</b> high. The shading comes from measured
        and forecast water depth, not from how many alerts have been sent, so a
        quiet barangay can still be red.
      </>
    ),
    tip: 'Hover or click a barangay to see the depth and the reading behind its colour.',
  },
  {
    key: 'layers',
    art: ArtLayerPanel,
    title: 'Turn layers on and off',
    tagalog: 'I-on o i-off ang mga layer sa panel sa kaliwa.',
    body: (
      <>
        The panel on the left of the map is the layer control. Each switch adds
        or removes one thing: the hazard shading, flood-prone areas, evacuation
        centres, incidents, flagged roads and cut-off areas. The slider under it
        changes how strong the shading looks.
      </>
    ),
    tip: 'Working on one problem? Switch the rest off. A map with every layer on is hard to read quickly.',
  },
  {
    key: 'hazard',
    art: ArtHazardBands,
    title: 'The hazard layer',
    tagalog: 'Ang hazard layer ay ipinapakita kung saan malamang bumaha.',
    body: (
      <>
        <b>Project NOAH Hazard</b> paints the modelled 100-year flood in three
        bands — low, medium, high. It is a long-term picture of where water
        tends to go, and it does not change with today&apos;s weather. The key
        that names the bands appears under the layer panel while it is on.
      </>
    ),
    tip: 'Use hazard for planning; use the live layers below it for what is happening right now.',
  },
  {
    key: 'areas',
    art: ArtFloodAreas,
    title: 'Flood-prone areas are edited here',
    tagalog: 'Dito rin ini-edit ang mga lugar na madalas bahain.',
    body: (
      <>
        Switch on <b>Flood-Prone Areas</b> and the recorded spots appear as
        pins, each with its usual depth in feet. Click a pin to edit it, or use{' '}
        <b>Add flood-prone area</b> and click the map to record a new one.
      </>
    ),
    tip: 'These records feed the routing engine — an area you add here is an area routes will try to avoid.',
  },
  {
    key: 'markers',
    art: ArtMarkers,
    title: 'Click a marker to act on it',
    tagalog: 'I-click ang marker para makita at maaksyunan ang detalye.',
    body: (
      <>
        Green houses are evacuation centres, red pins are open incidents, and
        amber roads are the ones flagged as flooded or closed. Clicking one
        opens its card with the live numbers — occupancy, priority, team — and
        the buttons to act on it without leaving the map.
      </>
    ),
    tip: 'The occupancy bar fills as evacuees arrive, so a centre nearing capacity is visible at a glance.',
  },
  {
    key: 'clock',
    art: ArtScrubber,
    title: 'Look ahead with the clock',
    tagalog: 'Ang slider sa ibaba ay para tingnan ang forecast na oras.',
    body: (
      <>
        The slider under the map moves the whole picture forward in time. Drag
        it and the shading redraws for that forecast hour. While you are away
        from <b>Now</b> the map wears an <b>amber dashed frame</b> — that frame
        means what you are seeing has not happened yet.
      </>
    ),
    tip: 'Never screenshot or report from a framed map without saying which hour it shows.',
  },
  {
    key: 'find',
    art: ArtSearch,
    title: 'Find a place, or switch to 3D',
    tagalog: 'Maghanap ng lugar, o lumipat sa 3D na tanawin.',
    body: (
      <>
        The search box finds streets, barangays and evacuation centres and jumps
        the map to them. The <b>2D / 3D</b> switch changes how the same data is
        drawn: 2D is the fast working view, 3D shows terrain and buildings for
        briefings.
      </>
    ),
    tip: 'Everything you toggle stays toggled when you switch views — you are changing the camera, not the data.',
  },
]

/* ── CDRRMO · Routing ───────────────────────────────────────────────────── */

export const adminRoutingSteps = [
  {
    key: 'tabs',
    art: ArtTabs,
    title: 'Four ways to make a route',
    tagalog: 'Apat na paraan ng paggawa ng ruta — pumili sa itaas.',
    body: (
      <>
        <b>Generate</b> lets the system solve the route. <b>Draw</b> lets you
        click it by hand. <b>Override</b> replaces the path of a route that is
        already saved. <b>Saved</b> is the library of all of them. All four use
        the same flood-aware engine.
      </>
    ),
    tip: 'Not sure which? Start with Generate. Draw is for when you know something the map does not.',
  },
  {
    key: 'generate',
    art: ArtSolve,
    title: 'Generate: set an origin, press the button',
    tagalog: 'Mag-click ng simula, pindutin ang Generate Route.',
    body: (
      <>
        Click the map to set the <b>Origin</b>. Leave the destination on{' '}
        <b>Nearest safe centre</b> and the engine picks the closest open
        evacuation centre itself, or choose <b>Point to point</b> and click the
        destination too. Then press <b>Generate Route</b>.
      </>
    ),
    tip: 'The route bends away from flooded and closed roads on purpose. A longer line is usually the safer one.',
  },
  {
    key: 'draw',
    art: ArtDrawStops,
    title: 'Draw: click the stops in order',
    tagalog: 'Sunod-sunod na i-click ang mga hinto sa mapa.',
    body: (
      <>
        On the <b>Draw</b> tab every click on the map adds the next stop, and
        they are joined in the order you clicked. <b>Undo</b> removes the last
        one and <b>Clear</b> starts over. Use it for relief runs and pickups the
        engine has no way to know about.
      </>
    ),
    tip: 'Pick the trip type first — evacuation, relief or responder. It sets the colour and how the route is used.',
  },
  {
    key: 'result',
    art: ArtResult,
    title: 'Check the result before you save it',
    tagalog: 'Suriin ang detalye bago i-save ang ruta.',
    body: (
      <>
        The panel gives the distance, the walking time and whether the route
        still touches anything risky. Read that line before saving: a route can
        be produced even when every option is bad, and the panel is where it
        says so. Name it, then <b>Save</b>.
      </>
    ),
    tip: 'Saved routes are what barangays and residents see. An unnamed route is hard for them to trust.',
  },
  {
    key: 'clock',
    art: ArtScrubber,
    title: 'Plan against a forecast hour',
    tagalog: 'Maaaring gumawa ng ruta para sa oras na hindi pa dumarating.',
    body: (
      <>
        The clock under the map works here too, and it does more than recolour:
        the route is <b>re-solved</b> against that hour&apos;s flooding. Move it
        to when you expect people to actually move, and you get the route that
        will be usable then.
      </>
    ),
    tip: 'A route generated for a future hour should say so in its name — it may not be the best route right now.',
  },
  {
    key: 'saved',
    art: ArtSaved,
    title: 'Override and Saved',
    tagalog: 'Palitan ang ruta ng nakasave nang hindi binabago ang pangalan nito.',
    body: (
      <>
        <b>Saved</b> lists every route in the system. <b>Override</b> takes one
        of them and replaces its path — by hand or by re-solving — while keeping
        its name and everything pointing at it. That is how a published route is
        corrected without breaking the links to it.
      </>
    ),
    tip: 'Override an existing route rather than saving a near-duplicate. Two similar routes is how people end up following the wrong one.',
  },
]

/* ── Barangay · Flood Map ───────────────────────────────────────────────── */

export const barangayFloodMapSteps = [
  {
    key: 'scope',
    art: ArtJurisdiction,
    title: 'This map is set to your barangay',
    tagalog: 'Nakatutok ang mapa sa inyong barangay.',
    body: (
      <>
        The map opens locked to your own barangay, so what you see is what you
        are responsible for. The switch at the top moves between{' '}
        <b>your barangay</b> and the <b>whole city</b> when you need to see what
        is happening next door.
      </>
    ),
    tip: 'The badge in the toolbar always shows your barangay’s current risk level, whichever view you are in.',
  },
  {
    key: 'read',
    art: ArtCityRisk,
    title: 'The colours are risk levels',
    tagalog: 'Ang kulay ay antas ng panganib: berde, kahel, pula.',
    body: (
      <>
        <b>Green</b> is low risk, <b>orange</b> moderate, <b>red</b> high. The
        colour comes from how deep the water is or is expected to get — it is
        measured, not a guess, and it updates on its own while the screen is
        open.
      </>
    ),
    tip: 'If your barangay turns red, expect an alert from CDRRMO shortly — but start preparing before it arrives.',
  },
  {
    key: 'layers',
    art: ArtLayerPanel,
    title: 'Choose what the map shows',
    tagalog: 'Piliin kung ano ang lalabas sa mapa.',
    body: (
      <>
        The panel on the left switches layers on and off: the hazard shading,
        flood-prone areas, verified flood reports, evacuation centres, and roads
        flagged as flooded or closed. The slider changes how strong the shading
        looks.
      </>
    ),
    tip: 'For a quick situation check, leave only Flooded / Closed Roads and Evacuation Centres on.',
  },
  {
    key: 'markers',
    art: ArtMarkers,
    title: 'Click a marker for the details',
    tagalog: 'I-click ang marker para sa buong detalye.',
    body: (
      <>
        Green houses are evacuation centres — clicking one shows whether it is
        open and how full it is. Red pins are open incidents. Amber roads are
        the ones currently flagged as flooded or closed.
      </>
    ),
    tip: 'Centre nearly full? Say so in your report early — CDRRMO can open another before people are turned away.',
  },
  {
    key: 'report',
    art: ArtRoadFlag,
    title: 'Report what you can see on the ground',
    tagalog: 'Iulat ang tunay na lagay ng kalsada sa Road Status.',
    body: (
      <>
        You are the eyes on the ground. Use <b>Road Status</b> to report a road
        as flooded or closed and how deep the water is in feet. Your report goes
        to CDRRMO for approval, and once approved the road turns amber on
        everyone&apos;s map and routes stop using it.
      </>
    ),
    tip: 'Approval usually takes minutes, not hours. Report it as soon as you see it — do not wait for certainty about depth.',
  },
]

/* ── Barangay · Flood Hazard Layers ─────────────────────────────────────── */

export const barangayHazardSteps = [
  {
    key: 'bands',
    art: ArtHazardBands,
    title: 'What the three colours mean',
    tagalog: 'Tatlong antas ng hazard: mababa, katamtaman, mataas.',
    body: (
      <>
        This screen shades the areas most likely to flood, in three bands — low,
        medium and high. It is a model of where water goes in a serious flood,
        built from terrain and past events, so it stays roughly the same from
        day to day.
      </>
    ),
    tip: 'Use it to decide where to pre-position and which puroks to warn first — not to judge today’s conditions.',
  },
  {
    key: 'scope',
    art: ArtJurisdiction,
    title: 'Your barangay, or the whole city',
    tagalog: 'Ang inyong barangay, o ang buong lungsod.',
    body: (
      <>
        The view starts on your own barangay. Switch to the city view to see how
        your area sits against the ones around it — useful when a road out of
        your barangay leads straight into a worse one.
      </>
    ),
    tip: 'The panel on the right always reports your barangay’s own level, even while the city view is showing.',
  },
  {
    key: 'stats',
    art: ArtStats,
    title: 'The numbers beside the map',
    tagalog: 'Ang mga numero sa gilid ay live at may pinagmulan.',
    body: (
      <>
        The panel gives the at-risk area, the estimated average depth and how
        many barangays are currently high-risk. These are live readings from
        Open-Meteo and OpenStreetMap, with the time of the last update shown so
        you can tell how fresh they are.
      </>
    ),
    tip: 'These are model estimates, not gauge readings. Trust what your tanods see on the ground over any number here.',
  },
  {
    key: 'layers',
    art: ArtLayerPanel,
    title: 'Layers and opacity',
    tagalog: 'Mga layer at kung gaano kalinaw ang kulay.',
    body: (
      <>
        <b>Map Layers</b> in the side panel switches the hazard shading,
        inundation and barangay outlines on and off, and{' '}
        <b>Inundation Opacity</b> fades the blue so you can see the streets
        underneath it.
      </>
    ),
    tip: 'Turn the opacity down before showing this to someone who needs to recognise their own street.',
  },
]

/* ── Barangay · Evacuation Routing ──────────────────────────────────────── */

export const barangayRoutingSteps = [
  {
    key: 'stops',
    art: ArtDrawStops,
    title: 'Click the stops in order',
    tagalog: 'Sunod-sunod na i-click ang mga hinto sa mapa.',
    body: (
      <>
        Pick the trip type first — <b>evacuation</b>, <b>relief</b> or{' '}
        <b>responder</b> — then click the map to drop each stop. They join in
        the order you click. <b>Undo</b> removes the last one, <b>Clear</b>{' '}
        starts again.
      </>
    ),
    tip: 'Start at where people are, end at the evacuation centre. The first and last pins are labelled for you.',
  },
  {
    key: 'auto',
    art: ArtAutoSuggest,
    title: 'Let Auto-suggest fix the line',
    tagalog: 'Pindutin ang Auto-suggest para sumunod ang ruta sa tunay na kalsada.',
    body: (
      <>
        A line clicked by hand cuts across blocks and rivers. <b>Auto-suggest</b>{' '}
        snaps it onto real roads between your stops and steers it away from the
        ones flagged as flooded — so what you save is something a person can
        actually walk.
      </>
    ),
    tip: 'It keeps your stops. It only decides how to get between them.',
  },
  {
    key: 'details',
    art: ArtResult,
    title: 'Check the details, then save',
    tagalog: 'Tingnan ang distansya at oras bago i-save.',
    body: (
      <>
        The panel shows the number of stops, the distance and the walking time.
        Give the route a name that says who it is for, then <b>Save Route</b>.
      </>
    ),
    tip: 'Walk ETA assumes an adult walking. Allow more for elderly residents, children and anything carried.',
  },
  {
    key: 'shared',
    art: ArtSaved,
    title: 'Saved routes are shared',
    tagalog: 'Nakikita rin ng CDRRMO ang mga na-save ninyong ruta.',
    body: (
      <>
        Everything you save appears in your list here and in CDRRMO&apos;s
        command centre, where it can be reviewed and overridden. Load an old
        route to edit it rather than saving a second version of the same trip.
      </>
    ),
    tip: 'Review your saved routes when a road closes for good — a route nobody re-checked is the one that fails on the night.',
  },
]

/* ── Resident · Flood Map ───────────────────────────────────────────────── */

/* The resident walkthroughs lean harder on Tagalog and on plain words than the
   operator ones. Nobody trained these readers, nobody will, and the screen may
   be open for the first time on the worst night of their year. */

export const residentFloodMapSteps = [
  {
    key: 'colour',
    art: ArtCityRisk,
    title: 'Find your barangay on the map',
    tagalog: 'Hanapin ang inyong barangay at tingnan ang kulay nito.',
    body: (
      <>
        Every barangay is coloured by how much flooding it has right now —{' '}
        <b>green</b> is low, <b>orange</b> moderate, <b>red</b> high. Your own
        barangay is named in the bar at the top, with its level beside it, so
        you can check it without hunting for it on the map.
      </>
    ),
    tip: 'Tap a barangay to see its estimated water depth.',
  },
  {
    key: 'layers',
    art: ArtLayerPanel,
    title: 'Choose what you want to see',
    tagalog: 'Piliin kung ano ang gusto ninyong makita sa mapa.',
    body: (
      <>
        The button on the left of the map opens the layer list. Switch on only
        what you need — the flooded roads, the evacuation centres, the areas
        that flood often — and the rest disappears so the map is easier to
        read.
      </>
    ),
    tip: 'Too many colours at once? Turn everything off, then switch on one layer at a time.',
  },
  {
    key: 'markers',
    art: ArtMarkers,
    title: 'Evacuation centres and blocked roads',
    tagalog: 'Mga evacuation center at ang mga kalsadang hindi madaanan.',
    body: (
      <>
        Green houses are evacuation centres — tap one to see if it is{' '}
        <b>open</b> and how full it is. Orange and red lines are roads that
        CDRRMO has flagged as <b>flooded</b> or <b>closed</b>. Those are the
        ones to stay away from.
      </>
    ),
    tip: 'Never drive or walk into moving water, even if it looks shallow.',
  },
  {
    key: 'report',
    art: ArtReport,
    title: 'Tell CDRRMO what you can see',
    tagalog: 'Iulat ang baha sa inyong lugar — malaking tulong ito.',
    body: (
      <>
        Tap <b>Report Flood Status</b>, pick how bad it is, and send it. You can
        add the depth in feet, a short description and a photo if you have one.
        CDRRMO checks it, and once verified it appears on the map for everyone.
      </>
    ),
    tip: 'Your report is one of the fastest ways CDRRMO learns a street has gone under. Send it even if you think someone else already did.',
  },
  {
    key: 'hazard',
    art: ArtStats,
    title: 'The Hazard tab — your barangay in numbers',
    tagalog: 'Ang tantiyang lalim ng tubig sa inyong barangay.',
    body: (
      <>
        The panel beside the map has a <b>Hazard</b> tab. It shows your
        barangay&apos;s level and the estimated water depth, what each colour
        means in metres, how much of the city is at risk, and the river
        discharge the estimate is built on.
      </>
    ),
    tip: 'These are computer estimates, not measurements from a gauge. What you can see outside your door is always the better guide.',
  },
  {
    key: 'leave',
    art: ArtSolve,
    title: 'When it is time to leave',
    tagalog: 'Kapag kailangan nang lumikas, gamitin ang Evacuation Routing.',
    body: (
      <>
        This screen is for watching. When you actually need to move, open{' '}
        <b>Evacuation Routing</b> — it finds the nearest open evacuation centre
        and the safest way there, avoiding the flooded roads, and can speak the
        directions out loud as you walk.
      </>
    ),
    tip: 'That screen has its own step-by-step guide too, on the same "How to use" button.',
  },
]

/* ── Resident · Road Status ─────────────────────────────────────────────── */

export const residentRoadStatusSteps = [
  {
    key: 'colours',
    art: ArtRoadColours,
    title: 'Which roads to avoid right now',
    tagalog: 'Alin ang mga kalsadang iwasan ngayon.',
    body: (
      <>
        Grey roads are <b>passable</b>. Orange roads are <b>flooded</b> —
        there is water on them. Red roads are <b>closed</b> and cannot be used
        at all. These come from CDRRMO and the barangays, and they change during
        the day.
      </>
    ),
    tip: 'Flooded does not mean "slow down". Water hides holes, open canals and current — treat it as blocked.',
  },
  {
    key: 'list',
    art: ArtFlaggedList,
    title: 'The list beside the map',
    tagalog: 'Nakalista sa gilid ang mga kalsadang may problema.',
    body: (
      <>
        Every road currently flagged is listed on the right with its condition,
        so you can read it as a list instead of hunting for colours on the map.
        The count at the top tells you how many roads are affected.
      </>
    ),
    tip: 'Check this before leaving the house, not after you are already on the road.',
  },
  {
    key: 'route',
    art: ArtSolve,
    title: 'Let the system route around them',
    tagalog: 'Huwag nang mag-isip ng daan — ipa-plano ito sa sistema.',
    body: (
      <>
        You do not have to work out a way around the closures yourself. Open{' '}
        <b>Evacuation Routing</b> and it plans a route that already avoids every
        road on this screen, to the nearest evacuation centre that is open.
      </>
    ),
    tip: 'Conditions change fast. Follow responders and barangay officials on the ground over anything on this screen.',
  },
]
