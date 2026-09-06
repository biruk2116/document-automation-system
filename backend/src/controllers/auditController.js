const { pool } = require('../config/db');

/**
 * GET /api/audit-logs?doc_id=&doc_uuid=&user_id=&action=&from=&to=
 * FR-036: full audit trail, filterable. `doc_uuid` (the human-facing DOC-YYYYMMDD-XXXXX
 * ID) is accepted alongside the internal numeric `doc_id` so the Audit Trail search box
 * can look a document up the same way a user would type it.
 */
async function getAuditTrail(req, res) {
  const { doc_id, doc_uuid, user_id, action, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (doc_id) { conditions.push('al.doc_id = ?'); params.push(doc_id); }
  if (doc_uuid) { conditions.push('gd.doc_uuid = ?'); params.push(doc_uuid.trim()); }
  if (user_id) { conditions.push('al.user_id = ?'); params.push(user_id); }
  if (action) { conditions.push('al.action = ?'); params.push(action); }
  if (from) { conditions.push('al.timestamp >= ?'); params.push(from); }
  if (to) { conditions.push('al.timestamp <= ?'); params.push(to); }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [rows] = await pool.query(
      `SELECT al.*, u.full_name AS user_name, u.role AS user_role, gd.doc_uuid
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN generated_docs gd ON gd.id = al.doc_id
       ${whereClause}
       ORDER BY al.timestamp DESC
       LIMIT 500`,
      params
    );
    return res.status(200).json({ success: true, message: 'Audit trail fetched.', data: rows });
  } catch (err) {
    console.error('[audit] trail error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch audit trail.' });
  }
}

/**
 * GET /api/audit-logs/export?doc_id=&doc_uuid=&user_id=&action=&from=&to=
 * Full-information CSV export of the audit trail — same filters as getAuditTrail
 * above (so exporting a filtered/searched view exports exactly what's on screen),
 * but every column of the underlying record, not just what the table UI shows.
 */
async function getAuditTrailCsv(req, res) {
  const { doc_id, doc_uuid, user_id, action, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (doc_id) { conditions.push('al.doc_id = ?'); params.push(doc_id); }
  if (doc_uuid) { conditions.push('gd.doc_uuid = ?'); params.push(doc_uuid.trim()); }
  if (user_id) { conditions.push('al.user_id = ?'); params.push(user_id); }
  if (action) { conditions.push('al.action = ?'); params.push(action); }
  if (from) { conditions.push('al.timestamp >= ?'); params.push(from); }
  if (to) { conditions.push('al.timestamp <= ?'); params.push(to); }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [rows] = await pool.query(
      `SELECT al.id, al.timestamp, al.action, al.user_id, u.full_name AS user_name, u.role AS user_role,
              u.email AS user_email, al.doc_id, gd.doc_uuid, gd.record_identifier, gd.status AS doc_status,
              al.ip_address, al.user_agent, al.action_details
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       LEFT JOIN generated_docs gd ON gd.id = al.doc_id
       ${whereClause}
       ORDER BY al.timestamp DESC
       LIMIT 5000`,
      params
    );

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const columns = [
      'id', 'timestamp', 'action', 'user_id', 'user_name', 'user_role', 'user_email',
      'doc_id', 'doc_uuid', 'record_identifier', 'doc_status', 'ip_address', 'user_agent', 'action_details',
    ];
    const csvLines = [columns.join(',')];
    for (const row of rows) {
      csvLines.push(columns.map((col) => escapeCsv(row[col])).join(','));
    }

    const csv = csvLines.join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_trail_${stamp}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[audit] trail CSV export error:', err);
    return res.status(500).json({ success: false, message: 'Failed to export the audit trail.' });
  }
}

/**
 * GET /api/dashboard/kpis
 * FR-037: docs generated today, avg approval time, top 5 template usage.
 */
async function getDashboardKpis(req, res) {
  try {
    const [[{ docsToday }]] = await pool.query(
      `SELECT COUNT(*) AS docsToday FROM generated_docs WHERE DATE(generated_at) = CURDATE() AND deleted_at IS NULL`
    );

    const [[{ avgApprovalSeconds }]] = await pool.query(
      `SELECT AVG(TIMESTAMPDIFF(SECOND, sr.created_at, sr.approved_at)) AS avgApprovalSeconds
       FROM signature_requests sr WHERE sr.status = 'approved' AND sr.approved_at IS NOT NULL`
    );

    // Editing a template inserts a NEW row (new id, same name, version + 1) rather than
    // overwriting the old one — see updateTemplate() — so generated_docs.template_id can
    // point at any past version. Grouping by name (not id) merges a template's usage
    // across all its versions instead of showing "Employment Verification Letter" three
    // times with the count split between them.
    const [topTemplates] = await pool.query(
      `SELECT MIN(t.id) AS id, t.name, COUNT(gd.id) AS usageCount
       FROM generated_docs gd
       JOIN templates t ON t.id = gd.template_id
       WHERE gd.deleted_at IS NULL
       GROUP BY t.name
       ORDER BY usageCount DESC
       LIMIT 5`
    );

    return res.status(200).json({
      success: true,
      message: 'Dashboard KPIs fetched.',
      data: {
        docsGeneratedToday: docsToday,
        avgApprovalTimeMinutes: avgApprovalSeconds ? Math.round(avgApprovalSeconds / 60) : null,
        topTemplates,
      },
    });
  } catch (err) {
    console.error('[audit] kpis error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard KPIs.' });
  }
}

/**
 * Shared query backing both the on-screen preview and the CSV export for the
 * FR-038 monthly department report, so the numbers a user sees before exporting
 * are guaranteed to match what actually downloads.
 */
async function buildMonthlyReportRows(month) {
  const { getAppSettings } = require('../utils/appSettings');
  const { minutesSavedPerDoc } = getAppSettings();

  const [rows] = await pool.query(
    `SELECT t.category AS department,
            COUNT(gd.id) AS documents_generated,
            SUM(CASE WHEN gd.status = 'signed' OR gd.status = 'delivered' THEN 1 ELSE 0 END) AS documents_signed
     FROM generated_docs gd
     JOIN templates t ON t.id = gd.template_id
     WHERE DATE_FORMAT(gd.generated_at, '%Y-%m') = ? AND gd.deleted_at IS NULL
     GROUP BY t.category`,
    [month]
  );

  return rows.map((r) => ({
    department: r.department,
    documents_generated: r.documents_generated,
    documents_signed: r.documents_signed,
    estimated_minutes_saved: r.documents_generated * minutesSavedPerDoc,
  }));
}

/**
 * GET /api/reports/monthly/preview?month=YYYY-MM
 * FR-038: on-screen preview (signed count + estimated time saved per department)
 * shown before the person commits to exporting the CSV.
 */
async function getMonthlyReportPreview(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, message: 'Provide month as YYYY-MM.' });
  }
  try {
    const rows = await buildMonthlyReportRows(month);
    const totals = rows.reduce((acc, r) => ({
      documents_generated: acc.documents_generated + r.documents_generated,
      documents_signed: acc.documents_signed + r.documents_signed,
      estimated_minutes_saved: acc.estimated_minutes_saved + r.estimated_minutes_saved,
    }), { documents_generated: 0, documents_signed: 0, estimated_minutes_saved: 0 });

    return res.status(200).json({
      success: true,
      message: 'Monthly report preview fetched.',
      data: { month, departments: rows, totals },
    });
  } catch (err) {
    console.error('[audit] monthly report preview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate report preview.' });
  }
}

/**
 * GET /api/reports/monthly?month=YYYY-MM
 * FR-038: CSV export per department (category), count signed, estimated time saved.
 * Time-saved estimate: assumes each manually-produced document would have taken
 * `minutesSavedPerDoc` (System Settings) minutes.
 */
async function getMonthlyReportCsv(req, res) {
  const { month } = req.query; // format YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, message: 'Provide month as YYYY-MM.' });
  }

  try {
    const rows = await buildMonthlyReportRows(month);

    const csvLines = ['Department,Documents Generated,Documents Signed,Estimated Minutes Saved'];
    for (const r of rows) {
      csvLines.push(`${r.department},${r.documents_generated},${r.documents_signed},${r.estimated_minutes_saved}`);
    }

    const csv = csvLines.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report_${month}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('[audit] monthly report error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate report.' });
  }
}

/**
 * GET /api/documents/search?template_id=&date_from=&date_to=&status=&generated_by=&approver_id=
 * FR-039
 */
async function searchDocuments(req, res) {
  const { template_name, date_from, date_to, status, generated_by, approver_id, id } = req.query;
  const conditions = [];
  const params = [];

  // CRITICAL: Always exclude soft-deleted documents from the list
  conditions.push('gd.deleted_at IS NULL');

  // Single-doc lookup by numeric id — used by Document Tracking's admin deep-link
  // case: an admin notified about a document rejected for someone ELSE (a non-admin
  // generator) needs to be able to open that exact document even though it wasn't
  // generated_by them, without pulling every document in the system to find it.
  if (id) { conditions.push('gd.id = ?'); params.push(id); }
  // Filtering by name (not a specific template_id) so picking "Employment Verification
  // Letter" in the UI matches documents generated under any version of that template,
  // not just whichever single version row happened to be selected.
  if (template_name) { conditions.push('t.name = ?'); params.push(template_name); }
  if (date_from) { conditions.push('gd.generated_at >= ?'); params.push(date_from); }
  if (date_to) { conditions.push('gd.generated_at <= ?'); params.push(date_to); }
  if (status) { conditions.push('gd.status = ?'); params.push(status); }
  if (generated_by) { conditions.push('gd.generated_by = ?'); params.push(generated_by); }
  if (approver_id) {
    conditions.push('EXISTS (SELECT 1 FROM signature_requests sr WHERE sr.doc_id = gd.id AND sr.approver_id = ?)');
    params.push(approver_id);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  try {
    const [rows] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.record_identifier, gd.status, gd.generated_at,
              gd.archive_status, gd.deleted_at, gd.template_id, gd.generated_by, t.data_source_table,
              t.name AS template_name, u.full_name AS generated_by_name,
              latest_sr.approver_id, approver_u.full_name AS approver_name,
              latest_sr.status AS signature_status, latest_sr.rejection_reason,
              latest_sr.created_at AS sent_for_approval_at, latest_sr.approved_at,
              TIMESTAMPDIFF(MINUTE, latest_sr.created_at, latest_sr.approved_at) AS approval_time_minutes,
              latest_dd.recipient_email AS delivered_to, latest_dd.sent_at AS delivered_at,
              latest_dd.email_status AS delivery_email_status
       FROM generated_docs gd
       JOIN templates t ON t.id = gd.template_id
       JOIN users u ON u.id = gd.generated_by
       LEFT JOIN signature_requests latest_sr
         ON latest_sr.id = (
           SELECT sr2.id FROM signature_requests sr2
           WHERE sr2.doc_id = gd.id
           ORDER BY sr2.created_at DESC
           LIMIT 1
         )
       LEFT JOIN users approver_u ON approver_u.id = latest_sr.approver_id
       LEFT JOIN document_deliveries latest_dd
         ON latest_dd.id = (
           SELECT dd2.id FROM document_deliveries dd2
           WHERE dd2.doc_id = gd.id AND dd2.email_status = 'sent'
           ORDER BY dd2.sent_at DESC, dd2.id DESC
           LIMIT 1
         )
       ${whereClause}
       ORDER BY gd.generated_at DESC`,
      params
    );
    return res.status(200).json({ success: true, message: 'Documents fetched.', data: rows });
  } catch (err) {
    console.error('[audit] search error:', err);
    return res.status(500).json({ success: false, message: 'Failed to search documents.' });
  }
}

/**
 * FR-040: docs older than 2 years auto-move to cold storage.
 * Called periodically by the scheduler.
 */
async function archiveOldDocuments() {
  const fs = require('fs');
  const path = require('path');
  const { getAppSettings } = require('../utils/appSettings');
  const archiveDir = path.join(__dirname, '..', '..', 'storage', 'archive');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

  try {
    const { archiveYears } = getAppSettings();
    const [rows] = await pool.query(
      `SELECT id, file_path FROM generated_docs
       WHERE generated_at < (NOW() - INTERVAL ? YEAR) AND archive_status = 'active'`,
      [archiveYears]
    );

    let movedCount = 0;
    for (const row of rows) {
      // The row (and its searchable metadata) always stays in generated_docs — FR-040
      // only ever relocates the underlying file to cold storage, never the DB index.
      const newPath = fs.existsSync(row.file_path)
        ? path.join(archiveDir, path.basename(row.file_path))
        : row.file_path;
      if (fs.existsSync(row.file_path)) fs.renameSync(row.file_path, newPath);
      await pool.query(
        `UPDATE generated_docs SET file_path = ?, archive_status = 'archived', archived_at = NOW() WHERE id = ?`,
        [newPath, row.id]
      );
      movedCount += 1;
    }

    if (movedCount > 0) console.log(`[scheduler] Archived ${movedCount} document(s) older than ${archiveYears} year(s).`);
    return movedCount;
  } catch (err) {
    console.error('[scheduler] archiveOldDocuments error:', err.message);
    return 0;
  }
}

/**
 * GET /api/dashboard/trends
 * Backs the KPI Dashboard's charts: documents generated per day over the last 14 days,
 * plus a current breakdown of documents by status, so the module doesn't have to ship
 * a charting library — the frontend renders these as lightweight inline SVG charts.
 */
async function getDashboardTrends(req, res) {
  try {
    const [dailyRows] = await pool.query(
      `SELECT DATE(generated_at) AS day, COUNT(*) AS count
       FROM generated_docs
       WHERE generated_at >= (CURDATE() - INTERVAL 13 DAY) AND deleted_at IS NULL
       GROUP BY DATE(generated_at)
       ORDER BY day ASC`
    );

    // Fill in any gaps so the chart always shows a full, continuous 14-day axis.
    const byDay = new Map(dailyRows.map((r) => [
      (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day)), r.count,
    ]));
    const daily = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      daily.push({ day: key, count: byDay.get(key) || 0 });
    }

    const [statusRows] = await pool.query(
      `SELECT status, COUNT(*) AS count FROM generated_docs WHERE deleted_at IS NULL GROUP BY status`
    );

    return res.status(200).json({
      success: true,
      message: 'Dashboard trends fetched.',
      data: { daily, statusBreakdown: statusRows },
    });
  } catch (err) {
    console.error('[audit] trends error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard trends.' });
  }
}

/**
 * GET /api/reports/filter-options
 * FR-039: populates the Template / Generator / Approver dropdowns on the Reports &
 * Document Search screen. Scoped to this admin-only module rather than reusing
 * GET /api/users (super_admin only) so system_admin — who also has audit access —
 * isn't locked out of the filters.
 */
async function getReportFilterOptions(req, res) {
  try {
    // Same version-lineage issue as the KPI's top-templates list: dedupe by name so the
    // Template filter doesn't list "Employment Verification Letter" once per version.
    const [templates] = await pool.query(
      `SELECT MIN(id) AS id, name, MIN(category) AS category FROM templates GROUP BY name ORDER BY name ASC`
    );
    const [generators] = await pool.query(
      `SELECT DISTINCT u.id, u.full_name
       FROM users u JOIN generated_docs gd ON gd.generated_by = u.id
       ORDER BY u.full_name ASC`
    );
    const [approvers] = await pool.query(
      `SELECT DISTINCT u.id, u.full_name
       FROM users u JOIN signature_requests sr ON sr.approver_id = u.id
       ORDER BY u.full_name ASC`
    );
    return res.status(200).json({
      success: true,
      message: 'Filter options fetched.',
      data: { templates, generators, approvers },
    });
  } catch (err) {
    console.error('[audit] filter options error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch filter options.' });
  }
}

/**
 * GET /api/archive/overview
 * FR-040: everything Archive Management needs — documents approaching the retention
 * window, documents already over it (awaiting the next scheduler pass), and documents
 * already moved to cold storage — each with its DB index status (always "indexed":
 * the row and its searchable metadata stay in generated_docs regardless of where the
 * underlying file lives, which is the whole point of FR-040).
 */
async function getArchiveOverview(req, res) {
  try {
    const { archiveYears } = require('../utils/appSettings').getAppSettings();
    const WARNING_DAYS = 60; // documents entering this window show as "approaching"

    const [rows] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.record_identifier, gd.status, gd.archive_status,
              gd.archived_at, gd.file_path, gd.generated_at, t.name AS template_name,
              DATEDIFF(NOW(), gd.generated_at) AS age_days
       FROM generated_docs gd
       JOIN templates t ON t.id = gd.template_id
       WHERE gd.deleted_at IS NULL AND (
          gd.archive_status = 'archived'
          OR gd.generated_at <= (NOW() - INTERVAL (? * 365 - ?) DAY)
       )
       ORDER BY gd.generated_at ASC`,
      [archiveYears, WARNING_DAYS]
    );

    const retentionDays = archiveYears * 365;
    const data = rows.map((r) => {
      let retentionState;
      if (r.archive_status === 'archived') retentionState = 'archived';
      else if (r.age_days >= retentionDays) retentionState = 'overdue';
      else retentionState = 'approaching';

      return {
        id: r.id,
        doc_uuid: r.doc_uuid,
        record_identifier: r.record_identifier,
        template_name: r.template_name,
        status: r.status,
        retention_state: retentionState,
        age_days: r.age_days,
        generated_at: r.generated_at,
        archived_at: r.archived_at,
        storage_location: r.archive_status === 'archived'
          ? 'Cold storage (file-system archive)'
          : 'Primary storage',
        file_path: r.file_path,
        db_index_status: 'Indexed', // metadata/index row is never removed — only the file moves
      };
    });

    return res.status(200).json({
      success: true,
      message: 'Archive overview fetched.',
      data: {
        retentionYears: archiveYears,
        documents: data,
        summary: {
          approaching: data.filter((d) => d.retention_state === 'approaching').length,
          overdue: data.filter((d) => d.retention_state === 'overdue').length,
          archived: data.filter((d) => d.retention_state === 'archived').length,
        },
      },
    });
  } catch (err) {
    console.error('[audit] archive overview error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch archive overview.' });
  }
}

/**
 * POST /api/archive/run
 * FR-040: lets an admin trigger the archive sweep on demand (in addition to the daily
 * scheduled job in scheduler.js) — e.g. right after lowering the retention window, or
 * to confirm overdue documents are moved without waiting for the next scheduled run.
 */
async function runArchiveNow(req, res) {
  try {
    const movedCount = await archiveOldDocuments();
    return res.status(200).json({
      success: true,
      message: movedCount > 0
        ? `Archived ${movedCount} document(s) older than the retention period.`
        : 'No documents are currently over the retention period.',
      data: { movedCount },
    });
  } catch (err) {
    console.error('[audit] manual archive run error:', err);
    return res.status(500).json({ success: false, message: 'Archive run failed.' });
  }
}

module.exports = {
  getAuditTrail,
  getAuditTrailCsv,
  getDashboardKpis,
  getDashboardTrends,
  getMonthlyReportCsv,
  getMonthlyReportPreview,
  searchDocuments,
  getReportFilterOptions,
  getArchiveOverview,
  runArchiveNow,
  archiveOldDocuments,
};
