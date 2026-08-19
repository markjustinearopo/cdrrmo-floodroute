import { useMemo, useState } from 'react'
import ConfirmDialog from '../ConfirmDialog.jsx'

/**
 * The one record-list surface: stat tiles → filter chips → search → table →
 * row actions.
 *
 * Nine admin screens implemented this same pattern in nine files, and the
 * differences between them were drift rather than design. Nobody decided the
 * barangay roster should have no filter chips; it just never got them. Nobody
 * decided four screens should delete without asking; that happened one file at
 * a time until Phase 0 went and fixed each by hand.
 *
 * So the important thing here is not the markup — it is that `onDelete` cannot
 * be wired without a confirmation. This component owns the ConfirmDialog. A
 * caller passes the delete function; it does not get to choose whether the
 * user is asked first. That makes Phase 0's bug class structurally impossible
 * to reintroduce rather than merely fixed for now.
 *
 * props
 *   rows         — every record; search + filters are applied in here
 *   rowKey(row)  — stable React key (defaults to row.id)
 *   rowLabel(row)— human name, used in the default delete message
 *
 *   stats        — [{ color, value, label }] tiles above the toolbar
 *   filters      — [{ key, label, test(row) }] chips; 'all' needs no test
 *   searchKeys(row) → string  — the haystack for the search box
 *   searchPlaceholder
 *   toolbarExtra — node rendered at the end of the toolbar (bulk actions, …)
 *
 *   columns      — [{ key, header, render(row), align, className, headerStyle }]
 *   renderItem   — alternative to `columns` for list/card bodies (Notifications,
 *                  Integrations) that share the chrome but not the table
 *   listClassName— wrapper class when using renderItem
 *
 *   onEdit(row)      — adds an "Edit" row action (label via editLabel)
 *   editLabel(row)   — defaults to 'Edit'
 *   rowActions(row)  — [{ label, onClick, subtle, disabled, title }] extra actions
 *   onDelete(row)    — the real delete. ALWAYS confirmed first.
 *   deleteLabel(row) — row-action text, defaults to 'Delete'
 *   deleteConfirm(row) → { title, message, confirmLabel } to override the default
 *   canDelete(row)   → false to disable the action for one row
 *
 *   selection    — optional bulk select:
 *                  { selected: Set, onToggle(row), onToggleAll(visibleRows, allOn) }
 *                  Bulk select belongs here rather than in the caller because
 *                  the "select all" checkbox has to agree with whatever the
 *                  filters and search are currently showing — and that is
 *                  precisely what this component now owns.
 *   bulkBar      — node rendered above the table when something is selected
 *
 *   empty        — { title, sub } shown when nothing matches
 *   emptyAll     — { title, sub } shown when there are no records at all
 */
export default function RecordList({
  rows = [],
  rowKey = (r) => r.id,
  rowLabel = (r) => r?.name || 'this record',

  stats,
  filters,
  searchKeys,
  searchPlaceholder = 'Search…',
  toolbarExtra,

  columns,
  renderItem,
  listClassName = '',

  onEdit,
  editLabel = () => 'Edit',
  rowActions,
  onDelete,
  deleteLabel = () => 'Delete',
  deleteConfirm,
  canDelete = () => true,

  selection,
  bulkBar,

  empty = { title: 'Nothing matches this view', sub: 'Try a different filter or clear your search.' },
  emptyAll,
}) {
  const [filter, setFilter] = useState(filters?.[0]?.key || 'all')
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  const visible = useMemo(() => {
    const active = filters?.find((f) => f.key === filter)
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (active?.test && !active.test(row)) return false
      if (q && searchKeys && !searchKeys(row).toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, filters, filter, query, searchKeys])

  const showEmptyAll = rows.length === 0 && emptyAll
  const emptyCopy = showEmptyAll ? emptyAll : empty

  function actionsFor(row) {
    const list = []
    if (onEdit) list.push({ label: editLabel(row), onClick: () => onEdit(row) })
    if (rowActions) list.push(...(rowActions(row) || []))
    if (onDelete) {
      list.push({
        label: deleteLabel(row),
        onClick: () => setPendingDelete(row),
        subtle: true,
        disabled: !canDelete(row),
      })
    }
    return list
  }

  const hasActions = Boolean(onEdit || rowActions || onDelete)
  const colCount = (columns?.length || 0) + (hasActions ? 1 : 0) + (selection ? 1 : 0)
  const allVisibleSelected = Boolean(
    selection && visible.length > 0 && visible.every((r) => selection.selected.has(rowKey(r))),
  )

  const confirmCopy = pendingDelete
    ? {
      title: 'Delete this record?',
      message: `Delete “${rowLabel(pendingDelete)}”? This cannot be undone.`,
      confirmLabel: 'Delete',
      ...(deleteConfirm ? deleteConfirm(pendingDelete) : null),
    }
    : null

  return (
    <>
      {stats?.length > 0 && (
        <div className="mng-stats">
          {stats.map((s) => (
            <div className={`mng-stat ${s.color || ''}`} key={s.label}>
              <div className="mng-stat-val">{s.value}</div>
              <div className="mng-stat-lbl">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {(searchKeys || filters?.length > 0 || toolbarExtra) && (
        <div className="mng-toolbar">
          {searchKeys && (
            <div className="mng-search">
              <SearchIcon />
              <input
                type="search"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {filters?.length > 0 && (
            <div className="mng-filters">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`mng-chip ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {toolbarExtra}
        </div>
      )}

      {selection && selection.selected.size > 0 && bulkBar}

      <div className="mng-card">
        {columns ? (
          <table className="mng-table">
            <thead>
              <tr>
                {selection && (
                  <th className="mng-check-col">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() => selection.onToggleAll(visible, allVisibleSelected)}
                      aria-label="Select all shown"
                    />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} style={c.headerStyle}>{c.header}</th>
                ))}
                {hasActions && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="mng-empty">
                    <span className="mng-empty-strong">{emptyCopy.title}</span>
                    {emptyCopy.sub}
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={rowKey(row)}>
                    {selection && (
                      <td className="mng-check-col">
                        <input
                          type="checkbox"
                          checked={selection.selected.has(rowKey(row))}
                          onChange={() => selection.onToggle(row)}
                          aria-label={`Select ${rowLabel(row)}`}
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={c.className} style={c.align ? { textAlign: c.align } : undefined}>
                        {c.render(row)}
                      </td>
                    ))}
                    {hasActions && (
                      <td>
                        <div className="mng-row-actions">
                          {actionsFor(row).map((a) => (
                            <button
                              key={a.label}
                              type="button"
                              className={`mng-link ${a.subtle ? 'subtle' : ''}`}
                              onClick={a.onClick}
                              disabled={a.disabled}
                              title={a.title}
                            >
                              {a.label}
                            </button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : visible.length === 0 ? (
          <div className="mng-empty mng-empty--block">
            <span className="mng-empty-strong">{emptyCopy.title}</span>
            {emptyCopy.sub}
          </div>
        ) : (
          <div className={listClassName}>
            {visible.map((row) => (
              <div key={rowKey(row)} className="rl-item">
                {renderItem(row, { actions: actionsFor(row) })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Not optional: a caller wires the delete, this decides to ask first. */}
      {pendingDelete && (
        <ConfirmDialog
          title={confirmCopy.title}
          message={confirmCopy.message}
          confirmLabel={confirmCopy.confirmLabel}
          tone="danger"
          onConfirm={() => {
            onDelete(pendingDelete)
            setPendingDelete(null)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
}
