import { useRef, useState } from 'react'
import { BARANGAYS } from '../../../data/cabuyao.js'
import {
  ADDABLE_BLOCKS, BLOCK_META, COLUMN_CATALOGUE, FILTER_CATALOGUE, PRESETS,
  SORT_CATALOGUE, STAT_CATALOGUE, TABLE_BLOCKS, makeBlock, rid,
} from './reportSpec.js'

/* ============================================================
   Report Builder — the control surface beside the page.

   Division of labour, and it is the thing that makes this screen legible:
   the PANEL owns structure (which blocks, in what order, showing which
   columns, filtered how) and paper setup; the DOCUMENT owns every word.
   Nothing is edited in two places.

   Four tabs, in the order a report is actually assembled: start from a
   template, choose the coverage, arrange the contents, set the paper.
   ============================================================ */

const TABS = [
  { key: 'template', label: 'Template' },
  { key: 'coverage', label: 'Coverage' },
  { key: 'contents', label: 'Contents' },
  { key: 'page', label: 'Page' },
]

export default function ReportBuilder({
  spec, templates, editing,
  onChange, onPageChange, onLetterheadChange, onBlockChange, onOptsChange, onMetaChange,
  onBlocksChange, onMetaListChange,
  onLoadPreset, onLoadTemplate, onSaveTemplate, onDeleteTemplate, onReset,
  onToggleEditing, onPrint,
}) {
  const [tab, setTab] = useState('contents')

  return (
    <aside className="rb">
      <div className="rb-top">
        <div className="rb-top-title">
          <SlidersIcon />
          <div>
            <h2>Report Builder</h2>
            <p>Arrange it here. Click any text on the page to rewrite it.</p>
          </div>
        </div>
        <div className="rb-mode">
          <button
            type="button"
            className={`rb-mode-btn ${editing ? 'on' : ''}`}
            onClick={() => onToggleEditing(true)}
          >
            <PencilIcon /> Edit text
          </button>
          <button
            type="button"
            className={`rb-mode-btn ${editing ? '' : 'on'}`}
            onClick={() => onToggleEditing(false)}
          >
            <EyeIcon /> Preview
          </button>
        </div>
      </div>

      <nav className="rb-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`rb-tab ${tab === t.key ? 'on' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="rb-body">
        {tab === 'template' && (
          <TemplateTab
            spec={spec} templates={templates}
            onLoadPreset={onLoadPreset} onLoadTemplate={onLoadTemplate}
            onSaveTemplate={onSaveTemplate} onDeleteTemplate={onDeleteTemplate}
            onReset={onReset}
          />
        )}
        {tab === 'coverage' && (
          <CoverageTab spec={spec} onChange={onChange} onMetaListChange={onMetaListChange} onMetaChange={onMetaChange} />
        )}
        {tab === 'contents' && (
          <ContentsTab
            spec={spec}
            onBlockChange={onBlockChange}
            onOptsChange={onOptsChange}
            onBlocksChange={onBlocksChange}
          />
        )}
        {tab === 'page' && (
          <PageTab spec={spec} onChange={onChange} onPageChange={onPageChange} onLetterheadChange={onLetterheadChange} />
        )}
      </div>

      <div className="rb-foot">
        <button type="button" className="rb-print" onClick={onPrint}>
          <PrintIcon /> Export PDF
        </button>
        <p className="rb-tip">
          In the print dialog pick <b>Save as PDF</b>, leave margins on{' '}
          <b>Default</b> and switch on <b>Background graphics</b>.
        </p>
      </div>
    </aside>
  )
}

/* ══ Template tab ═══════════════════════════════════════════════════════ */
function TemplateTab({ spec, templates, onLoadPreset, onLoadTemplate, onSaveTemplate, onDeleteTemplate, onReset }) {
  const [name, setName] = useState('')

  return (
    <>
      <Group label="Start from a standard report" hint="Each one is a real CDRRMO document, pre-arranged. Everything stays editable afterwards.">
        <div className="rb-presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="rb-preset" onClick={() => onLoadPreset(p)}>
              <span className="rb-preset-name">{p.name}</span>
              <span className="rb-preset-hint">{p.hint}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group label="Save this arrangement" hint="Keeps the layout, columns, filters and wording so the next one takes a single click.">
        <div className="rb-saverow">
          <input
            className="rb-input"
            placeholder="e.g. Weekly SITREP — Mayor's copy"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) { onSaveTemplate(name.trim()); setName('') }
            }}
          />
          <button
            type="button"
            className="rb-btn primary"
            disabled={!name.trim()}
            onClick={() => { onSaveTemplate(name.trim()); setName('') }}
          >
            Save
          </button>
        </div>
        {templates.length === 0
          ? <p className="rb-empty">No saved templates yet.</p>
          : (
            <ul className="rb-tpls">
              {templates.map((t) => (
                <li key={t.id}>
                  <button type="button" className="rb-tpl-load" onClick={() => onLoadTemplate(t)}>
                    <span className="rb-tpl-name">{t.name}</span>
                    <span className="rb-tpl-date">{new Date(t.savedAt).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </button>
                  <button type="button" className="rb-icon danger" title="Delete template" onClick={() => onDeleteTemplate(t)}>
                    <TrashIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </Group>

      <Group label="Start over">
        <button type="button" className="rb-btn wide" onClick={onReset}>Reset to the default report</button>
        <p className="rb-note">
          Your work is saved in this browser as you go — {spec.blocks.filter((b) => b.on).length} block
          {spec.blocks.filter((b) => b.on).length === 1 ? '' : 's'} currently in the report.
        </p>
      </Group>
    </>
  )
}

/* ══ Coverage tab ═══════════════════════════════════════════════════════ */
function CoverageTab({ spec, onChange, onMetaListChange, onMetaChange }) {
  const scope = spec.scope
  const toggle = (b) => onChange((s) => ({
    scope: s.scope.includes(b) ? s.scope.filter((n) => n !== b) : [...s.scope, b],
  }))

  const addRow = () => onMetaListChange([...spec.meta, { id: rid('m'), label: 'New field', value: '', on: true }])
  const removeRow = (id) => onMetaListChange(spec.meta.filter((m) => m.id !== id))

  return (
    <>
      <Group
        label="Area of coverage"
        hint="Nothing selected means the whole city. Pick barangays to scope every table, figure and the map to those borders."
      >
        <div className="rb-chips">
          <button
            type="button"
            className={`rb-chip ${scope.length === 0 ? 'on' : ''}`}
            onClick={() => onChange({ scope: [] })}
          >
            Whole City
          </button>
          {BARANGAYS.map((b) => (
            <button
              key={b}
              type="button"
              className={`rb-chip ${scope.includes(b) ? 'on' : ''}`}
              onClick={() => toggle(b)}
            >
              {b}
            </button>
          ))}
        </div>
        {scope.length > 0 && (
          <button type="button" className="rb-link" onClick={() => onChange({ scope: [] })}>
            Clear {scope.length} selected
          </button>
        )}
      </Group>

      <Group
        label="Reference block"
        hint="The bordered details under the title. Switch rows off, rename them, or add your own — the values are typed on the page."
      >
        <ul className="rb-metarows">
          {spec.meta.map((m) => (
            <li key={m.id}>
              <label className="rb-check">
                <input type="checkbox" checked={m.on} onChange={() => onMetaChange(m.id, { on: !m.on })} />
                <span>{m.label || 'Untitled field'}</span>
              </label>
              {m.auto
                ? <span className="rb-auto" title="Filled in automatically">auto</span>
                : (
                  <button type="button" className="rb-icon danger" title="Remove field" onClick={() => removeRow(m.id)}>
                    <TrashIcon />
                  </button>
                )}
            </li>
          ))}
        </ul>
        <button type="button" className="rb-btn wide" onClick={addRow}>+ Add a reference field</button>
      </Group>
    </>
  )
}

/* ══ Contents tab ═══════════════════════════════════════════════════════ */
function ContentsTab({ spec, onBlockChange, onOptsChange, onBlocksChange }) {
  const [open, setOpen] = useState(null) // block id whose options are expanded
  const [adding, setAdding] = useState(false)
  const dragId = useRef(null)

  const blocks = spec.blocks
  const move = (id, delta) => {
    const i = blocks.findIndex((b) => b.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= blocks.length) return
    const next = [...blocks]
    const [item] = next.splice(i, 1)
    next.splice(j, 0, item)
    onBlocksChange(next)
  }
  const drop = (overId) => {
    const from = blocks.findIndex((b) => b.id === dragId.current)
    const to = blocks.findIndex((b) => b.id === overId)
    dragId.current = null
    if (from < 0 || to < 0 || from === to) return
    const next = [...blocks]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onBlocksChange(next)
  }
  const remove = (id) => onBlocksChange(blocks.filter((b) => b.id !== id))
  const duplicate = (b) => {
    const i = blocks.findIndex((x) => x.id === b.id)
    const copy = {
      ...b,
      id: rid(b.type),
      title: `${b.title} (copy)`,
      opts: JSON.parse(JSON.stringify(b.opts)),
    }
    if (b.type === 'signatories') copy.opts.rows = copy.opts.rows.map((r) => ({ ...r, id: rid('sig') }))
    const next = [...blocks]
    next.splice(i + 1, 0, copy)
    onBlocksChange(next)
    setOpen(copy.id)
  }
  const add = (type) => {
    const built = makeBlock(type)
    onBlocksChange([...blocks, built])
    setAdding(false)
    // Drop the officer straight into the new block's options — a table added
    // without its columns picked is a blank stare.
    if (type !== 'pagebreak') setOpen(built.id)
  }

  const used = new Set(blocks.map((b) => b.type))
  const available = ADDABLE_BLOCKS.filter((t) => !(BLOCK_META[t].once && used.has(t)))

  return (
    <>
      <Group
        label="Blocks in this report"
        hint="Drag to reorder, or use the arrows. Switch one off to keep it for later without printing it."
      >
        <ul className="rb-blocks">
          {blocks.map((b, i) => (
            <li
              key={b.id}
              className={`rb-block ${b.on ? '' : 'off'} ${open === b.id ? 'open' : ''}`}
              draggable
              onDragStart={() => { dragId.current = b.id }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(b.id)}
            >
              <div className="rb-block-head">
                <span className="rb-grip" title="Drag to reorder"><GripIcon /></span>
                <label className="rb-block-on">
                  <input type="checkbox" checked={b.on} onChange={() => onBlockChange(b.id, { on: !b.on })} />
                </label>
                <button
                  type="button"
                  className="rb-block-name"
                  onClick={() => setOpen(open === b.id ? null : b.id)}
                  disabled={b.type === 'pagebreak'}
                >
                  <span className="rb-block-title">{b.title || BLOCK_META[b.type].label}</span>
                  {/* The kind of block is only worth saying once the heading
                      has been renamed — otherwise every row says its own name
                      back to you twice. */}
                  {b.title && b.title !== BLOCK_META[b.type].label && (
                    <span className="rb-block-type">{BLOCK_META[b.type].label}</span>
                  )}
                </button>
                <div className="rb-block-tools">
                  <button type="button" className="rb-icon" title="Move up" disabled={i === 0} onClick={() => move(b.id, -1)}><UpIcon /></button>
                  <button type="button" className="rb-icon" title="Move down" disabled={i === blocks.length - 1} onClick={() => move(b.id, 1)}><DownIcon /></button>
                  <button type="button" className="rb-icon" title="Duplicate" onClick={() => duplicate(b)}><CopyIcon /></button>
                  <button type="button" className="rb-icon danger" title="Remove" onClick={() => remove(b.id)}><TrashIcon /></button>
                </div>
              </div>
              {open === b.id && (
                <div className="rb-block-opts">
                  <BlockOptions block={b} onOptsChange={(p) => onOptsChange(b.id, p)} />
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="rb-add">
          <button type="button" className="rb-btn wide primary-soft" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add a block'}
          </button>
          {adding && (
            <ul className="rb-addmenu">
              {available.map((t) => (
                <li key={t}>
                  <button type="button" onClick={() => add(t)}>
                    <span className="rb-add-name">{BLOCK_META[t].label}</span>
                    <span className="rb-add-hint">{BLOCK_META[t].hint}</span>
                  </button>
                </li>
              ))}
              {available.length === 0 && <li className="rb-empty">Every block is already in the report.</li>}
            </ul>
          )}
        </div>
      </Group>
    </>
  )
}

/* ── Per-block options ───────────────────────────────────────────────────── */
function BlockOptions({ block, onOptsChange }) {
  const { type, opts } = block

  if (type === 'summary') {
    const toggleStat = (k) => onOptsChange((o) => ({
      stats: o.stats.includes(k) ? o.stats.filter((s) => s !== k) : [...o.stats, k],
    }))
    return (
      <>
        <Check label="Show the headline figures" checked={opts.showStats} onChange={() => onOptsChange({ showStats: !opts.showStats })} />
        {opts.showStats && (
          <>
            <SubLabel>Figures to show ({opts.stats.length})</SubLabel>
            <div className="rb-chips tight">
              {STAT_CATALOGUE.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`rb-chip ${opts.stats.includes(s.key) ? 'on' : ''}`}
                  onClick={() => toggleStat(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
        <Check label="Show the written overview" checked={opts.showNarrative} onChange={() => onOptsChange({ showNarrative: !opts.showNarrative })} />
        {opts.showNarrative && (
          opts.narrative
            ? <button type="button" className="rb-link" onClick={() => onOptsChange({ narrative: '' })}>Restore the auto-written paragraph</button>
            : <p className="rb-note">Written for you from the live figures. Click it on the page to say it your own way.</p>
        )}
      </>
    )
  }

  if (type === 'map') {
    return (
      <>
        <SubLabel>Overlays</SubLabel>
        <div className="rb-optgrid">
          <Check label="Barangay boundaries" checked={opts.boundaries} onChange={() => onOptsChange({ boundaries: !opts.boundaries })} />
          <Check label="Risk shading" checked={opts.barangayRisk} onChange={() => onOptsChange({ barangayRisk: !opts.barangayRisk })} />
          <Check label="Flood-prone areas" checked={opts.floodAreas} onChange={() => onOptsChange({ floodAreas: !opts.floodAreas })} />
          <Check label="Road conditions" checked={opts.roads} onChange={() => onOptsChange({ roads: !opts.roads })} />
          <Check label="Evacuation centres" checked={opts.evac} onChange={() => onOptsChange({ evac: !opts.evac })} />
          <Check label="Barangay names" checked={opts.labels} onChange={() => onOptsChange({ labels: !opts.labels })} />
        </div>
        <Check label="Show the legend" checked={opts.legend} onChange={() => onOptsChange({ legend: !opts.legend })} />
        <SubLabel>Map height</SubLabel>
        <Seg
          value={opts.size}
          onChange={(v) => onOptsChange({ size: v })}
          options={[{ value: 'short', label: 'Short' }, { value: 'standard', label: 'Standard' }, { value: 'tall', label: 'Tall' }]}
        />
      </>
    )
  }

  if (type === 'text') {
    return <p className="rb-note">Write the heading and the body straight on the page — click the words in the document.</p>
  }

  if (type === 'signatories') {
    const setRows = (fn) => onOptsChange((o) => ({ rows: fn(o.rows) }))
    return (
      <>
        <SubLabel>Signatures per row</SubLabel>
        <Seg
          value={String(opts.columns)}
          onChange={(v) => onOptsChange({ columns: Number(v) })}
          options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]}
        />
        <SubLabel>Signatories</SubLabel>
        <ul className="rb-metarows">
          {opts.rows.map((r) => (
            <li key={r.id}>
              <span className="rb-sig-label">{r.label} {r.name || r.position}</span>
              <button
                type="button" className="rb-icon danger" title="Remove"
                onClick={() => setRows((rows) => rows.filter((x) => x.id !== r.id))}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button" className="rb-btn wide"
          onClick={() => setRows((rows) => [...rows, { id: rid('sig'), label: 'Noted by:', name: '', position: '' }])}
        >
          + Add a signatory
        </button>
        <p className="rb-note">Names and positions are typed on the page.</p>
      </>
    )
  }

  if (TABLE_BLOCKS.includes(type)) {
    const cols = COLUMN_CATALOGUE[type]
    const filters = FILTER_CATALOGUE[type] || []
    const on = cols.filter((c) => opts.columns[c.key]).length
    return (
      <>
        <SubLabel>Columns ({on} of {cols.length})</SubLabel>
        <div className="rb-optgrid">
          {cols.map((c) => (
            <Check
              key={c.key}
              label={c.label}
              checked={!!opts.columns[c.key]}
              onChange={() => onOptsChange((o) => ({ columns: { ...o.columns, [c.key]: !o.columns[c.key] } }))}
            />
          ))}
        </div>

        {filters.map((f) => (
          <Select
            key={f.key}
            label={f.label}
            value={opts.filters[f.key]}
            onChange={(v) => onOptsChange((o) => ({ filters: { ...o.filters, [f.key]: v } }))}
            options={f.options}
          />
        ))}

        <Select
          label="Order by"
          value={opts.sort}
          onChange={(v) => onOptsChange({ sort: v })}
          options={SORT_CATALOGUE[type].map((s) => ({ value: s.key, label: s.label }))}
        />

        <div className="rb-inline">
          <label className="rb-mini">
            <span>Show at most</span>
            <input
              type="number" min="0" max="200" className="rb-num"
              value={opts.limit}
              onChange={(e) => onOptsChange({ limit: Math.max(0, Number(e.target.value) || 0) })}
            />
            <span>rows</span>
          </label>
          <span className="rb-note inline">0 = all</span>
        </div>

        <div className="rb-optgrid">
          <Check label="Count in the heading" checked={opts.showCount} onChange={() => onOptsChange({ showCount: !opts.showCount })} />
          <Check label="Shaded alternate rows" checked={opts.zebra} onChange={() => onOptsChange({ zebra: !opts.zebra })} />
        </div>
      </>
    )
  }

  return null
}

/* ══ Page tab ═══════════════════════════════════════════════════════════ */
function PageTab({ spec, onChange, onPageChange, onLetterheadChange }) {
  const page = spec.page
  const set = onPageChange

  return (
    <>
      <Group label="Paper">
        <Seg value={page.paper} onChange={(v) => set({ paper: v })}
          options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
        <SubLabel>Orientation</SubLabel>
        <Seg value={page.orientation} onChange={(v) => set({ orientation: v })}
          options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
        <SubLabel>Margins</SubLabel>
        <Seg value={page.margin} onChange={(v) => set({ margin: v })}
          options={[{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }]} />
        <p className="rb-note">The page on screen is the exact width of the printed sheet, so nothing shifts at the print dialog.</p>
      </Group>

      <Group label="Type">
        <Seg value={page.typeface} onChange={(v) => set({ typeface: v })}
          options={[{ value: 'serif', label: 'Serif — official' }, { value: 'sans', label: 'Sans — modern' }]} />
        <SubLabel>Spacing</SubLabel>
        <Seg value={page.density} onChange={(v) => set({ density: v })}
          options={[{ value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }, { value: 'relaxed', label: 'Relaxed' }]} />
        <SubLabel>Section numbering</SubLabel>
        <Seg value={page.numbering} onChange={(v) => set({ numbering: v })}
          options={[{ value: 'roman', label: 'I, II, III' }, { value: 'numeric', label: '1, 2, 3' }, { value: 'none', label: 'None' }]} />
        <SubLabel>Accent</SubLabel>
        <Seg value={page.accent} onChange={(v) => set({ accent: v })}
          options={[{ value: 'navy', label: 'Navy' }, { value: 'red', label: 'CDRRMO red' }, { value: 'mono', label: 'Black & white' }]} />
      </Group>

      <Group label="Letterhead and furniture">
        <Check label="Show the letterhead" checked={spec.letterhead.show}
          onChange={() => onLetterheadChange({ show: !spec.letterhead.show })} />
        <Check label="Show the CDRRMO seal" checked={spec.letterhead.logo}
          onChange={() => onLetterheadChange({ logo: !spec.letterhead.logo })} />
        <Check label="Show the classification banner" checked={spec.showClassification}
          onChange={() => onChange({ showClassification: !spec.showClassification })} />
        <Check label="Show the closing note" checked={spec.showFooter}
          onChange={() => onChange({ showFooter: !spec.showFooter })} />
        <p className="rb-note">Every line of the letterhead is editable on the page, seal included.</p>
      </Group>
    </>
  )
}

/* ══ Small controls ═════════════════════════════════════════════════════ */
function Group({ label, hint, children }) {
  return (
    <section className="rb-group">
      <h3 className="rb-group-label">{label}</h3>
      {hint && <p className="rb-group-hint">{hint}</p>}
      {children}
    </section>
  )
}
function SubLabel({ children }) {
  return <div className="rb-sublabel">{children}</div>
}
function Check({ label, checked, onChange }) {
  return (
    <label className="rb-check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}
function Seg({ value, onChange, options }) {
  return (
    <div className="rb-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="rb-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

/* ══ Icons ══════════════════════════════════════════════════════════════ */
const S = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2 }
function SlidersIcon() { return <svg viewBox="0 0 24 24" {...S}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg> }
function PencilIcon() { return <svg viewBox="0 0 24 24" {...S}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg> }
function EyeIcon() { return <svg viewBox="0 0 24 24" {...S}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg> }
function PrintIcon() { return <svg viewBox="0 0 24 24" {...S}><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg> }
function TrashIcon() { return <svg viewBox="0 0 24 24" {...S}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg> }
function UpIcon() { return <svg viewBox="0 0 24 24" {...S}><polyline points="18 15 12 9 6 15" /></svg> }
function DownIcon() { return <svg viewBox="0 0 24 24" {...S}><polyline points="6 9 12 15 18 9" /></svg> }
function CopyIcon() { return <svg viewBox="0 0 24 24" {...S}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg> }
function GripIcon() { return <svg viewBox="0 0 24 24" {...S}><circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" /></svg> }
