import { useMemo, useState } from 'react'
import ResidentLayout from '../../components/resident/ResidentLayout.jsx'
import FloodReportModal from '../../components/resident/FloodReportModal.jsx'
import { useFloodReports } from '../../context/AdminDataContext.jsx'
import {
  FLOOD_LEVEL_META,
  VERIFY_STATUS_META,
  formatReportDepth,
} from '../../data/floodReports.js'
import api from '../../services/api.js'
import './FloodReports.css'

/**
 * CDRRMO Resident — Report Flood Status.
 *
 * The resident's entry point into the flood-reporting flow: a big "Report Flood
 * Status" button that opens the submission modal, plus the live status of every
 * report they've filed. A report moves Pending → Approved (now public on the
 * map) or Rejected, and the CDRRMO decision + notes appear here as they happen.
 */
export default function FloodReports() {
  const { floodReports } = useFloodReports()
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')

  const user = api.getUser?.()
  const myId = user?.id

  const mine = useMemo(
    () => floodReports
      .filter((r) => (myId != null && r.userId === myId))
      .sort((a, b) => (b.reportedAt || 0) - (a.reportedAt || 0)),
    [floodReports, myId],
  )

  const stats = useMemo(() => ({
    pending: mine.filter((r) => r.status === 'pending').length,
    approved: mine.filter((r) => r.status === 'approved').length,
    rejected: mine.filter((r) => r.status === 'rejected').length,
  }), [mine])

  function flash(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3200)
  }

  return (
    <ResidentLayout>
      <div className="frp">
        <div className="frp-head">
          <div>
            <div className="frp-title">Report Flood Status</div>
            <div className="frp-subtitle">
              Spotted flooding in your area? Send CDRRMO a real-time report. Verified reports
              appear on the public flood map and help route people to safety.
            </div>
          </div>
          <button type="button" className="frp-report-btn" onClick={() => setShowModal(true)}>
            <PlusIcon /> Report Flood Status
          </button>
        </div>

        <div className="frp-stats">
          <Stat color="#d97706" value={stats.pending} label="Pending Verification" />
          <Stat color="#16a34a" value={stats.approved} label="Approved" />
          <Stat color="#dc2626" value={stats.rejected} label="Rejected" />
        </div>

        <div className="frp-section-title">My Reports</div>

        {mine.length === 0 ? (
          <div className="frp-empty">
            <WaterIcon />
            <div className="frp-empty-title">You haven't filed any reports yet</div>
            <div className="frp-empty-sub">
              Use “Report Flood Status” to submit your first flood report. It'll show here with
              its verification status.
            </div>
            <button type="button" className="frp-report-btn" onClick={() => setShowModal(true)}>
              <PlusIcon /> Report Flood Status
            </button>
          </div>
        ) : (
          <div className="frp-list">
            {mine.map((r) => <ReportCard key={r.id} report={r} />)}
          </div>
        )}
      </div>

      {showModal && (
        <FloodReportModal
          onClose={() => setShowModal(false)}
          onSubmitted={() => flash('Report submitted — pending CDRRMO verification.')}
        />
      )}

      <div className={`frp-toast ${toast ? 'show' : ''}`}>{toast}</div>
    </ResidentLayout>
  )
}

function ReportCard({ report }) {
  const level = FLOOD_LEVEL_META[report.level] || FLOOD_LEVEL_META.moderate
  const status = VERIFY_STATUS_META[report.status] || VERIFY_STATUS_META.pending
  const depth = formatReportDepth(report.depthFt)
  const latest = report.history?.[report.history.length - 1]

  return (
    <div className="frp-card">
      <div className="frp-card-stripe" style={{ background: level.color }} />
      <div className="frp-card-body">
        <div className="frp-card-top">
          <span className="frp-level">
            <span className="frp-level-dot" style={{ background: level.color }} />
            {level.label}
          </span>
          <span className="frp-status" style={{ color: status.color, background: `${status.color}18` }}>
            {status.label}
          </span>
        </div>

        <div className="frp-meta">
          Brgy. {report.barangay || '—'} · {report.reported}
          {depth ? ` · ${depth}` : ''}
        </div>

        {report.description && <div className="frp-desc">{report.description}</div>}

        {report.photo && (
          <img className="frp-photo" src={report.photo} alt={`Evidence for ${level.label}`} />
        )}

        {report.status === 'approved' && (
          <div className="frp-note approved">
            ✓ Verified by {report.verifiedBy || 'CDRRMO'}{report.verified ? ` · ${report.verified}` : ''} — now visible on the public map.
          </div>
        )}
        {report.status === 'rejected' && (
          <div className="frp-note rejected">
            This report was not verified{report.verifiedBy ? ` by ${report.verifiedBy}` : ''}.
          </div>
        )}
        {report.status === 'pending' && (
          <div className="frp-note pending">Awaiting CDRRMO verification.</div>
        )}

        {report.officialNotes && (
          <div className="frp-official"><b>CDRRMO note:</b> {report.officialNotes}</div>
        )}

        {latest && (
          <div className="frp-latest"><span className="frp-latest-time">{latest.time}</span> {latest.label}</div>
        )}
      </div>
    </div>
  )
}

function Stat({ color, value, label }) {
  return (
    <div className="frp-stat">
      <div className="frp-stat-val" style={{ color }}>{value}</div>
      <div className="frp-stat-lbl">{label}</div>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}
function WaterIcon() {
  return (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#c7c2b8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  )
}
