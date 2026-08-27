/* ============================================================
   Report specification — the one editable object behind the whole
   report builder.

   Everything an officer can change about a report lives in this shape: the
   letterhead wording, the reference block, which blocks appear and IN WHAT
   ORDER, which columns each table shows, how each table is filtered and
   sorted, and how the paper is set up. The builder panel edits the structure;
   the document itself edits the words. Both write to the same object, so a
   report can be saved as a reusable template and loaded back exactly.

   Blocks are an ORDERED ARRAY, not a fixed set of flags. That is what lets an
   officer duplicate a table (e.g. one road table filtered to CLOSED, another
   to FLOODED), drop a page break between them, and move a written section
   above the map — the things a real office needs and a fixed layout refuses.
   ============================================================ */

/* ── Paper ────────────────────────────────────────────────────────────────
   Real sheet sizes at 96dpi. The document renders at exactly these numbers on
   screen, so what an officer lays out is what comes off the printer instead of
   a surprise at the print dialog. Both the document (which uses them for its
   width) and the page (which uses them to work out the fit-to-width zoom) read
   them from here so the two can never drift apart. */
export const SHEET_MM = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
}
export const MARGIN_MM = { narrow: 12, normal: 18, wide: 25 }
const MM_PX = 96 / 25.4

/** { contentPx, padPx, totalPx } for a page setup. */
export function sheetPx(page) {
  const sheet = SHEET_MM[page.paper] || SHEET_MM.a4
  const marginMm = MARGIN_MM[page.margin] ?? MARGIN_MM.normal
  const widthMm = page.orientation === 'landscape' ? sheet.h : sheet.w
  const padPx = Math.round(marginMm * MM_PX)
  const contentPx = Math.round((widthMm - marginMm * 2) * MM_PX)
  return { contentPx, padPx, marginMm, totalPx: contentPx + padPx * 2 }
}

/* Unique-enough ids for blocks, meta rows and signatories. Report specs are
   short-lived, per-browser objects; a counter plus the clock is plenty. */
let seq = 0
export function rid(prefix = 'b') {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

/* ── Column catalogue ─────────────────────────────────────────────────────
   Every column a table block CAN show, with the ones it shows by default.
   The document renderer maps these keys onto cell values. `num` right-aligns
   the column, which is what makes a printed figure table readable. */
export const COLUMN_CATALOGUE = {
  floodAreas: [
    { key: 'name', label: 'Area / Road', on: true },
    { key: 'barangay', label: 'Barangay', on: true },
    { key: 'depth', label: 'Recorded Depth', on: true, num: true },
    { key: 'severity', label: 'Severity', on: false },
    { key: 'type', label: 'Type', on: true },
    { key: 'causes', label: 'Cause', on: true },
    { key: 'source', label: 'Recorded Under', on: true },
    { key: 'notes', label: 'Remarks', on: false },
  ],
  roads: [
    { key: 'name', label: 'Road', on: true },
    { key: 'barangay', label: 'Barangay', on: false },
    { key: 'status', label: 'Condition', on: true },
    { key: 'depth', label: 'Flood Depth', on: true, num: true },
    { key: 'reason', label: 'Reason', on: false },
    { key: 'updated', label: 'Last Updated', on: false },
  ],
  evac: [
    { key: 'name', label: 'Evacuation Centre', on: true },
    { key: 'barangay', label: 'Barangay', on: true },
    { key: 'capacity', label: 'Capacity', on: true, num: true },
    { key: 'occupancy', label: 'Occupancy', on: true, num: true },
    { key: 'available', label: 'Vacancy', on: false, num: true },
    { key: 'utilisation', label: 'Utilisation', on: false, num: true },
    { key: 'status', label: 'Status', on: true },
    { key: 'manager', label: 'Camp Manager', on: false },
    { key: 'contact', label: 'Contact', on: false },
  ],
  alerts: [
    { key: 'level', label: 'Level', on: true },
    { key: 'title', label: 'Alert', on: true },
    { key: 'barangay', label: 'Barangay', on: true },
    { key: 'message', label: 'Advisory', on: false },
    { key: 'issued', label: 'Issued', on: true },
  ],
  incidents: [
    { key: 'type', label: 'Incident', on: true },
    { key: 'barangay', label: 'Barangay', on: true },
    { key: 'priority', label: 'Priority', on: true },
    { key: 'status', label: 'Status', on: true },
    { key: 'team', label: 'Team Assigned', on: true },
    { key: 'location', label: 'Location', on: false },
    { key: 'reported', label: 'Reported', on: false },
  ],
  barangays: [
    { key: 'name', label: 'Barangay', on: true },
    { key: 'level', label: 'Risk Level', on: true },
    { key: 'depth', label: 'Modelled Depth', on: true, num: true },
    { key: 'areas', label: 'Flood-Prone Areas', on: false, num: true },
    { key: 'roads', label: 'Roads Flagged', on: false, num: true },
    { key: 'evac', label: 'Evac Centres', on: false, num: true },
  ],
}

/* Sort choices offered per table. `key` is resolved by the document. */
export const SORT_CATALOGUE = {
  floodAreas: [
    { key: 'depth', label: 'Deepest first' },
    { key: 'name', label: 'Area name (A–Z)' },
    { key: 'barangay', label: 'Barangay (A–Z)' },
  ],
  roads: [
    { key: 'name', label: 'Road name (A–Z)' },
    { key: 'severity', label: 'Closed first' },
    { key: 'depth', label: 'Deepest first' },
  ],
  evac: [
    { key: 'name', label: 'Centre name (A–Z)' },
    { key: 'barangay', label: 'Barangay (A–Z)' },
    { key: 'occupancy', label: 'Most occupied first' },
    { key: 'available', label: 'Most vacancy first' },
  ],
  alerts: [
    { key: 'level', label: 'Highest level first' },
    { key: 'issued', label: 'Most recent first' },
    { key: 'barangay', label: 'Barangay (A–Z)' },
  ],
  incidents: [
    { key: 'priority', label: 'Highest priority first' },
    { key: 'reported', label: 'Most recent first' },
    { key: 'barangay', label: 'Barangay (A–Z)' },
  ],
  barangays: [
    { key: 'depth', label: 'Highest risk first' },
    { key: 'name', label: 'Barangay (A–Z)' },
  ],
}

/* Per-table filters. Each is a plain select the document applies before sort. */
export const FILTER_CATALOGUE = {
  floodAreas: [
    { key: 'severity', label: 'Severity', options: [
      { value: 'all', label: 'All severities' },
      { value: 'high', label: 'High only' },
      { value: 'moderate', label: 'Moderate and above' },
    ] },
    { key: 'type', label: 'Type', options: [
      { value: 'all', label: 'All types' },
      { value: 'flood', label: 'Standing flood' },
      { value: 'flash_flood', label: 'Flash flood' },
      { value: 'gutter', label: 'Gutter-deep' },
    ] },
  ],
  roads: [
    { key: 'status', label: 'Condition', options: [
      { value: 'all', label: 'Flooded and closed' },
      { value: 'blocked', label: 'Closed only' },
      { value: 'flooded', label: 'Flooded only' },
    ] },
  ],
  evac: [
    { key: 'status', label: 'Status', options: [
      { value: 'all', label: 'All centres' },
      { value: 'operational', label: 'Open and full' },
      { value: 'open', label: 'Open only' },
      { value: 'full', label: 'Full only' },
      { value: 'closed', label: 'Closed only' },
    ] },
  ],
  alerts: [
    { key: 'level', label: 'Level', options: [
      { value: 'all', label: 'All levels' },
      { value: 'high', label: 'High only' },
      { value: 'moderate', label: 'Moderate and above' },
    ] },
  ],
  incidents: [
    { key: 'priority', label: 'Priority', options: [
      { value: 'all', label: 'All priorities' },
      { value: 'critical', label: 'Critical only' },
      { value: 'high', label: 'High and above' },
    ] },
  ],
  barangays: [
    { key: 'level', label: 'Risk', options: [
      { value: 'all', label: 'All barangays' },
      { value: 'atrisk', label: 'At-risk only (Low and above)' },
      { value: 'high', label: 'High risk only' },
    ] },
  ],
}

/* Figures the Executive Summary can put in its headline row. */
export const STAT_CATALOGUE = [
  { key: 'floodAreas', label: 'Flood-prone areas' },
  { key: 'roadsClosed', label: 'Roads closed' },
  { key: 'roadsFlooded', label: 'Roads flooded' },
  { key: 'evacOpen', label: 'Evac centres open' },
  { key: 'evacCapacity', label: 'Shelter capacity' },
  { key: 'evacOccupancy', label: 'Persons sheltered' },
  { key: 'alerts', label: 'Active alerts' },
  { key: 'incidents', label: 'Open incidents' },
  { key: 'highRisk', label: 'High-risk barangays' },
  { key: 'deepest', label: 'Deepest on record' },
]

/* ── Block catalogue ──────────────────────────────────────────────────────
   `once: true` blocks can only appear a single time (a second Situation Map
   would just be the same picture twice). Everything else may be added again
   and filtered differently — the point of an ordered block list. */
export const BLOCK_META = {
  summary: { label: 'Executive Summary', hint: 'Headline figures and a written overview', once: true },
  map: { label: 'Situation Map', hint: 'Vector map of Cabuyao with the overlays you choose', once: true },
  floodAreas: { label: 'Flood-Prone Areas', hint: 'The documented flood record for the coverage' },
  roads: { label: 'Road Conditions', hint: 'Roads currently flagged flooded or closed' },
  evac: { label: 'Evacuation Centres', hint: 'Capacity, occupancy and operating status' },
  alerts: { label: 'Active Alerts', hint: 'Alerts in force at the time of generation' },
  incidents: { label: 'Open Incidents', hint: 'Unresolved incidents and the teams assigned' },
  barangays: { label: 'Barangay Risk Summary', hint: 'Modelled flood depth per barangay' },
  text: { label: 'Written Section', hint: 'Your own heading and paragraphs — findings, recommendations' },
  signatories: { label: 'Signature Block', hint: 'Prepared / reviewed / approved signature lines' },
  pagebreak: { label: 'Page Break', hint: 'Start whatever follows on a fresh page' },
}

/* Blocks offered in the "Add a block" menu, in the order an officer thinks of
   them: the writing first, then the data, then the paper furniture. */
export const ADDABLE_BLOCKS = [
  'text', 'summary', 'map',
  'floodAreas', 'roads', 'evac', 'alerts', 'incidents', 'barangays',
  'signatories', 'pagebreak',
]

export const TABLE_BLOCKS = ['floodAreas', 'roads', 'evac', 'alerts', 'incidents', 'barangays']

function defaultColumns(type) {
  const cat = COLUMN_CATALOGUE[type] || []
  return Object.fromEntries(cat.map((c) => [c.key, c.on]))
}

function defaultFilters(type) {
  const cat = FILTER_CATALOGUE[type] || []
  return Object.fromEntries(cat.map((f) => [f.key, f.options[0].value]))
}

/** The starting options for a freshly added block of `type`. */
export function defaultOpts(type) {
  if (TABLE_BLOCKS.includes(type)) {
    return {
      columns: defaultColumns(type),
      filters: defaultFilters(type),
      sort: SORT_CATALOGUE[type][0].key,
      limit: 0, // 0 = no cap
      showCount: true,
      zebra: true,
      note: '',
    }
  }
  if (type === 'summary') {
    return {
      showStats: true,
      stats: ['floodAreas', 'roadsClosed', 'roadsFlooded', 'evacOpen', 'alerts', 'incidents'],
      showNarrative: true,
      narrative: '', // blank = use the auto-written paragraph
    }
  }
  if (type === 'map') {
    return {
      boundaries: true,
      barangayRisk: true,
      floodAreas: true,
      roads: true,
      evac: true,
      labels: true,
      legend: true,
      size: 'standard', // short | standard | tall
      caption: '',
    }
  }
  if (type === 'text') {
    return { body: '' }
  }
  if (type === 'signatories') {
    return {
      columns: 2,
      rows: [
        { id: rid('sig'), label: 'Prepared by:', name: '', position: 'Operations Officer, CDRRMO' },
        { id: rid('sig'), label: 'Reviewed by:', name: '', position: 'Chief, Operations and Warning Division' },
        { id: rid('sig'), label: 'Approved by:', name: '', position: 'CDRRMO Head' },
      ],
    }
  }
  return {}
}

/** A new block ready to drop into the contents list. */
export function makeBlock(type, overrides = {}) {
  return {
    id: rid(type),
    type,
    // Signature lines carry no heading on a real document — you do not write
    // "SIGNATURE BLOCK" above them. It starts empty and can still be titled
    // ("Certified by", "Attestation") by typing on the page.
    title: type === 'signatories' ? '' : (BLOCK_META[type]?.label || 'Section'),
    on: true,
    opts: defaultOpts(type),
    ...overrides,
  }
}

/** Reference number an officer would actually write: CDRRMO-CAB-20260827-01. */
export function defaultReference(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `CDRRMO-CAB-${y}${m}${d}-01`
}

function defaultMeta() {
  return [
    { id: rid('m'), label: 'Reference No.', value: defaultReference(), on: true },
    { id: rid('m'), label: 'Date & Time Generated', value: '', auto: 'generated', on: true },
    { id: rid('m'), label: 'Area of Coverage', value: '', auto: 'scope', on: true },
    { id: rid('m'), label: 'Covering Period', value: 'As of the time of generation', on: true },
    { id: rid('m'), label: 'Prepared By', value: 'City Disaster Risk Reduction and Management Office', on: true },
    { id: rid('m'), label: 'Submitted To', value: 'Office of the City Mayor', on: true },
  ]
}

/** The letterhead an LGU document carries, wording and all — every line editable. */
function defaultLetterhead() {
  return {
    show: true,
    logo: true,
    line1: 'Republic of the Philippines',
    line2: 'Province of Laguna',
    line3: 'CITY OF CABUYAO',
    office: 'City Disaster Risk Reduction and Management Office',
    address: 'Cabuyao City Hall Complex, Brgy. Poblacion Uno, City of Cabuyao, Laguna',
  }
}

/** The blank slate: a complete, formal, whole-city situation report. */
export function defaultSpec() {
  return {
    version: 2,
    title: 'Flood and Road Conditions Report',
    subtitle: 'Consolidated situational report of the City of Cabuyao',
    classification: 'FOR OFFICIAL USE ONLY',
    showClassification: true,
    letterhead: defaultLetterhead(),
    meta: defaultMeta(),
    scope: [], // [] = whole city
    page: {
      paper: 'a4', // a4 | letter
      orientation: 'portrait',
      margin: 'normal', // narrow | normal | wide
      density: 'standard', // compact | standard | relaxed
      typeface: 'serif', // serif | sans
      numbering: 'roman', // roman | numeric | none
      accent: 'navy', // navy | red | mono
    },
    footerNote: 'This is a system-generated situational report. Ground conditions change rapidly — verify with the responding team before acting on it.',
    showFooter: true,
    blocks: [
      makeBlock('summary'),
      makeBlock('map'),
      makeBlock('floodAreas'),
      makeBlock('roads'),
      makeBlock('evac'),
      makeBlock('alerts'),
      makeBlock('incidents'),
      makeBlock('barangays'),
      makeBlock('signatories'),
    ],
  }
}

/* ── Built-in templates ───────────────────────────────────────────────────
   Each one is a real document an office produces, pre-configured. They are
   starting points: everything stays editable afterwards. */
export const PRESETS = [
  {
    id: 'sitrep',
    name: 'Situation Report (SITREP)',
    hint: 'The full picture — every section, whole city.',
    build: () => defaultSpec(),
  },
  {
    id: 'exec-brief',
    name: 'Executive Brief',
    hint: 'One page for the Mayor: figures, map, risk table.',
    build: () => {
      const s = defaultSpec()
      s.title = 'Executive Brief on Flood Situation'
      s.subtitle = 'Command summary for the Office of the City Mayor'
      s.blocks = [
        makeBlock('summary'),
        makeBlock('map', { opts: { ...defaultOpts('map'), size: 'short', roads: true, evac: false } }),
        makeBlock('barangays', {
          title: 'Barangays Requiring Attention',
          opts: { ...defaultOpts('barangays'), filters: { level: 'atrisk' }, limit: 8 },
        }),
        makeBlock('signatories', { opts: { ...defaultOpts('signatories'), columns: 2, rows: defaultOpts('signatories').rows.slice(0, 2) } }),
      ]
      return s
    },
  },
  {
    id: 'flood-inventory',
    name: 'Flood-Prone Areas Inventory',
    hint: 'The documented flood record, in full detail.',
    build: () => {
      const s = defaultSpec()
      s.title = 'Inventory of Flood-Prone Areas'
      s.subtitle = 'Documented flooding record, City of Cabuyao'
      s.page.orientation = 'landscape'
      const cols = { ...defaultColumns('floodAreas'), severity: true, notes: true }
      s.blocks = [
        makeBlock('map', { opts: { ...defaultOpts('map'), roads: false, evac: false, barangayRisk: false } }),
        makeBlock('floodAreas', { opts: { ...defaultOpts('floodAreas'), columns: cols } }),
        makeBlock('signatories'),
      ]
      return s
    },
  },
  {
    id: 'road-advisory',
    name: 'Road Advisory',
    hint: 'Closed roads first, then flooded — for traffic and responders.',
    build: () => {
      const s = defaultSpec()
      s.title = 'Road Condition Advisory'
      s.subtitle = 'Impassable and flooded road segments'
      s.blocks = [
        makeBlock('text', {
          title: 'Advisory',
          opts: { body: 'The following road segments are affected by flooding as of the time of this advisory. Motorists and responding units are advised to avoid the closed segments and to observe extreme caution on the flooded ones.' },
        }),
        makeBlock('map', { opts: { ...defaultOpts('map'), floodAreas: false, evac: false, barangayRisk: false } }),
        makeBlock('roads', {
          title: 'Closed to Traffic',
          opts: { ...defaultOpts('roads'), filters: { status: 'blocked' }, columns: { ...defaultColumns('roads'), barangay: true, reason: true } },
        }),
        makeBlock('roads', {
          title: 'Passable with Caution — Flooded',
          opts: { ...defaultOpts('roads'), filters: { status: 'flooded' }, sort: 'depth', columns: { ...defaultColumns('roads'), barangay: true } },
        }),
        makeBlock('signatories'),
      ]
      return s
    },
  },
  {
    id: 'evac-status',
    name: 'Evacuation Status Report',
    hint: 'Shelter capacity, occupancy and vacancy.',
    build: () => {
      const s = defaultSpec()
      s.title = 'Evacuation Centre Status Report'
      s.subtitle = 'Shelter capacity and occupancy, City of Cabuyao'
      s.blocks = [
        makeBlock('summary', {
          opts: { ...defaultOpts('summary'), stats: ['evacOpen', 'evacCapacity', 'evacOccupancy', 'alerts'] },
        }),
        makeBlock('evac', {
          opts: {
            ...defaultOpts('evac'),
            columns: { ...defaultColumns('evac'), available: true, utilisation: true, manager: true, contact: true },
            sort: 'occupancy',
          },
        }),
        makeBlock('map', { opts: { ...defaultOpts('map'), floodAreas: false, roads: false } }),
        makeBlock('signatories'),
      ]
      return s
    },
  },
  {
    id: 'blank',
    name: 'Blank Document',
    hint: 'Letterhead, one written section, signatures. Build it yourself.',
    build: () => {
      const s = defaultSpec()
      s.title = 'Memorandum'
      s.subtitle = ''
      s.blocks = [
        makeBlock('text', { title: 'Subject', opts: { body: '' } }),
        makeBlock('signatories'),
      ]
      return s
    },
  },
]

/* ── Persistence ──────────────────────────────────────────────────────────
   The working draft is auto-saved so an officer can wander off mid-report and
   come back to it; named templates are their own list. Both are per-browser —
   this is a document being drafted, not shared system state. */
const DRAFT_KEY = 'cdrrmo_report_draft'
const TEMPLATE_KEY = 'cdrrmo_report_templates'

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode / quota — the report still works, it just will not persist */
  }
}

export function loadDraft() {
  const raw = read(DRAFT_KEY, null)
  return raw && raw.version === 2 && Array.isArray(raw.blocks) ? migrate(raw) : null
}
export function saveDraft(spec) { write(DRAFT_KEY, spec) }
export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* nothing to clear */ }
}

export function loadTemplates() {
  const list = read(TEMPLATE_KEY, [])
  return Array.isArray(list) ? list : []
}
export function saveTemplate(name, spec) {
  const list = loadTemplates()
  const entry = { id: rid('tpl'), name, savedAt: Date.now(), spec }
  const next = [entry, ...list.filter((t) => t.name !== name)].slice(0, 24)
  write(TEMPLATE_KEY, next)
  return next
}
export function deleteTemplate(id) {
  const next = loadTemplates().filter((t) => t.id !== id)
  write(TEMPLATE_KEY, next)
  return next
}

/**
 * Fill in anything a stored spec is missing. Templates saved before a column
 * or option existed must keep working — an officer's saved "Road Advisory"
 * should not break because the roads table gained a column.
 */
export function migrate(spec) {
  const base = defaultSpec()
  const out = {
    ...base,
    ...spec,
    letterhead: { ...base.letterhead, ...(spec.letterhead || {}) },
    page: { ...base.page, ...(spec.page || {}) },
    meta: Array.isArray(spec.meta) && spec.meta.length ? spec.meta : base.meta,
    scope: Array.isArray(spec.scope) ? spec.scope : [],
    blocks: (Array.isArray(spec.blocks) ? spec.blocks : base.blocks).map((b) => {
      const d = defaultOpts(b.type)
      const opts = { ...d, ...(b.opts || {}) }
      if (TABLE_BLOCKS.includes(b.type)) {
        opts.columns = { ...d.columns, ...(b.opts?.columns || {}) }
        opts.filters = { ...d.filters, ...(b.opts?.filters || {}) }
      }
      if (b.type === 'signatories') {
        opts.rows = Array.isArray(b.opts?.rows) && b.opts.rows.length ? b.opts.rows : d.rows
      }
      return { id: b.id || rid(b.type), type: b.type, title: b.title ?? BLOCK_META[b.type]?.label ?? 'Section', on: b.on !== false, opts }
    }),
  }
  return out
}
