import { useEffect, useState } from 'react';
import { auditService, deliveryService } from '../../services/workflowService';
import { useToast } from '../../hooks/useToast';

const STATUS_COLORS = {
  draft:     '#94A3B8', // slate   — neutral, not yet submitted
  pending:   '#F59E0B', // amber   — awaiting action
  signed:    '#159A9C', // teal    — approved/complete
  rejected:  '#EF4444', // red     — needs attention
  delivered: '#6366F1', // indigo  — sent to recipient
};

const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending Approval',
  signed: 'Approved / Signed',
  rejected: 'Rejected',
  delivered: 'Delivered',
};

function BarChart({ daily }) {
  const width = 560;
  const height = 170;
  const padding = { top: 10, right: 8, bottom: 22, left: 8 };
  const max = Math.max(1, ...daily.map((d) => d.count));
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barGap = 6;
  const barW = (chartW / daily.length) - barGap;

  return (
    <svg className="ar-bar-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Documents generated per day, last 14 days">
      {daily.map((d, i) => {
        const barH = max === 0 ? 0 : (d.count / max) * chartH;
        const x = padding.left + i * (barW + barGap);
        const y = padding.top + (chartH - barH);
        const label = new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return (
          <g key={d.day}>
            <rect
              x={x} y={y} width={Math.max(barW, 2)} height={Math.max(barH, d.count > 0 ? 2 : 0)}
              rx="3" fill="#159A9C"
            >
              <title>{`${label}: ${d.count} document(s)`}</title>
            </rect>
            {(i % 2 === 0 || daily.length <= 8) && (
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="ar-chart-axis-label">
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function StatusDonut({ statusBreakdown }) {
  const total = statusBreakdown.reduce((s, r) => s + r.count, 0) || 1;
  let cumulative = 0;
  const stops = statusBreakdown.map((r) => {
    const start = (cumulative / total) * 360;
    cumulative += r.count;
    const end = (cumulative / total) * 360;
    const color = STATUS_COLORS[r.status] || '#94A3B8';
    return `${color} ${start}deg ${end}deg`;
  });
  const gradient = stops.length ? `conic-gradient(${stops.join(', ')})` : '#E2E8F0';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div
        style={{
          width: 110, height: 110, borderRadius: '50%', background: gradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <div style={{
          width: 66, height: 66, borderRadius: '50%',
          background: 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{total}</span>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: 2 }}>total docs</span>
        </div>
      </div>
      <div className="ar-donut-legend">
        {statusBreakdown.map((r) => (
          <div className="ar-donut-legend-row" key={r.status}>
            <span className="ar-donut-dot" style={{ background: STATUS_COLORS[r.status] || '#94A3B8' }} />
            <span className="ar-donut-legend-label">{STATUS_LABELS[r.status] || r.status}</span>
            <span className="ar-donut-legend-count">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function KpiDashboardTab() {
  const { showToast } = useToast();
  const [kpis, setKpis] = useState(null);
  const [trends, setTrends] = useState(null);
  const [ownershipReport, setOwnershipReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [kpisRes, trendsRes, ownershipRes] = await Promise.all([
        auditService.getDashboardKpis(),
        auditService.getDashboardTrends(),
        // Requirement 7's report is genuinely optional context for this dashboard —
        // if it fails to load, the rest of the KPI page should still render.
        deliveryService.getOwnershipReport().catch(() => null),
      ]);
      setKpis(kpisRes.data);
      setTrends(trendsRes.data);
      setOwnershipReport(ownershipRes?.data || null);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data.');
      showToast(err.message || 'Failed to load dashboard data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="ar-panel">
        <div className="ar-kpi-row">
          {[0, 1, 2].map((i) => <div key={i} className="ar-skeleton-row" style={{ borderRadius: 12, height: 100 }} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ar-panel ar-state">
        <p className="ar-state-title ar-state-error">Couldn't load the dashboard</p>
        <p className="ar-state-desc">{error}</p>
        <button type="button" className="ar-btn ar-btn-primary" style={{ marginTop: 12 }} onClick={load}>Retry</button>
      </div>
    );
  }

  return (
    <>
      <div className="ar-kpi-row">
        <div className="ar-kpi-card ar-kpi-navy">
          <div className="ar-kpi-top">
            <span className="ar-kpi-label">Documents Generated Today</span>
          </div>
          <div className="ar-kpi-value">{kpis.docsGeneratedToday}</div>
          <span className="ar-kpi-sub">Live count, updated in real time</span>
        </div>

        <div className="ar-kpi-card ar-kpi-slate">
          <div className="ar-kpi-top">
            <span className="ar-kpi-label">Average Approval Time</span>
          </div>
          <div className="ar-kpi-value">
            {kpis.avgApprovalTimeMinutes != null ? `${kpis.avgApprovalTimeMinutes}m` : '—'}
          </div>
          <span className="ar-kpi-sub">From submission to signed approval</span>
        </div>

        <div className="ar-kpi-card">
          <div className="ar-kpi-top">
            <span className="ar-kpi-label">Top 5 Template Usage</span>
          </div>
          {kpis.topTemplates.length === 0 ? (
            <span className="ar-kpi-sub">No documents generated yet.</span>
          ) : (
            <ol className="ar-kpi-top-list">
              {kpis.topTemplates.map((t) => (
                <li key={t.id}>
                  <span className="ar-kpi-top-name">{t.name}</span>
                  <span className="ar-kpi-top-count">{t.usageCount}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="ar-chart-row">
        <div className="ar-panel" style={{ marginBottom: 0 }}>
          <div className="ar-panel-header">
            <div>
              <h3 className="ar-panel-title">Generation Trend</h3>
              <p className="ar-panel-subtitle">Documents generated per day — last 14 days</p>
            </div>
          </div>
          {trends.daily.every((d) => d.count === 0) ? (
            <div className="ar-state" style={{ padding: '28px 10px' }}>
              <p className="ar-state-desc">No documents generated in this period yet.</p>
            </div>
          ) : (
            <BarChart daily={trends.daily} />
          )}
        </div>

        <div className="ar-panel" style={{ marginBottom: 0 }}>
          <div className="ar-panel-header">
            <div>
              <h3 className="ar-panel-title">Status Breakdown</h3>
              <p className="ar-panel-subtitle">All documents, by current status</p>
            </div>
          </div>
          {trends.statusBreakdown.length === 0 ? (
            <div className="ar-state" style={{ padding: '28px 10px' }}>
              <p className="ar-state-desc">No documents yet.</p>
            </div>
          ) : (
            <StatusDonut statusBreakdown={trends.statusBreakdown} />
          )}
        </div>
      </div>

      {/* Requirement 7: Secure Document Delivery & Ownership Verification reporting —
          total delivered, confirmed, rejected, confirmation rate, rejection reasons. */}
      {ownershipReport && (
        <div className="ar-panel" style={{ marginTop: 16 }}>
          <div className="ar-panel-header">
            <div>
              <h3 className="ar-panel-title">Secure Delivery &amp; Ownership Verification</h3>
              <p className="ar-panel-subtitle">One-time link + OTP deliveries, system-wide</p>
            </div>
          </div>
          <div className="ar-kpi-row" style={{ marginTop: 4 }}>
            <div className="ar-kpi-card ar-kpi-slate">
              <div className="ar-kpi-top"><span className="ar-kpi-label">Total Delivered</span></div>
              <div className="ar-kpi-value">{ownershipReport.totalDelivered}</div>
            </div>
            <div className="ar-kpi-card ar-kpi-navy">
              <div className="ar-kpi-top"><span className="ar-kpi-label">Ownership Confirmed</span></div>
              <div className="ar-kpi-value">{ownershipReport.ownedCount}</div>
              <span className="ar-kpi-sub">{ownershipReport.confirmationRate}% confirmation rate</span>
            </div>
            <div className="ar-kpi-card">
              <div className="ar-kpi-top"><span className="ar-kpi-label">Ownership Rejected</span></div>
              <div className="ar-kpi-value">{ownershipReport.notOwnedCount}</div>
              <span className="ar-kpi-sub">{ownershipReport.pendingCount} still awaiting a response</span>
            </div>
          </div>

          {/* Rejection reasons removed — shown in Audit Trail instead */}
        </div>
      )}
    </>
  );
}
