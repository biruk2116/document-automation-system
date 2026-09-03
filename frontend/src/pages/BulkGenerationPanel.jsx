import { useEffect, useRef, useState } from 'react';
import { documentService } from '../services/templateService';
import { signatureService } from '../services/workflowService';
import { useToast } from '../hooks/useToast';
import ApproverSelectModal from '../components/common/ApproverSelectModal';

/** Small ring showing "done / total" progress (used while signature requests are being sent). */
function CircularProgress({ done, total, size = 40, stroke = 5 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? done / total : 0;
  const offset = circumference * (1 - pct);
  return (
    <svg className="circular-progress-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="circular-progress-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
      <circle
        className="circular-progress-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
      <text
        x={size / 2}
        y={size / 2}
        className="circular-progress-count"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {done}/{total}
      </text>
    </svg>
  );
}

/**
 * Bulk generation panel.
 *
 * Input is exactly ONE of two ways to build the list of record IDs, controlled by
 * the `mode` prop from the parent's Single / Multiple / Bulk .csv selector:
 *   - mode="multiple": type/paste multiple IDs directly (comma or newline separated)
 *   - mode="bulk":      upload a .csv file (strictly .csv — anything else is rejected
 *                       client-side before it's ever read, regardless of what the OS
 *                       file picker allowed through)
 * The parent remounts this component (via a `key` that includes the mode) whenever
 * the mode changes, so switching modes always starts from a clean, empty state —
 * there's no way to have IDs staged in more than one mode at once.
 *
 * Flow mirrors single-document generation: Preview, then Generate.
 *   - Preview: validates every ID against the template's required fields and shows
 *     a Ready group and a Missing-Data group (e.g. "EMP001, EMP002 — missing X" vs
 *     "EMP003, EMP004 — ready").
 *   - Generate: generates PDFs for the Ready group only (enabled once Preview has run
 *     and at least one ID is Ready).
 *   - Cancel:  drops the Missing-Data IDs from the working list (does not generate
 *              anything for them) so the user can fix the source data and re-add
 *              them later, without them cluttering the next attempt.
 */
export default function BulkGenerationPanel({ templateId, mode = 'multiple' }) {
  const { showToast } = useToast();
  const [manualIdsText, setManualIdsText] = useState('');
  const [csvIds, setCsvIds] = useState([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [validationReport, setValidationReport] = useState(null);
  const [validating, setValidating] = useState(false);
  const [job, setJob] = useState(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  // Requirement: once a bulk batch finishes, the Generator MUST assign an Approver to
  // each successful document — same rule as single generation (FR-020..FR-027), just
  // applied across the whole batch instead of one at a time.
  const [showBulkApproverModal, setShowBulkApproverModal] = useState(false);
  const [bulkAssignProgress, setBulkAssignProgress] = useState(null); // { done, total }
  const [bulkAssignedJobId, setBulkAssignedJobId] = useState(null);

  // Reset the working state whenever the selected template changes — a validation
  // report or job from a different template would be meaningless here.
  useEffect(() => {
    setManualIdsText('');
    setCsvIds([]);
    setCsvFileName('');
    setValidationReport(null);
    setJob(null);
    setShowBulkApproverModal(false);
    setBulkAssignProgress(null);
    setBulkAssignedJobId(null);
  }, [templateId]);

  const manualIds = () => manualIdsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  /** Combined, de-duplicated ID list from both input sources, in first-seen order. */
  const combinedIds = () => {
    const seen = new Set();
    const out = [];
    for (const id of [...manualIds(), ...csvIds]) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  };

  /**
   * A CSV's first column may be a real value on line 1 ("EMP001") or a header label
   * ("employee_id", "Employee ID", "id", ...) — Excel exports almost always include
   * one. Treating a header as a record ID silently produced a bogus "record not
   * found" row and made the feature look broken, so it's detected and skipped here.
   */
  const HEADER_KEYWORDS = new Set([
    'id', 'recordid', 'employeeid', 'studentid', 'userid', 'customerid', 'clientid',
    'code', 'key', 'sno', 'no', 'number', 'identifier', 'empid', 'emp_id',
  ]);
  const looksLikeHeader = (value) => HEADER_KEYWORDS.has(value.toLowerCase().replace(/[^a-z0-9]/g, ''));

  /** Extracts the first column of one CSV line, honoring a quoted field ("a,b" -> a,b as one value). */
  const parseFirstField = (line) => {
    if (line.startsWith('"')) {
      let out = '';
      for (let i = 1; i < line.length; i += 1) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { out += '"'; i += 1; continue; }
          break;
        }
        out += line[i];
      }
      return out.trim();
    }
    return line.split(',')[0].trim();
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Hard requirement: only .csv files. The <input accept> attribute is just a UI
    // hint and can be bypassed (drag-drop, "All files" filter, etc.), so this is
    // enforced again here before the file is read at all.
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast(`"${file.name}" is not a .csv file. Please upload a .csv file.`, 'error');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      // Strip a UTF-8 BOM (\uFEFF) — common when a CSV is exported from Excel — since
      // it would otherwise get glued onto the very first record ID and break matching.
      const text = String(reader.result).replace(/^\uFEFF/, '');
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

      let dataLines = lines;
      let headerSkipped = false;
      if (lines.length > 0 && looksLikeHeader(parseFirstField(lines[0]))) {
        dataLines = lines.slice(1);
        headerSkipped = true;
      }

      const ids = dataLines.map(parseFirstField).filter(Boolean);
      if (ids.length === 0) {
        showToast('That CSV file has no record IDs in it.', 'error');
        e.target.value = '';
        return;
      }
      setCsvIds(ids);
      setCsvFileName(file.name);
      showToast(
        headerSkipped
          ? `Loaded ${ids.length} record ID(s) from ${file.name} (header row skipped).`
          : `Loaded ${ids.length} record ID(s) from ${file.name}.`,
        'success'
      );
    };
    reader.onerror = () => showToast(`Failed to read "${file.name}".`, 'error');
    reader.readAsText(file);
    e.target.value = ''; // allow re-uploading the same filename after a change
  };

  const clearCsv = () => {
    setCsvIds([]);
    setCsvFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /** Preview: validates every ID against the template's required fields. Nothing is generated yet. */
  const handlePreviewClick = async () => {
    const recordIds = combinedIds();
    if (!templateId) {
      showToast('Select a template first.', 'error');
      return;
    }
    if (recordIds.length === 0) {
      showToast(
        mode === 'bulk' ? 'Upload a .csv file with at least one record ID.' : 'Enter at least one record ID.',
        'error'
      );
      return;
    }

    setValidating(true);
    setValidationReport(null);
    try {
      const res = await documentService.validateBulk({ template_id: templateId, record_ids: recordIds });
      setValidationReport(res.data);
    } catch (err) {
      showToast(err.message || 'Preview failed.', 'error');
    } finally {
      setValidating(false);
    }
  };

  const readyIds = () => (validationReport ? validationReport.report.filter((r) => r.ok).map((r) => r.recordId) : []);
  const missingIds = () => (validationReport ? validationReport.report.filter((r) => !r.ok) : []);

  /** Generate: generate PDFs for the Ready group only (requires a Preview to have run first). */
  const handleGenerateReady = async () => {
    const recordIds = readyIds();
    if (recordIds.length === 0) return;
    try {
      const res = await documentService.generateBulk({ template_id: templateId, record_ids: recordIds });
      showToast(res.message, 'success');
      setJob({ jobId: res.data.jobId, total: res.data.total, completed: 0, failed: 0, status: 'running' });
      setValidationReport(null);
    } catch (err) {
      showToast(err.message || 'Failed to start bulk generation.', 'error');
    }
  };

  /** Cancel: drop the Missing-Data IDs from the working list; generates nothing for them. */
  const handleCancelMissing = () => {
    const drop = new Set(missingIds().map((r) => String(r.recordId)));
    setManualIdsText(manualIds().filter((id) => !drop.has(id)).join('\n'));
    setCsvIds((prev) => prev.filter((id) => !drop.has(id)));
    showToast(`Removed ${drop.size} record(s) with missing data from the list.`, 'success');
    setValidationReport(null);
  };

  // FR-019: poll job progress ("45/100 completed")
  useEffect(() => {
    if (!job || job.status !== 'running') return undefined;

    pollRef.current = setInterval(async () => {
      try {
        const res = await documentService.getBulkStatus(job.jobId);
        setJob(res.data);
        if (res.data.status !== 'running') {
          clearInterval(pollRef.current);
          // Prompt approver assignment exactly once per completed job, and only if
          // at least one document actually succeeded.
          if (res.data.completed > 0 && bulkAssignedJobId !== res.data.jobId) {
            setShowBulkApproverModal(true);
          }
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, [job?.jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sequentially sends a signature request for every successfully-generated doc in the batch. */
  const handleAssignApproverToAll = async (approverId) => {
    const successfulDocs = (job.results || []).filter((r) => r.success && r.dbId);
    setBulkAssignProgress({ done: 0, total: successfulDocs.length });

    let sent = 0;
    let failed = 0;
    for (const r of successfulDocs) {
      try {
        await signatureService.initiate(r.dbId, approverId);
        sent += 1;
      } catch {
        failed += 1;
      }
      setBulkAssignProgress({ done: sent + failed, total: successfulDocs.length });
    }

    setBulkAssignedJobId(job.jobId);
    setShowBulkApproverModal(false);
    setBulkAssignProgress(null);
    showToast(
      failed > 0
        ? `Approver assigned to ${sent} of ${successfulDocs.length} document(s); ${failed} failed.`
        : `Approver assigned to all ${sent} document(s). They've been notified.`,
      failed > 0 ? 'error' : 'success'
    );

    // The batch is fully wrapped up (routed to an approver) — clear the working
    // inputs (CSV, manual IDs, validation report, job) so the panel resets to a
    // clean state instead of leaving the last batch's data sitting on screen.
    setManualIdsText('');
    setCsvIds([]);
    setCsvFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setValidationReport(null);
    setJob(null);
  };

  const idCount = combinedIds().length;
  const ready = readyIds();
  const missing = missingIds();

  const showApproverBanner = job && job.status !== 'running' && job.completed > 0 && bulkAssignedJobId !== job.jobId;

  return (
    <div className="bulk-panel">
      {showApproverBanner && (
        <div className="approver-required-banner approver-required-banner-top">
          <span>{job.completed} generated document{job.completed > 1 ? 's' : ''} still need an approver before they can be approved, rejected, or e-signed.</span>
          <button type="button" className="btn-primary" onClick={() => setShowBulkApproverModal(true)}>Assign Approver to All</button>
        </div>
      )}

      <h2>{mode === 'bulk' ? 'Bulk Generation — .csv File' : 'Bulk Generation — Multiple Record IDs'}</h2>

      <div className="bulk-input-grid">
        {mode === 'multiple' && (
          <div className="form-field">
            <label htmlFor="bulk-ids">Enter Record IDs (comma or one per line)</label>
            <textarea
              id="bulk-ids"
              value={manualIdsText}
              onChange={(e) => setManualIdsText(e.target.value)}
              rows={6}
              placeholder={'EMP001\nEMP002\nEMP003'}
              autoFocus
            />
          </div>
        )}

        {mode === 'bulk' && (
          <div className="form-field">
            <label htmlFor="bulk-csv">Upload a .csv File</label>
            <div className="bulk-csv-dropzone">
              <input
                id="bulk-csv"
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
              />
              {csvFileName ? (
                <p className="bulk-csv-loaded">
                  {csvFileName} — {csvIds.length} ID(s)
                  <button type="button" className="bulk-csv-clear" onClick={clearCsv}>remove</button>
                </p>
              ) : (
                <p className="bulk-csv-hint">Only .csv files are accepted (first column = record ID).</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="template-form-actions">
        <button type="button" onClick={handlePreviewClick} disabled={validating || idCount === 0} className="btn-secondary">
          {validating ? 'Loading…' : `Preview — ${idCount} ID(s)`}
        </button>
        <button
          type="button"
          onClick={handleGenerateReady}
          disabled={!validationReport || readyIds().length === 0}
          className="btn-primary"
          title={!validationReport ? 'Run Preview first' : undefined}
        >
          {`Generate — ${validationReport ? readyIds().length : 0} Ready`}
        </button>
      </div>

      {validationReport && (
        <div className="bulk-validation-result">
          <table className="bulk-validation-table">
            <thead>
              <tr><th>Record ID</th><th>Status</th><th>Missing Fields</th></tr>
            </thead>
            <tbody>
              {validationReport.report.map((r) => (
                <tr key={r.recordId} className={r.ok ? 'bulk-row-ok' : 'bulk-row-fail'}>
                  <td>{r.recordId}</td>
                  <td>{r.ok ? 'Ready' : 'Missing data'}</td>
                  <td>{r.missingFields.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="bulk-validation-summary">
            {ready.length > 0 && <span className="bulk-row-ok">{ready.length} ready ({ready.join(', ')})</span>}
            {ready.length > 0 && missing.length > 0 && ' · '}
            {missing.length > 0 && (
              <span className="bulk-row-fail">
                {missing.length} with missing data ({missing.map((r) => r.recordId).join(', ')})
              </span>
            )}
          </p>

          {missing.length > 0 && (
            <div className="template-form-actions">
              <button type="button" onClick={handleCancelMissing} className="btn-secondary">
                Cancel the {missing.length} With Missing Data
              </button>
            </div>
          )}
        </div>
      )}

      {job && (
        <div style={{ marginTop: 16 }}>
          <p>Progress: {job.completed + job.failed} / {job.total} ({job.status})</p>
          <div className="bulk-progress-bar">
            <div className="bulk-progress-fill" style={{ width: `${((job.completed + job.failed) / job.total) * 100}%` }} />
          </div>
          {job.failed > 0 && <p className="bulk-row-fail">{job.failed} failed</p>}

          {job.status !== 'running' && job.completed > 0 && bulkAssignedJobId === job.jobId && (
            <p className="bulk-row-ok" style={{ marginTop: 10 }}>Approver assigned to this batch.</p>
          )}
        </div>
      )}

      {showBulkApproverModal && job && (
        <ApproverSelectModal
          title="Select an Approver for This Batch"
          description={
            bulkAssignProgress ? (
              <span className="circular-progress-wrap">
                <CircularProgress done={bulkAssignProgress.done} total={bulkAssignProgress.total} />
                <span className="circular-progress-label">Sending signature requests…</span>
              </span>
            ) : (
              `${job.completed} document${job.completed > 1 ? 's were' : ' was'} generated successfully. Choose one Approver to route all of them to for review, OTP-confirm, and e-sign.`
            )
          }
          submitLabel={`Send Signature Request${job.completed > 1 ? 's' : ''}`}
          onSubmit={handleAssignApproverToAll}
          onSkip={() => setShowBulkApproverModal(false)}
        />
      )}
    </div>
  );
}
