import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AuditTrailTab from '../components/audit/AuditTrailTab';
import KpiDashboardTab from '../components/audit/KpiDashboardTab';
import ReportsSearchTab from '../components/audit/ReportsSearchTab';
import ArchiveManagementTab from '../components/audit/ArchiveManagementTab';
import '../components/audit/AuditReports.css';

const TABS = [
  { id: 'audit', label: 'Audit Trail' },
  { id: 'kpi', label: 'KPI Dashboard' },
  { id: 'reports', label: 'Reports & Search' },
  { id: 'archive', label: 'Archive Management' },
];

/**
 * Module 7 — Audit & Reports (FR-036–FR-040).
 *   FR-036: full audit trail, searchable by Document ID          -> AuditTrailTab
 *   FR-037: KPI dashboard (today's volume, avg approval, top 5)  -> KpiDashboardTab
 *   FR-038/FR-039: document search + monthly department report   -> ReportsSearchTab
 *   FR-040: 2-year retention / cold-storage archival              -> ArchiveManagementTab
 */
export default function AuditLogsPage() {
  const [activeTab, setActiveTab] = useState('audit');
  // Bumped whenever "Timeline" is clicked from the Reports tab, so AuditTrailTab
  // remounts with the requested Document ID pre-filled and searched immediately.
  const [jumpToken, setJumpToken] = useState(0);
  const [jumpDocId, setJumpDocId] = useState('');

  const handleJumpToTimeline = (docUuid) => {
    setJumpDocId(docUuid);
    setJumpToken((n) => n + 1);
    setActiveTab('audit');
  };

  return (
    <div className="ar-module">
      <div className="ar-header">
        <div className="ar-header-title">
          <div>
            <h1>Audit &amp; Reports</h1>
            <p>Full forensic trail, KPIs, document search, and retention management for every generated document.</p>
          </div>
        </div>
        <div className="ar-header-meta">
          <span className="ar-live-dot" />
          Live data
        </div>
      </div>

      <div className="ar-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`ar-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'audit' && <AuditTrailTab key={jumpToken} initialDocQuery={jumpDocId} />}
      {activeTab === 'kpi' && <KpiDashboardTab />}
      {activeTab === 'reports' && <ReportsSearchTab onJumpToTimeline={handleJumpToTimeline} />}
      {activeTab === 'archive' && <ArchiveManagementTab />}
    </div>
  );
}
