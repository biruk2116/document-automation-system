const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { fetchRecordById: fetchInternalRecordById } = require('./dataSourceController');
const { loadConnectionConfig } = require('./externalDbController');
const { fetchRecordById: fetchExternalRecordById } = require('../utils/externalDbClients');
const { renderTemplate, withAutoDates } = require('../utils/templateRenderer');
const { 
  assembleDocumentHtml, 
  resolveWatermarkForStatus, 
  injectSignatureIntoDocument, 
  generateSignatureSvg 
} = require('../utils/documentAssembler');
const { sha256, generateDocId, buildTamperProofFooterHtml, buildDeliveryVerificationQrHtml } = require('../utils/documentIntegrity');
const { generateVerificationId } = require('../utils/secureDeliveryToken');
const { htmlToPdfBuffer } = require('../utils/pdfGenerator');
const { buildFileName, buildStoragePath, buildRandomStorageFileName } = require('../utils/fileStorage');
const { createJob, updateJobProgress, getJob } = require('../utils/bulkJobTracker');
const { recordAudit } = require('../utils/auditLog');
const { sendMail, templates } = require('../utils/emailService');
const { runInitiateSignature } = require('./signatureController');
const { validateRecipientEmail } = require('../utils/recipientValidation');
const { buildDownloadToken, buildDownloadUrl, TOKEN_EXPIRY_DAYS } = require('./deliveryController');
require('dotenv').config();

const VERIFY_BASE_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const JWT_SECRET = process.env.JWT_SECRET || 'insecure_dev_fallback_secret';

/**
 * Regenerates a PDF file from a generated_docs DB row when the original file is missing.
 * Uses the stored metadata (template_id, record_identifier, status, signatures) to recreate
 * the same document. Critical for handling redeployments where storage/ folder
 * is lost but the database persists.
 */
async function regenerateDocument(doc) {
  console.log(`[documents] regenerating doc ${doc.id} (${doc.doc_uuid})...`);
  
  // Load the template and record data
  const template = await loadTemplate(doc.template_id);
  if (!template) {
    throw new Error(`Template ${doc.template_id} no longer exists — cannot regenerate document.`);
  }
  
  const rawRecord = await fetchTemplateRecord(template, doc.record_identifier);
  if (!rawRecord) {
    throw new Error(`Record "${doc.record_identifier}" no longer exists in data source — cannot regenerate document.`);
  }
  
  // Use the SAME data context setup as buildRenderedDocument
  const record = parseJsonLikeFields(rawRecord);
  const singularKey = template.data_source_table.replace(/s$/, '');
  const dataContext = withAutoDates({ [singularKey]: record, [template.data_source_table]: record, ...record });
  
  // Render all HTML regions with proper warnings array
  const headerWarnings = [];
  const bodyWarnings = [];
  const footerWarnings = [];
  const headerHtml = renderTemplate(template.header_html || '', dataContext, headerWarnings);
  const bodyHtml = renderTemplate(template.body_html || '', dataContext, bodyWarnings);
  const footerHtml = renderTemplate(template.footer_html || '', dataContext, footerWarnings);
  
  // Add automatic date HTML (italic, positioned above QR code on final page)
  const automaticDateHtml = `
    <div class="doc-generated-date">
      <em><strong>Generated Date:</strong> ${dataContext.generation_date_gc} &nbsp;/&nbsp; ${dataContext.generation_date_ec}</em>
    </div>
  `;
  
  // Rebuild the tamper-proof footer with the SAME doc_uuid and verification_id
  const hashVerifyFooterHtml = await buildTamperProofFooterHtml(doc.doc_uuid, VERIFY_BASE_URL);
  const deliveryVerifyFooterHtml = doc.verification_id 
    ? await buildDeliveryVerificationQrHtml(doc.verification_id, VERIFY_BASE_URL)
    : '';

  // Look up approver signature if signed or approved
  let signatureHtml = '';
  let approverName = null;
  let approverTs = null;

  try {
    const [sigRows] = await pool.query(
      `SELECT ds.visual_signature_text, ds.signature_timestamp, u.full_name AS approver_name
       FROM digital_signatures ds
       JOIN users u ON u.id = ds.signer_id
       WHERE ds.doc_id = ?
       ORDER BY ds.id DESC LIMIT 1`,
      [doc.id]
    );
    if (sigRows.length > 0) {
      approverName = sigRows[0].approver_name;
      approverTs = sigRows[0].signature_timestamp ? new Date(sigRows[0].signature_timestamp).toISOString() : new Date().toISOString();
      const sigText = `Digitally Approved by ${approverName} on ${approverTs}`;
      signatureHtml = `<p class="visual-signature" style="margin-top:10px;font-style:italic;"><em>${sigText}</em></p>`;
    } else {
      const [srRows] = await pool.query(
        `SELECT sr.approved_at, u.full_name AS approver_name
         FROM signature_requests sr
         JOIN users u ON u.id = sr.approver_id
         WHERE sr.doc_id = ? AND sr.status = 'approved'
         ORDER BY sr.id DESC LIMIT 1`,
        [doc.id]
      );
      if (srRows.length > 0) {
        approverName = srRows[0].approver_name;
        approverTs = srRows[0].approved_at ? new Date(srRows[0].approved_at).toISOString() : new Date().toISOString();
        const sigText = `Digitally Approved by ${approverName} on ${approverTs}`;
        signatureHtml = `<p class="visual-signature" style="margin-top:10px;font-style:italic;"><em>${sigText}</em></p>`;
      }
    }
  } catch (sigErr) {
    console.warn('[documents] Could not fetch signature info for regeneration:', sigErr.message);
  }

  let finalBodyHtml = bodyHtml;
  let finalFooterHtml = footerHtml;

  // Inject the recipient / user signature if the document was signed by the recipient in secure delivery workflow
  const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
  let userSigned = meta.userSigned;
  if (!userSigned) {
    try {
      const [delivRows] = await pool.query(
        `SELECT workflow_signature_data, workflow_user_signed_at, recipient_name
         FROM document_deliveries
         WHERE doc_id = ? AND workflow_signature_data IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [doc.id]
      );
      if (delivRows.length > 0 && delivRows[0].workflow_signature_data) {
        const sigData = typeof delivRows[0].workflow_signature_data === 'string'
          ? JSON.parse(delivRows[0].workflow_signature_data)
          : delivRows[0].workflow_signature_data;
        userSigned = {
          name: sigData.recipientName || sigData.signatureText || delivRows[0].recipient_name,
          photo: sigData.signaturePhoto || null,
          signedAt: sigData.signedAt || delivRows[0].workflow_user_signed_at || new Date().toISOString(),
        };
        meta.userSigned = userSigned;
        await pool.query('UPDATE generated_docs SET metadata = ? WHERE id = ?', [JSON.stringify(meta), doc.id]).catch(() => {});
      }
    } catch (e) {
      console.warn('[documents] regenerateDocument delivery check error:', e.message);
    }
  }

  if (userSigned && (userSigned.name || userSigned.photo)) {
    const injected = injectSignatureIntoDocument(
      { headerHtml, bodyHtml: finalBodyHtml, footerHtml: finalFooterHtml },
      userSigned.name,
      userSigned.photo,
      userSigned.signedAt
    );
    finalBodyHtml = injected.bodyHtml;
    finalFooterHtml = injected.footerHtml;
  }
  
  // Assemble the full HTML with the appropriate watermark for current status
  const fullHtml = assembleDocumentHtml({
    headerHtml,
    bodyHtml: finalBodyHtml,
    footerHtml: finalFooterHtml,
    tamperProofFooterHtml: hashVerifyFooterHtml,
    deliveryVerificationQrHtml: deliveryVerifyFooterHtml,
    watermarkText: resolveWatermarkForStatus(doc.status, template.watermark_text),
    signatureHtml,
    generatedDateHtml: automaticDateHtml,
  });
  
  const pdfBuffer = await htmlToPdfBuffer(fullHtml);
  const fileHash = sha256(pdfBuffer);
  
  // CRITICAL: Verify the regenerated hash matches the original stored hash.
  // If they don't match, the document content has changed (template edited, data changed,
  // or rendering engine differs). Log a warning but still save the file.
  if (fileHash !== doc.file_hash) {
    console.warn(`[documents] regeneration hash mismatch for doc ${doc.id}: original=${doc.file_hash}, new=${fileHash}`);
    console.warn(`[documents] This is expected if the template or data has been modified since original generation.`);
  }
  
  // Save the regenerated PDF to storage
  const {STORAGE_ROOT} = require('../utils/fileStorage');
  const filename = path.basename(doc.file_path);
  const newPath = path.join(STORAGE_ROOT, filename);
  
  // Ensure storage directory exists
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
  
  fs.writeFileSync(newPath, pdfBuffer);
  console.log(`[documents] regenerated doc ${doc.id} saved to ${newPath} (hash: ${fileHash})`);
  
  return { file_path: newPath, file_hash: fileHash };
}

async function loadTemplate(templateId) {
  const [rows] = await pool.query('SELECT * FROM templates WHERE id = ?', [templateId]);
  return rows[0] || null;
}

/**
 * Fetches the one data row a template's Preview/Generate/bulk-validate needs, routed
 * to wherever that template's data actually lives:
 *   - data_source_connection_id set  -> that saved external connection's own table
 *     (MongoDB/PostgreSQL/MySQL/SQLite — see externalDbClients.fetchRecordById)
 *   - otherwise                      -> this app's internal doc_automation database
 *     (dataSourceController.fetchRecordById)
 * Previously this always went to the internal path regardless of the template's
 * configured source, so any externally-mapped template (e.g. a "students" table on
 * an external connection) failed with "Invalid data source table" even though the
 * connection and table were both valid.
 */
async function fetchTemplateRecord(template, recordId) {
  console.log('[documents] fetchTemplateRecord - template.data_source_table:', template.data_source_table, 'recordId:', recordId);
  console.log('[documents] template.data_source_connection_id:', template.data_source_connection_id);
  
  if (template.data_source_connection_id) {
    console.log('[documents] Using external datasource');
    const config = await loadConnectionConfig(template.data_source_connection_id);
    if (!config) {
      throw Object.assign(
        new Error('The external database connection this template is mapped to no longer exists.'),
        { status: 400 }
      );
    }
    return fetchExternalRecordById(config, template.data_source_table, recordId);
  }
  console.log('[documents] Using internal datasource - calling fetchInternalRecordById');
  const record = await fetchInternalRecordById(template.data_source_table, recordId);
  console.log('[documents] Record fetched:', record ? 'SUCCESS' : 'NULL');
  if (record) {
    console.log('[documents] Record fields:', Object.keys(record));
  }
  return record;
}

/**
 * Defensive normalization: mysql2 auto-parses JSON columns into JS objects/arrays by
 * default, but if a deployment's driver config differs, a JSON column could come back
 * as a raw string — which would silently break {{#each}} looping blocks. This catches
 * that case without assuming either behavior.
 */
function parseJsonLikeFields(record) {
  const normalized = { ...record };
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        normalized[key] = JSON.parse(value);
      } catch {
        // not actually JSON — leave as-is
      }
    }
  }
  return normalized;
}

/** Builds the rendered HTML pieces (not yet PDF) shared by preview and generate. */
async function buildRenderedDocument(template, recordId) {
  if (template.status !== 'active') {
    throw Object.assign(new Error('Only "Active" templates can be used for generation.'), { status: 409 }); // BR-001
  }
  if (!template.data_source_table) {
    throw Object.assign(new Error('This template has no data source configured.'), { status: 400 });
  }

  const rawRecord = await fetchTemplateRecord(template, recordId);
  if (!rawRecord) {
    throw Object.assign(new Error(`Record "${recordId}" not found in "${template.data_source_table}".`), { status: 404 });
  }
  const record = parseJsonLikeFields(rawRecord);

  // Namespace the record under the table name so placeholders like {{employee.full_name}} resolve
  const singularKey = template.data_source_table.replace(/s$/, '');
  const dataContext = withAutoDates({ [singularKey]: record, [template.data_source_table]: record, ...record });

  // Each region gets its own warnings bucket so a broken placeholder can be traced back
  // to exactly which part of the template (header/body/footer) it lives in.
  const headerWarnings = [];
  const bodyWarnings = [];
  const footerWarnings = [];
  const headerHtml = renderTemplate(template.header_html, dataContext, headerWarnings);
  const bodyHtml = renderTemplate(template.body_html, dataContext, bodyWarnings);
  const footerHtml = renderTemplate(template.footer_html, dataContext, footerWarnings);

  const placeholderWarnings = [
    ...headerWarnings.map((w) => ({ ...w, region: 'header' })),
    ...bodyWarnings.map((w) => ({ ...w, region: 'body' })),
    ...footerWarnings.map((w) => ({ ...w, region: 'footer' })),
  ];

  // FR-013: only the generation date is ever auto-filled — no "effective date" is
  // guessed or defaulted on the document's behalf. Shown in both calendars per BR spec.
  const automaticDateHtml = `
    <div class="doc-generated-date">
      <em><strong>Generated Date:</strong> ${dataContext.generation_date_gc} &nbsp;/&nbsp; ${dataContext.generation_date_ec}</em>
    </div>
  `;

  return { record, dataContext, headerHtml, bodyHtml, footerHtml, automaticDateHtml, placeholderWarnings };
}

/**
 * POST /api/documents/preview   body: { template_id, record_id }
 * FR-011: pre-generation preview.
 */
async function previewDocument(req, res) {
  const { template_id, record_id } = req.body;

  if (!template_id || !record_id) {
    return res.status(400).json({ success: false, message: 'template_id and record_id are required.' });
  }

  try {
    const { stripEditorOnlyElements } = require('../utils/documentAssembler');
    
    const template = await loadTemplate(template_id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    const { dataContext, headerHtml, bodyHtml, footerHtml, automaticDateHtml, placeholderWarnings } =
      await buildRenderedDocument(template, record_id);

    // Strip × buttons and editor-only elements from preview
    const cleanHeaderHtml = stripEditorOnlyElements(headerHtml);
    const cleanBodyHtml = stripEditorOnlyElements(bodyHtml);
    const cleanFooterHtml = stripEditorOnlyElements(footerHtml);
    
    const combinedHtml = `${cleanHeaderHtml}${cleanBodyHtml}${cleanFooterHtml}${automaticDateHtml}`;

    await recordAudit({ userId: req.user.id, action: 'PREVIEW', details: { templateId: template.id, recordId: record_id }, req });

    return res.status(200).json({
      success: true,
      message: placeholderWarnings.length > 0
        ? `Preview generated with ${placeholderWarnings.length} placeholder issue(s) — fix these before generating the real PDF.`
        : 'Template preview generated successfully.',
      data: {
        template_id: template.id,
        template_name: template.name,
        version: template.version,
        record_id,
        data_source_table: template.data_source_table,
        generation_date: dataContext.generation_date,
        generation_date_gc: dataContext.generation_date_gc,
        generation_date_ec: dataContext.generation_date_ec,
        dynamic_values: {
          generation_date: dataContext.generation_date,
          generation_date_gc: dataContext.generation_date_gc,
          generation_date_ec: dataContext.generation_date_ec,
        },
        watermark_text: template.watermark_text,
        header_html: cleanHeaderHtml,
        body_html: cleanBodyHtml,
        automatic_date_html: automaticDateHtml,
        footer_html: cleanFooterHtml,
        html: combinedHtml,
        placeholder_warnings: placeholderWarnings,
      },
    });
  } catch (err) {
    console.error('[documents] preview error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to generate preview.' });
  }
}

/** Shared single-document generation used by both the single and bulk endpoints. */
async function generateSingleDocument({ template, recordId, userId }) {
  const { headerHtml, bodyHtml, footerHtml, automaticDateHtml, placeholderWarnings } =
    await buildRenderedDocument(template, recordId);

  // Hard stop: a real PDF must never go out with a stray {{placeholder}} left in it or a
  // silently-mangled field. Preview is allowed to show these so the author can see and fix
  // them, but actual generation refuses outright rather than producing a bad document.
  if (placeholderWarnings.length > 0) {
    const summary = placeholderWarnings.map((w) => `[${w.region}] ${w.message}`).join(' ');
    throw Object.assign(
      new Error(`Cannot generate — record "${recordId}" has ${placeholderWarnings.length} unresolved placeholder issue(s): ${summary}`),
      { status: 422, placeholderWarnings }
    );
  }

  const docId = generateDocId(); // FR-015
  const verificationId = generateVerificationId(); // Secure Delivery module: opaque public QR identifier
  
  // Generate QR codes in parallel for faster execution
  const [hashVerifyFooterHtml, deliveryVerifyFooterHtml] = await Promise.all([
    buildTamperProofFooterHtml(docId, VERIFY_BASE_URL), // FR-016, FR-034
    buildDeliveryVerificationQrHtml(verificationId, VERIFY_BASE_URL)
  ]);
  
  // Keep the concatenated version for metadata persistence
  const tamperProofFooterHtml = `${hashVerifyFooterHtml}${deliveryVerifyFooterHtml}`;

  const fullHtml = assembleDocumentHtml({
    headerHtml,
    bodyHtml,
    footerHtml,
    tamperProofFooterHtml: hashVerifyFooterHtml,
    deliveryVerificationQrHtml: deliveryVerifyFooterHtml,
    watermarkText: resolveWatermarkForStatus('draft', template.watermark_text), // FR-017: always DRAFT at first generation
    generatedDateHtml: automaticDateHtml,
  });

  const pdfBuffer = await htmlToPdfBuffer(fullHtml);

  // BR-002: reject if the generated file exceeds 5MB
  const fileSizeMb = pdfBuffer.length / (1024 * 1024);
  if (fileSizeMb > 5) {
    throw Object.assign(new Error(`Generated PDF (${fileSizeMb.toFixed(2)}MB) exceeds the 5MB limit.`), { status: 413 });
  }

  const fileHash = sha256(pdfBuffer); // FR-016, NFR-003
  const fileName = buildFileName(template.name, recordId); // FR-018 — friendly name, shown only at download time
  const storageFileName = buildRandomStorageFileName(); // NFR-002 — actual on-disk name, unguessable
  const storagePath = buildStoragePath(storageFileName);
  fs.writeFileSync(storagePath, pdfBuffer);

  const metadata = JSON.stringify({
    fileName,
    renderPieces: { 
      headerHtml, 
      bodyHtml, 
      footerHtml, 
      generatedDateHtml: automaticDateHtml,
      tamperProofFooterHtml: hashVerifyFooterHtml, 
      deliveryVerificationQrHtml: deliveryVerifyFooterHtml, 
      watermarkText: template.watermark_text 
    },
  });

  // Fast INSERT without transaction - use pool.query directly
  const [rows] = await pool.query(
    `INSERT INTO generated_docs
      (doc_uuid, verification_id, template_id, generated_by, record_identifier, file_path, file_hash, status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8)
     RETURNING id`,
    [docId, verificationId, template.id, userId, String(recordId), storagePath, fileHash, metadata]
  );

  const insertedId = rows[0].id;

  // Async audit logging (non-blocking)
  recordAudit({
    userId, docId: insertedId, action: 'GENERATE',
    details: { docUuid: docId, templateId: template.id, recordId },
  }).catch(err => console.error('[audit] failed to log document generation:', err));

  console.log(`[documents] Generated doc ${insertedId} (${docId}) in ${fileSizeMb.toFixed(2)}MB`);

  return { id: insertedId, docUuid: docId, fileName, fileHash, sizeBytes: pdfBuffer.length };
}

/**
 * POST /api/documents/generate   body: { template_id, record_id }
 * FR-014..FR-018: single PDF generation.
 */
async function generateDocument(req, res) {
  const { template_id, record_id } = req.body;

  if (!template_id || !record_id) {
    return res.status(400).json({ success: false, message: 'template_id and record_id are required.' });
  }

  try {
    const template = await loadTemplate(template_id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    const doc = await generateSingleDocument({ template, recordId: record_id, userId: req.user.id });

    return res.status(201).json({
      success: true,
      message: 'Document generated successfully.',
      data: doc,
    });
  } catch (err) {
    console.error('[documents] generate error:', err);
    return res.status(err.status || 500).json({ success: false, message: err.message || 'Failed to generate document.' });
  }
}

/**
 * POST /api/documents/generate/bulk   body: { template_id, record_ids: [...] }
 * FR-010 (bulk batch), FR-012 (mapping validation report), FR-019 (background job w/ progress).
 * Runs as a fire-and-forget async job; client polls GET /api/documents/bulk-status/:jobId.
 * Each record_id (e.g. from a pasted list or an uploaded .csv) is rendered against its own
 * source record, so every generated document gets that record's own placeholder values —
 * one PDF per ID, all produced in the same batch.
 */
async function generateBulkDocuments(req, res) {
  const { template_id, record_ids } = req.body;

  if (!template_id || !Array.isArray(record_ids) || record_ids.length === 0) {
    return res.status(400).json({ success: false, message: 'template_id and a non-empty record_ids array are required.' });
  }

  const template = await loadTemplate(template_id);
  if (!template) {
    return res.status(404).json({ success: false, message: 'Template not found.' });
  }
  if (template.status !== 'active') {
    return res.status(409).json({ success: false, message: 'Only "Active" templates can be used for generation.' });
  }

  const jobId = createJob(record_ids.length);
  const userId = req.user.id;
  const MAX_RETRIES = 2;

  // Fire-and-forget: process sequentially so we don't overload Chromium with concurrent pages.
  // (Swap for a real worker pool / Bull queue at higher volume — see bulkJobTracker.js note.)
  (async () => {
    for (const recordId of record_ids) {
      // ── Per-record email validation ───────────────────────────────────────
      // Before generating a PDF for this record, confirm the record actually has
      // a valid email address in the template's data source table. This is the
      // same cross-check that initiateSecureDelivery runs before sending — doing
      // it here means every document produced by bulk generation is guaranteed to
      // have a deliverable recipient, and misconfigured records (missing or invalid
      // email column) are surfaced as clear per-record errors in the job results
      // instead of silently generating PDFs that can never be delivered.
      let recordEmail = null;
      let emailValidationError = null;
      try {
        const rawRecord = await fetchTemplateRecord(template, recordId).catch(() => null);
        if (!rawRecord) {
          emailValidationError = `Record "${recordId}" not found in "${template.data_source_table}".`;
        } else {
          // Locate the email column by name convention (same as recipientValidation.js).
          const emailKey = Object.keys(rawRecord).find((k) => /email/i.test(k));
          if (!emailKey || !rawRecord[emailKey]) {
            emailValidationError = `Record "${recordId}" has no email address on file — cannot generate a deliverable document.`;
          } else {
            recordEmail = String(rawRecord[emailKey]).trim();
            // Basic format check — rejects clearly broken values before PDF generation.
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recordEmail)) {
              emailValidationError = `Record "${recordId}" has an invalid email address (${recordEmail}) — fix it in the data source before generating.`;
            }
          }
        }
      } catch (fetchErr) {
        emailValidationError = `Could not validate email for record "${recordId}": ${fetchErr.message}`;
      }

      if (emailValidationError) {
        // Email validation is deterministic — skip retry entirely.
        updateJobProgress(jobId, { recordId, success: false, error: emailValidationError, attempts: 1 });
        continue;
      }

      let lastError = null;
      let succeeded = false;

      for (let attempt = 0; attempt <= MAX_RETRIES && !succeeded; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)); // simple backoff (NFR-004: retry on transient failure)
          }
          const doc = await generateSingleDocument({ template, recordId, userId });
          // docId: the human-facing DOC-YYYYMMDD-XXXXX uuid (FR-015) for display.
          // dbId: the numeric generated_docs.id — needed to initiate a signature request
          // (POST /api/signatures expects doc_id = generated_docs.id, not the uuid).
          updateJobProgress(jobId, {
            recordId,
            success: true,
            docId: doc.docUuid,
            dbId: doc.id,
            recipientEmail: recordEmail, // surface validated email in job results
            attempts: attempt + 1,
          });
          succeeded = true;
        } catch (err) {
          lastError = err;
          // Placeholder problems (422) and "record not found" (404) are deterministic —
          // retrying with the same data will fail the same way every time, so don't
          // burn the retry budget/backoff delay on them.
          if (err.status === 422 || err.status === 404) break;
        }
      }

      if (!succeeded) {
        updateJobProgress(jobId, { recordId, success: false, error: lastError?.message, attempts: MAX_RETRIES + 1 });
      }
    }
  })();

  return res.status(202).json({
    success: true,
    message: `Bulk generation started for ${record_ids.length} record(s).`,
    data: { jobId, total: record_ids.length },
  });
}

/** GET /api/documents/bulk-status/:jobId */
async function getBulkStatus(req, res) {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Job not found (it may have expired or the server restarted).' });
  }
  return res.status(200).json({ success: true, message: 'Job status fetched.', data: job });
}

/** GET /api/documents/:id/download — role-gated file download (all roles except approver). */
async function downloadDocument(req, res) {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    const doc = rows[0];

    // Allow all roles permitted to generate/track documents to view and download.

    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has been deleted. It can still be checked on the Verify Document page using its Doc ID.' });
    }

    // Resolve the file path — the stored value is an absolute path from when the
    // document was generated. Try these paths in order:
    // 1. Stored absolute path (fast path for same-machine access)
    // 2. Filename in current STORAGE_ROOT (handles server moves/redeployments)
    // Resiliently resolve the exact PDF file path via resolveDocFilePath
    // This guarantees recipient download and generator receive/view are 100% identical.
    const { resolveDocFilePath } = require('./secureDeliveryController');
    let resolvedPath = await resolveDocFilePath(doc);

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      console.log(`[documents] download: file not found for doc ${doc.id}, attempting on-demand regeneration...`);
      try {
        const regenerated = await regenerateDocument(doc);
        resolvedPath = regenerated.file_path;
        await pool.query('UPDATE generated_docs SET file_path = ? WHERE id = ?', [resolvedPath, doc.id]);
        console.log(`[documents] download: successfully regenerated doc ${doc.id}`);
      } catch (regenErr) {
        console.error('[documents] download: regeneration failed:', regenErr);
        console.error('[documents] download: full error stack:', regenErr.stack);
        return res.status(410).json({ 
          success: false, 
          message: `File no longer exists. Regeneration failed: ${regenErr.message}. The template or data source may have been modified or deleted.`,
          details: {
            docId: doc.doc_uuid,
            reason: regenErr.message,
            suggestion: 'Try regenerating this document from My Documents page with the current template and data.'
          }
        });
      }
    }

    const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
    let downloadFileName = meta.fileName;
    if (!downloadFileName || downloadFileName === 'document.pdf') {
      try {
        const [tplRows] = await pool.query('SELECT name FROM templates WHERE id = ?', [doc.template_id]);
        const tplName = tplRows?.[0]?.name || 'Document';
        const dateObj = doc.generated_at ? new Date(doc.generated_at) : new Date();
        downloadFileName = buildFileName(tplName, doc.record_identifier || doc.doc_uuid || String(doc.id), dateObj);
      } catch {
        downloadFileName = `document-${doc.doc_uuid || doc.id}.pdf`;
      }
    }
    const isInline = req.query.disposition === 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${isInline ? 'inline' : 'attachment'}; filename="${downloadFileName}"`);

    await recordAudit({ userId: req.user.id, docId: doc.id, action: 'DOWNLOAD', details: { via: 'direct' }, req });

    fs.createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    console.error('[documents] download error:', err);
    return res.status(500).json({ success: false, message: 'Failed to download document.' });
  }
}

/**
 * GET /api/documents/notify-view/:token   PUBLIC — no login required.
 * Generator-side counterpart to GET /api/signatures/review/:token: the secure,
 * one-time link sent in the docSigned/docRejected notification emails
 * (see signatureController.buildDocNotifyUrl), letting the Generator review the
 * outcome in the browser without signing in first — the same way the Approver
 * already gets to review the pending document before entering the OTP.
 * Single-use, enforced via generated_docs.notify_view_token_used_at: the first
 * successful open marks it used; any later hit on the same token is rejected even
 * though the JWT itself may still be cryptographically valid until it expires.
 */
async function viewDocumentByNotifyToken(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'This review link is invalid or has expired.' });
  }
  if (decoded.purpose !== 'doc_notify_view' || !decoded.docId) {
    return res.status(401).json({ success: false, message: 'This review link is invalid.' });
  }

  try {
    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [decoded.docId]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    const isInternalOrAuth = Boolean(decoded.inApp || req.headers.authorization);
    if (doc.notify_view_token_used_at && !isInternalOrAuth) {
      return res.status(410).json({
        success: false,
        message: 'This one-time review link has already been used. Please sign in to Doc Automation and open it from My Documents instead.',
      });
    }
    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has been deleted and is no longer available to view.' });
    }
    const { resolveDocFilePath } = require('./secureDeliveryController');
    let resolvedPath = await resolveDocFilePath(doc);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      try {
        const regenerated = await regenerateDocument(doc);
        resolvedPath = regenerated.file_path;
      } catch (e) {
        console.warn('[documents] viewDocumentByNotifyToken regen warning:', e.message);
      }
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });
    }

    if (!isInternalOrAuth) {
      await pool.query('UPDATE generated_docs SET notify_view_token_used_at = NOW() WHERE id = ?', [doc.id]);
    }

    const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${meta.fileName || 'document.pdf'}"`);

    await recordAudit({ docId: doc.id, action: 'VIEW', details: { via: 'generator_notify_link' }, req });

    fs.createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    console.error('[documents] viewDocumentByNotifyToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load document for viewing.' });
  }
}

/** Shared token check for the three notify-view actions below. Throws on any failure. */
function decodeNotifyToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);
  if (decoded.purpose !== 'doc_notify_view' || !decoded.docId) {
    throw new Error('invalid_purpose');
  }
  return decoded;
}

/**
 * GET /api/documents/notify-view/:token/meta   PUBLIC — no login required.
 * Lets the Generator's one-time notify-view page find out the actual OUTCOME behind
 * the link — signed/approved, or rejected (with the Approver's reason) — before it
 * decides what to show: the Send/Secure-Link delivery actions only ever make sense
 * for a signed document (the backend already 409s them otherwise — see
 * sendSecureLinkViaNotifyToken/sendDocumentViaNotifyToken below), while a rejected
 * one instead needs the rejection reason surfaced plus a straight path into
 * "Edit & Resubmit" (same feature Document Tracking already offers — see
 * resubmitDocument), not a set of delivery buttons that can't succeed.
 * Deliberately read-only: unlike the PDF-streaming GET above, this never touches
 * generated_docs.notify_view_token_used_at, so calling it never burns the one-time
 * view — the page can safely call this on every load, even after the PDF preview
 * itself has already been used up.
 */
async function getNotifyTokenMeta(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = decodeNotifyToken(token);
  } catch {
    return res.status(401).json({ success: false, message: 'This link is invalid or has expired.' });
  }

  try {
    const [[doc]] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.status, gd.record_identifier, gd.template_id, gd.deleted_at,
              t.name AS template_name,
              latest_sr.approver_id, approver_u.full_name AS approver_name,
              latest_sr.status AS signature_status, latest_sr.rejection_reason
       FROM generated_docs gd
       JOIN templates t ON t.id = gd.template_id
       LEFT JOIN signature_requests latest_sr
         ON latest_sr.id = (
           SELECT sr2.id FROM signature_requests sr2
           WHERE sr2.doc_id = gd.id
           ORDER BY sr2.created_at DESC
           LIMIT 1
         )
       LEFT JOIN users approver_u ON approver_u.id = latest_sr.approver_id
       WHERE gd.id = ?`,
      [decoded.docId]
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has been deleted and is no longer available.' });
    }

    // A rejected request always wins the outcome label even if gd.status has since
    // moved on (e.g. a resubmit was already started elsewhere) — the notify link was
    // minted for THIS specific reject event, so it should keep describing that event.
    const outcome = doc.signature_status === 'rejected'
      ? 'rejected'
      : (doc.status === 'signed' || doc.status === 'delivered')
        ? 'signed'
        : 'other';

    return res.status(200).json({
      success: true,
      message: 'Document status fetched.',
      data: {
        id: doc.id,
        doc_uuid: doc.doc_uuid,
        status: doc.status,
        outcome,
        record_identifier: doc.record_identifier,
        template_id: doc.template_id,
        template_name: doc.template_name,
        approver_id: doc.approver_id,
        approver_name: doc.approver_name,
        // Never leak the reason for a NON-rejection outcome — a stale rejection_reason
        // can linger on an old signature_requests row that's no longer the relevant one.
        rejection_reason: outcome === 'rejected' ? doc.rejection_reason : null,
      },
    });
  } catch (err) {
    console.error('[documents] getNotifyTokenMeta error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load document status.' });
  }
}

/**
 * POST /api/documents/notify-view/:token/auto-login   PUBLIC — no password required.
 * Issues an 8-hour JWT session for the generator so the link directly opens
 * inside the authenticated system without asking for login username/password.
 */
async function notifyViewAutoLogin(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = decodeNotifyToken(token);
  } catch {
    return res.status(401).json({ success: false, message: 'This link is invalid or has expired.' });
  }

  try {
    const [[doc]] = await pool.query(
      'SELECT id, generated_by, deleted_at FROM generated_docs WHERE id = ?',
      [decoded.docId]
    );
    if (!doc || doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'The document is no longer available.' });
    }

    const [[user]] = await pool.query(
      'SELECT id, email, full_name, role FROM users WHERE id = ? LIMIT 1',
      [doc.generated_by]
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'Generator account not found.' });
    }

    const sessionToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        purpose: 'notify_view_auto_login',
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    await recordAudit({
      userId: user.id,
      docId: doc.id,
      action: 'VIEW',
      details: { event: 'notify_view_auto_login' },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Auto-login successful.',
      data: {
        token: sessionToken,
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      },
    });
  } catch (err) {
    console.error('[documents] notifyViewAutoLogin error:', err);
    return res.status(500).json({ success: false, message: 'Failed to auto-login.' });
  }
}

/**
 * GET /api/documents/notify-view/:token/download   PUBLIC — no login required.
 * "Download the document" action on the Generator's one-time notify-view page.
 * Deliberately NOT gated by generated_docs.notify_view_token_used_at — that flag only
 * protects the inline "review" stream from being re-opened a second time; downloading
 * is a separate action taken during the same legitimate visit and must not be blocked
 * by having already viewed the PDF on the same page load.
 */
async function downloadViaNotifyToken(req, res) {
  const { token } = req.params;

  let decoded;
  try {
    decoded = decodeNotifyToken(token);
  } catch {
    return res.status(401).json({ success: false, message: 'This link is invalid or has expired.' });
  }

  try {
    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [decoded.docId]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    const { resolveDocFilePath } = require('./secureDeliveryController');
    let resolvedPath = await resolveDocFilePath(doc);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      try {
        const regenerated = await regenerateDocument(doc);
        resolvedPath = regenerated.file_path;
      } catch (regenErr) {
        console.warn('[documents] downloadViaNotifyToken: signature regen warning:', regenErr.message);
      }
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });
    }

    const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.fileName || 'document.pdf'}"`);

    await recordAudit({ docId: doc.id, action: 'DOWNLOAD', details: { via: 'generator_notify_link' }, req });

    fs.createReadStream(resolvedPath).pipe(res);
  } catch (err) {
    console.error('[documents] downloadViaNotifyToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to download document.' });
  }
}

/**
 * POST /api/documents/notify-view/:token/secure-link   body: { email }   PUBLIC.
 * DEPRECATED — kept for backwards-compat with any outstanding emailed links.
 * New code should use POST /notify-view/:token/deliver-validated instead.
 * Redirects to the validated endpoint internally.
 */
async function sendSecureLinkViaNotifyToken(req, res) {
  req.body.delivery_method = 'secure_link_otp';
  return deliverViaNotifyToken(req, res);
}

/**
 * POST /api/documents/notify-view/:token/deliver   body: { email }   PUBLIC.
 * DEPRECATED — kept for backwards-compat. Redirects to validated endpoint.
 */
async function sendDocumentViaNotifyToken(req, res) {
  req.body.delivery_method = 'email_attachment';
  return deliverViaNotifyToken(req, res);
}

/**
 * POST /api/documents/notify-view/:token/deliver-validated
 * Body: { email, delivery_method: 'secure_link_otp' | 'email_attachment' }
 *
 * The SINGLE public delivery endpoint for the Generator notify-view page.
 * Uses the notify-view JWT as the credential (no Authorization header needed)
 * and runs the EXACT same validation as the in-system SecureDeliveryModal:
 *   1. Decodes + verifies the notify JWT to get the doc id.
 *   2. Checks doc state (signed/delivered, not deleted/revoked).
 *   3. Runs validateEmailMatchesRecord — if email ≠ the record's email column:
 *      "The user's email and ID do not match. Please enter the correct email
 *       for the assigned user."
 *   4. Calls initiateSecureDelivery's logic directly to create the
 *      document_deliveries row and send the email.
 *
 * Same backend, same validation, same database table — one system.
 */
async function deliverViaNotifyToken(req, res) {
  const { token } = req.params;
  const { email, delivery_method } = req.body || {};

  if (!email || !String(email).trim()) {
    return res.status(400).json({ success: false, message: 'A recipient email is required.' });
  }

  let decoded;
  try {
    decoded = decodeNotifyToken(token);
  } catch {
    return res.status(401).json({ success: false, message: 'This link is invalid or has expired.' });
  }

  try {
    const [[doc]] = await pool.query(
      `SELECT gd.*, t.data_source_table, t.data_source_connection_id
       FROM generated_docs gd JOIN templates t ON t.id = gd.template_id
       WHERE gd.id = ?`,
      [decoded.docId]
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found.' });
    if (doc.deleted_at) return res.status(410).json({ success: false, message: 'This document has been deleted.' });
    if (doc.revoked_at) return res.status(410).json({ success: false, message: 'This document has been revoked.' });
    if (doc.status !== 'signed' && doc.status !== 'delivered') {
      return res.status(409).json({ success: false, message: 'Only a signed document can be delivered.' });
    }
    if (!fs.existsSync(doc.file_path)) {
      return res.status(410).json({ success: false, message: 'File no longer exists on disk.' });
    }

    // ── Email / Record-ID cross-check — SAME as initiateSecureDelivery ──────
    const { validateEmailMatchesRecord } = require('../utils/recipientValidation');
    const crossCheck = await validateEmailMatchesRecord(
      email,
      doc.record_identifier,
      doc.data_source_table,
      doc.data_source_connection_id
    );
    if (!crossCheck.ok) {
      return res.status(400).json({ success: false, message: crossCheck.message });
    }

    const recipientEmail = String(email).trim().toLowerCase();
    const recipientName = crossCheck.recipientName || recipientEmail;

    // Write ownership ground truth.
    await pool.query(
      'UPDATE generated_docs SET recipient_id = NULL, recipient_email = ?, recipient_name = ? WHERE id = ?',
      [recipientEmail, recipientName, doc.id]
    );

    const method = delivery_method === 'email_attachment' ? 'email_attachment' : 'secure_link_otp';

    if (method === 'email_attachment') {
      // ── email_attachment path ──────────────────────────────────────────────
      let emailStatus = 'failed';
      try {
        const pdfBuffer = fs.readFileSync(doc.file_path);
        const meta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
        const { subject, html } = templates.documentAttached({ docId: doc.doc_uuid });
        const sendResult = await sendMail({
          to: recipientEmail, subject, html,
          attachments: [{ filename: meta.fileName || 'document.pdf', content: pdfBuffer, contentType: 'application/pdf' }],
        });
        emailStatus = sendResult.success ? 'sent' : 'failed';
      } catch (e) { console.error('[documents] deliverViaNotifyToken attachment error:', e.message); }

      const placeholderHash = require('../utils/secureDeliveryToken').hashToken(`email_attachment_${doc.id}_${Date.now()}`);
      const [ins] = await pool.query(
        `INSERT INTO document_deliveries
          (doc_id, recipient_email, recipient_name, delivery_method,
           secure_token_hash, token_expiry, otp_code, otp_expiry,
           email_status, plain_copy_email_status, sent_at, created_by)
         VALUES (?, ?, ?, 'email_attachment', ?, NOW(), 'N/A', NOW(), ?, 'not_sent', NOW(), ?)`,
        [doc.id, recipientEmail, recipientName, placeholderHash, emailStatus, doc.generated_by]
      );
      if (doc.status === 'signed') {
        await pool.query("UPDATE generated_docs SET status = 'delivered' WHERE id = ?", [doc.id]);
      }
      await recordAudit({
        docId: doc.id, action: 'SECURE_DELIVER',
        details: { deliveryId: ins.insertId, recipientEmail, method: 'email_attachment', via: 'notify_token' },
        req,
      });
      return res.status(201).json({
        success: true,
        message: emailStatus === 'sent'
          ? `Document emailed to ${recipientEmail}.`
          : `Delivery recorded but email could not be sent — check SMTP settings.`,
      });
    }

    // ── secure_link_otp path ───────────────────────────────────────────────
    const { generateSecureToken, tokenExpiryDate } = require('../utils/secureDeliveryToken');
    const { generateOtp, hashOtp, otpExpiryDate } = require('../utils/otp');
    const { rawToken, tokenHash } = generateSecureToken();
    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);

    const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
    const secureUrl = `${CLIENT_URL}/deliver/${encodeURIComponent(rawToken)}`;

    const [ins] = await pool.query(
      `INSERT INTO document_deliveries
        (doc_id, recipient_email, recipient_name, delivery_method, secure_token_hash, token_expiry,
         otp_code, otp_expiry, email_status, created_by)
       VALUES (?, ?, ?, 'secure_link_otp', ?, ?, ?, ?, 'queued', ?)`,
      [doc.id, recipientEmail, recipientName, tokenHash, tokenExpiryDate(), otpHash, otpExpiryDate(), doc.generated_by]
    );
    const deliveryId = ins.insertId;

    const { subject, html } = templates.secureDeliveryReady({ recipientName, docId: doc.doc_uuid, secureUrl, otpCode });
    const linkResult = await sendMail({ to: recipientEmail, subject, html });
    await pool.query(
      'UPDATE document_deliveries SET email_status = ?, sent_at = NOW() WHERE id = ?',
      [linkResult.success ? 'sent' : 'failed', deliveryId]
    );

    if (doc.status === 'signed') {
      await pool.query("UPDATE generated_docs SET status = 'delivered' WHERE id = ?", [doc.id]);
    }
    await recordAudit({
      docId: doc.id, action: 'SECURE_DELIVER',
      details: { deliveryId, recipientEmail, method: 'secure_link_otp', via: 'notify_token', linkEmailSent: linkResult.success },
      req,
    });
    return res.status(201).json({
      success: true,
      message: linkResult.success
        ? `Secure link sent to ${recipientEmail}. They will receive the OTP and must verify identity before downloading.`
        : `Delivery recorded but the secure link email could not be sent to ${recipientEmail} — check SMTP settings.`,
    });
  } catch (err) {
    console.error('[documents] deliverViaNotifyToken error:', err);
    return res.status(500).json({ success: false, message: 'Failed to deliver document.' });
  }
}

/**
 * POST /api/documents/validate-bulk   body: { template_id, record_ids: [...] }
 * FR-012: pre-flight mapping validation report before committing to bulk generation.
 * Checks each record against the template's known placeholder fields and flags gaps.
 */
async function validateBulkGeneration(req, res) {
  const { template_id, record_ids } = req.body;

  if (!template_id || !Array.isArray(record_ids) || record_ids.length === 0) {
    return res.status(400).json({ success: false, message: 'template_id and a non-empty record_ids array are required.' });
  }

  try {
    const template = await loadTemplate(template_id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    const [placeholderRows] = await pool.query(
      'SELECT field_path FROM template_placeholders WHERE template_id = ?',
      [template_id]
    );
    const AUTO_DATE_FIELDS = new Set(['generation_date', 'generation_date_gc', 'generation_date_ec', 'generation_date_am', 'generation_date_ec_am']);
    const requiredFields = placeholderRows.map((r) => r.field_path).filter((f) => !AUTO_DATE_FIELDS.has(f));

    const report = [];
    for (const recordId of record_ids) {
      try {
        const record = await fetchTemplateRecord(template, recordId);
        if (!record) {
          report.push({ recordId, ok: false, missingFields: ['(record not found)'] });
          continue;
        }

        const missingFields = requiredFields.filter((fieldPath) => {
          // field paths look like "employee.salary" or "salary" depending on how they were authored
          const parts = fieldPath.split('.');
          const key = parts[parts.length - 1];
          return record[key] === undefined || record[key] === null || record[key] === '';
        });

        report.push({ recordId, ok: missingFields.length === 0, missingFields });
      } catch (err) {
        report.push({ recordId, ok: false, missingFields: [`(error: ${err.message})`] });
      }
    }

    const okCount = report.filter((r) => r.ok).length;

    return res.status(200).json({
      success: true,
      message: `${okCount} of ${report.length} records ready to generate.`,
      data: { requiredFields, report },
    });
  } catch (err) {
    console.error('[documents] validateBulk error:', err);
    return res.status(500).json({ success: false, message: 'Failed to validate bulk mapping.' });
  }
}

/**
 * DELETE /api/documents/:id
 * Document Tracking's "Delete" action. This is a SOFT delete: the PDF is removed from
 * disk (frees storage, and immediately blocks download/deliver/secure-link on this
 * doc), but the generated_docs row itself is kept forever — doc_uuid, file_hash and
 * status are never touched. That's deliberate: Verify Document (FR-033..035) only ever
 * compares an uploaded PDF's hash (or a pasted Doc ID) against those DB-persisted
 * values, and is explicitly designed to keep working even when the original file is
 * gone — so a document must stay verifiable after being deleted here.
 *
 * Permission: the document's own generator, or an admin (super_admin/system_admin).
 * Blocked while status is 'pending' — the file backing an in-flight approver review
 * (their one-time OTP review link) would disappear mid-review; the doc must first be
 * approved or rejected.
 */
async function deleteDocument(req, res) {
  const { id } = req.params;
  try {
    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has already been deleted.' });
    }

    const isOwner = doc.generated_by === req.user.id;
    const isAdmin = req.user.role === 'super_admin' || req.user.role === 'system_admin';
    
    // Check if current user is the assigned approver for this pending document
    let isAssignedApprover = false;
    if (doc.status === 'pending') {
      const [[sigReq]] = await pool.query(
        'SELECT approver_id FROM signature_requests WHERE doc_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
        [doc.id, 'pending']
      );
      if (sigReq && sigReq.approver_id === req.user.id) {
        isAssignedApprover = true;
      }
    }
    
    if (!isOwner && !isAdmin && !isAssignedApprover) {
      return res.status(403).json({ success: false, message: 'You can only delete documents you generated or are assigned to review.' });
    }
    
    if (doc.status === 'pending') {
      // GENERATOR (owner), assigned APPROVER, or ADMIN can all delete a pending document.
      // Deleting cancels the in-flight signature request immediately.
      await pool.query(
        `UPDATE signature_requests 
            SET status = 'rejected', 
                rejection_reason = ? 
          WHERE doc_id = ? AND status = 'pending'`,
        [
          isAssignedApprover 
            ? 'Cancelled by approver' 
            : isOwner 
              ? 'Cancelled by document owner' 
              : 'Cancelled by administrator',
          doc.id
        ]
      );
    }

    if (fs.existsSync(doc.file_path)) {
      try {
        fs.unlinkSync(doc.file_path);
      } catch (unlinkErr) {
        console.error('[documents] delete: failed to remove file from disk:', unlinkErr.message);
      }
    }

    await pool.query('UPDATE generated_docs SET deleted_at = NOW() WHERE id = ?', [id]);
    await recordAudit({
      userId: req.user.id,
      docId: doc.id,
      action: 'DELETE_DOCUMENT',
      details: { doc_uuid: doc.doc_uuid },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Document deleted. It can still be checked on the Verify Document page using its Doc ID.',
    });
  } catch (err) {
    console.error('[documents] delete error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete document.' });
  }
}

/**
 * POST /api/documents/:id/resubmit   body: { record_identifier?, note? }   AUTHENTICATED.
 * "Edit & Resubmit" — two cases now share this endpoint:
 *
 *   A) Approver rejected (status='draft', signature_status='rejected'):
 *      classic flow — regenerate with the corrected record/template and send
 *      DIRECTLY to the recipient without going back through the approver.
 *
 *   B) Recipient rejected ownership (status='delivered', delivery ownership='REJECTED'):
 *      the approver already signed it; the only problem is the wrong person received
 *      it. Regenerate and send directly to the on-record recipient again — still no
 *      approver re-step needed.
 *
 * In both cases the new PDF is stamped as 'signed' immediately (the Generator is
 * correcting and re-sending, not seeking a new approval), then initiateResubmitDelivery
 * is called to send it via secure-link + OTP to the same recipient.
 *
/**
 * Strict Rejection Recipient Enforcement:
 * A rejected document is only visible/actionable for the recipient(s) explicitly
 * selected when the Approver rejected it.
 *
 * Checks if req.user is an authorized rejection recipient:
 * - If rejection metadata contains recipientIds (array of user IDs) or recipientRoles (array of roles),
 *   req.user MUST be in recipientIds or req.user.role MUST be in recipientRoles.
 * - If no explicit recipientIds/recipientRoles exist (legacy documents), falls back to generator or admin.
 */
function isAuthorizedRejectionRecipient(user, docMeta, docGeneratedBy) {
  if (!user) return false;
  const rejection = docMeta?.rejection;
  if (!rejection) {
    // Legacy fallback: generator or admins
    return user.id === docGeneratedBy || user.role === 'super_admin' || user.role === 'system_admin';
  }

  const recipientIds = Array.isArray(rejection.recipientIds)
    ? rejection.recipientIds.map(Number)
    : [];
  const recipientRoles = Array.isArray(rejection.recipientRoles)
    ? rejection.recipientRoles
    : [];

  if (recipientIds.length > 0 || recipientRoles.length > 0) {
    const matchesId = recipientIds.includes(Number(user.id));
    const matchesRole = recipientRoles.includes(user.role);
    return matchesId || matchesRole;
  }

  // Fallback for legacy documents
  return user.id === docGeneratedBy || user.role === 'super_admin' || user.role === 'system_admin';
}

async function resubmitDocument(req, res) {
  const { id } = req.params;
  const { record_identifier, note } = req.body || {};

  try {
    // ------------------------------------------------------------
    // 1. Load the original rejected document
    // ------------------------------------------------------------
    const [[doc]] = await pool.query(
      'SELECT * FROM generated_docs WHERE id = ?',
      [id]
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Document not found.',
      });
    }

    if (doc.deleted_at) {
      return res.status(410).json({
        success: false,
        message: 'This document has been deleted.',
      });
    }

    // ------------------------------------------------------------
    // 2. Check rejection recipient authorization
    // Only the designated recipient who received the rejection
    // can resubmit this document.
    // ------------------------------------------------------------
    let docMeta = {};
    try {
      docMeta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
    } catch (e) {}

    if (!isAuthorizedRejectionRecipient(req.user, docMeta, doc.generated_by)) {
      return res.status(403).json({
        success: false,
        message: 'Only the selected rejection recipient can resubmit this document.',
      });
    }

    // ------------------------------------------------------------
    // 3. Only rejected/draft documents can be resubmitted
    // ------------------------------------------------------------
    if (doc.status === 'pending') {
      return res.status(409).json({
        success: false,
        message:
          'This document is still awaiting approver review and cannot be resubmitted yet.',
      });
    }

    if (doc.status !== 'draft' && doc.status !== 'delivered') {
      return res.status(409).json({
        success: false,
        message:
          `Document has status "${doc.status}" and cannot be resubmitted.`,
      });
    }

    // ------------------------------------------------------------
    // 4. Find the previous signature request
    //
    // We need the approver who rejected the original document.
    // That same approver will receive the new approval request.
    // ------------------------------------------------------------
    const [[previousSignatureRequest]] = await pool.query(
      `SELECT id, approver_id, status, rejection_reason
       FROM signature_requests
       WHERE doc_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [doc.id]
    );

    if (!previousSignatureRequest) {
      return res.status(409).json({
        success: false,
        message:
          'No previous approval request was found for this document. The document cannot be resubmitted through the approval workflow.',
      });
    }

    if (!previousSignatureRequest.approver_id) {
      return res.status(409).json({
        success: false,
        message:
          'The previous approval request does not have an assigned approver.',
      });
    }

    const previousApproverId = previousSignatureRequest.approver_id;

    // ------------------------------------------------------------
    // 5. Load the template
    // ------------------------------------------------------------
    const template = await loadTemplate(doc.template_id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message:
          'The template this document was built from no longer exists.',
      });
    }

    // ------------------------------------------------------------
    // 6. Determine which record should be regenerated
    // ------------------------------------------------------------
    const recordId =
      (record_identifier && String(record_identifier).trim()) ||
      doc.record_identifier;

    const resubmitNote =
      note && String(note).trim()
        ? String(note).trim()
        : null;

    // ------------------------------------------------------------
    // 7. Generate a COMPLETELY NEW PDF/document
    //
    // generateSingleDocument() creates it as status = draft.
    // That is exactly what runInitiateSignature() expects.
    // ------------------------------------------------------------
    console.log(
      `[documents] Resubmitting document ${doc.doc_uuid}. ` +
      `Regenerating new document for approver ${previousApproverId}...`
    );

    const previousMetadata = typeof doc.metadata === 'string'
      ? JSON.parse(doc.metadata)
      : (doc.metadata || {});

    const originalGeneratorId = previousMetadata.original_generator_id || doc.generated_by;

    const newDoc = await generateSingleDocument({
      template,
      recordId,
      userId: originalGeneratorId,
    });

    console.log(
      `[documents] New resubmitted document generated: ${newDoc.docUuid} for original creator ${originalGeneratorId}`
    );

    // ------------------------------------------------------------
    // 8. Store resubmission metadata on the NEW document
    // ------------------------------------------------------------

    const [[newDocRow]] = await pool.query(
      'SELECT metadata FROM generated_docs WHERE id = ?',
      [newDoc.id]
    );

    const newMetadata = typeof newDocRow?.metadata === 'string' 
      ? JSON.parse(newDocRow.metadata)
      : (newDocRow?.metadata || {});

    const previousRound = Number(
      previousMetadata.resubmissionRound || 0
    );

    newMetadata.original_generator_id = originalGeneratorId;
    newMetadata.resubmitNote = resubmitNote;
    newMetadata.resubmittedFromDocUuid = doc.doc_uuid;
    newMetadata.resubmissionRound = previousRound + 1;
    newMetadata.resubmitted_by = {
      id: req.user.id,
      name: req.user.full_name,
      role: req.user.role,
      at: new Date().toISOString(),
    };

await pool.query(
  'UPDATE generated_docs SET metadata = ? WHERE id = ?',
  [
    JSON.stringify(newMetadata),
    newDoc.id,
  ]
);
    // ------------------------------------------------------------
    // 9. IMPORTANT:
    // Send the NEW document back through the normal approval flow.
    //
    // This will:
    //   - create a NEW signature_requests row
    //   - assign the SAME approver
    //   - generate a NEW OTP
    //   - generate a NEW secure review URL
    //   - change new document status to pending
    //   - send the approver an email
    //   - create the normal SIGN audit record
    // ------------------------------------------------------------
    const signatureResult = await runInitiateSignature({
      docId: newDoc.id,
      approverId: previousApproverId,
      userId: req.user.id,
      req,
      note: resubmitNote,
    });

    if (!signatureResult.ok) {
      // The new document was generated, but the approval request
      // could not be created.
      //
      // Keep the new document as draft so it can be diagnosed/retried.
      console.error(
        '[documents] resubmit: failed to initiate new signature request:',
        signatureResult.message
      );

      return res.status(signatureResult.status || 500).json({
        success: false,
        message:
          `New document was generated, but it could not be sent for approval: ${signatureResult.message}`,
        data: {
          id: newDoc.id,
          docUuid: newDoc.docUuid,
          status: 'draft',
        },
      });
    }

    console.log(
      `[documents] New approval request created: ` +
      `${signatureResult.signatureRequestId} ` +
      `for approver ${previousApproverId}`
    );

    // ------------------------------------------------------------
    // 10. The OLD document is now superseded.
    //
    // IMPORTANT:
    // We do this AFTER the new approval request has been created.
    // ------------------------------------------------------------
    if (fs.existsSync(doc.file_path)) {
      try {
        fs.unlinkSync(doc.file_path);
      } catch (unlinkErr) {
        console.error(
          '[documents] resubmit: failed to remove superseded file:',
          unlinkErr.message
        );
      }
    }

    await pool.query(
      'UPDATE generated_docs SET deleted_at = NOW() WHERE id = ?',
      [id]
    );

    // ------------------------------------------------------------
    // 11. Audit the resubmission
    // ------------------------------------------------------------
    await recordAudit({
      userId: req.user.id,
      docId: newDoc.id,
      action: 'RESUBMIT',
      details: {
        originalDocId: doc.id,
        originalDocUuid: doc.doc_uuid,
        newDocId: newDoc.id,
        newDocUuid: newDoc.docUuid,
        signatureRequestId: signatureResult.signatureRequestId,
        approverId: previousApproverId,
        note: resubmitNote,
      },
      req,
    });

    // ------------------------------------------------------------
    // 12. Return success
    // ------------------------------------------------------------
    return res.status(201).json({
      success: true,
      message:
        `Corrected document ${newDoc.docUuid} was generated and sent back to ${signatureResult.approverName} for approval.`,
      data: {
        id: newDoc.id,
        docId: newDoc.id,
        docUuid: newDoc.docUuid,
        status: 'pending',
        signatureRequestId: signatureResult.signatureRequestId,
        approverId: previousApproverId,
        approverName: signatureResult.approverName,
      },
    });
  } catch (err) {
    console.error('[documents] resubmit error:', err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to resubmit document.',
    });
  }
}

/**
 * GET /api/documents/rejected
 * Lists rejected generated documents requiring review/correction.
 * Strictly filtered so each user only sees documents where they were the selected rejection recipient.
 */
async function listRejectedDocuments(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT gd.id, gd.doc_uuid, gd.template_id, gd.record_identifier, gd.generated_by,
              gd.status, gd.metadata, gd.generated_at,
              t.name AS template_name, t.category AS template_category, t.version AS template_version,
              u.full_name AS generator_name,
              sr.rejection_reason AS approver_rejection_reason,
              sr.status AS signature_status,
              sr.created_at AS signature_requested_at,
              app_u.full_name AS approver_name,
              dd.rejection_reason AS delivery_rejection_reason,
              dd.ownership_status AS delivery_ownership_status
       FROM generated_docs gd
       JOIN templates t ON t.id = gd.template_id
       JOIN users u ON u.id = gd.generated_by
       LEFT JOIN (
         SELECT sr1.doc_id, sr1.approver_id, sr1.rejection_reason, sr1.status, sr1.created_at
         FROM signature_requests sr1
         WHERE sr1.id = (
           SELECT MAX(sr2.id) FROM signature_requests sr2 WHERE sr2.doc_id = sr1.doc_id
         )
       ) sr ON sr.doc_id = gd.id
       LEFT JOIN users app_u ON app_u.id = sr.approver_id
       LEFT JOIN (
         SELECT dd1.doc_id, dd1.rejection_reason, dd1.ownership_status
         FROM document_deliveries dd1
         WHERE dd1.id = (
           SELECT MAX(dd2.id) FROM document_deliveries dd2 WHERE dd2.doc_id = dd1.doc_id
         )
       ) dd ON dd.doc_id = gd.id
       WHERE gd.deleted_at IS NULL
         AND (
           (gd.status = 'draft' AND sr.status = 'rejected')
           OR (gd.status = 'rejected')
           OR (dd.ownership_status = 'REJECTED')
         )
       ORDER BY gd.id DESC`
    );

    const formatted = (rows || [])
      .filter((r) => {
        let meta = {};
        try {
          meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        } catch (e) {}
        return isAuthorizedRejectionRecipient(req.user, meta, r.generated_by);
      })
      .map((r) => {
        let meta = {};
        try {
          meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {});
        } catch (e) {}

        const reason = r.approver_rejection_reason || r.delivery_rejection_reason || meta.resubmitNote || '(No reason specified)';
        const rejectionSource = r.delivery_ownership_status === 'REJECTED' ? 'recipient' : 'approver';

        return {
          id: r.id,
          doc_uuid: r.doc_uuid,
          template_id: r.template_id,
          template_name: r.template_name,
          template_category: r.template_category,
          template_version: r.template_version,
          record_identifier: r.record_identifier,
          generated_by: r.generated_by,
          generator_name: r.generator_name,
          approver_name: r.approver_name || 'Approver',
          rejection_reason: reason,
          rejection_source: rejectionSource,
          generated_at: r.generated_at,
          metadata: meta,
        };
      });

    return res.status(200).json({
      success: true,
      message: 'Rejected documents fetched.',
      data: formatted,
    });
  } catch (err) {
    console.error('[documents] listRejectedDocuments error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch rejected documents.' });
  }
}

/**
 * GET /api/documents/:id/rejection-context
 * Returns the rejected document along with its template data loaded into
 * header_html, body_html, footer_html, so it can open directly in the normal TemplateForm.
 */
async function getRejectionContext(req, res) {
  const { id } = req.params;
  try {
    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has already been deleted.' });
    }

    let docMeta = {};
    try {
      docMeta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
    } catch (e) {}

    if (!isAuthorizedRejectionRecipient(req.user, docMeta, doc.generated_by)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not the designated recipient for this rejected document.',
      });
    }

    const template = await loadTemplate(doc.template_id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Associated template not found.' });
    }

    // Find the latest rejection reason and approver info
    const [[sigReq]] = await pool.query(
      `SELECT sr.id, sr.approver_id, sr.status, sr.rejection_reason, sr.created_at, u.full_name AS approver_name
       FROM signature_requests sr
       LEFT JOIN users u ON u.id = sr.approver_id
       WHERE sr.doc_id = ?
       ORDER BY sr.id DESC LIMIT 1`,
      [doc.id]
    );

    const [[delivery]] = await pool.query(
      `SELECT dd.rejection_reason, dd.ownership_status, dd.ownership_rejected_at
       FROM document_deliveries dd
       WHERE dd.doc_id = ?
       ORDER BY dd.id DESC LIMIT 1`,
      [doc.id]
    );


    const rejectionReason = (sigReq && sigReq.status === 'rejected' && sigReq.rejection_reason)
      ? sigReq.rejection_reason
      : (delivery && delivery.ownership_status === 'REJECTED' && delivery.rejection_reason)
        ? delivery.rejection_reason
        : docMeta.resubmitNote || '(No reason specified)';

    const approverName = sigReq?.approver_name || 'Approver';

    // If this document previously had customized/corrected template content saved, prefer that;
    // otherwise load the original template's structure (with all placeholders, tables, variables intact)
    const corrected = docMeta.correctedTemplate || {};
    const headerHtml = corrected.header_html !== undefined ? corrected.header_html : template.header_html;
    const bodyHtml = corrected.body_html !== undefined ? corrected.body_html : template.body_html;
    const footerHtml = corrected.footer_html !== undefined ? corrected.footer_html : template.footer_html;

    return res.status(200).json({
      success: true,
      message: 'Rejection context fetched.',
      data: {
        doc: {
          id: doc.id,
          doc_uuid: doc.doc_uuid,
          template_id: doc.template_id,
          record_identifier: doc.record_identifier,
          status: doc.status,
          generated_by: doc.generated_by,
          rejection_reason: rejectionReason,
          approver_name: approverName,
          approver_id: sigReq?.approver_id || null,
          rejected_at: sigReq?.created_at || delivery?.ownership_rejected_at || doc.generated_at,
          metadata: docMeta,
        },
        template: {
          id: template.id,
          name: template.name,
          category: template.category,
          description: template.description,
          version: template.version,
          header_html: headerHtml,
          body_html: bodyHtml,
          footer_html: footerHtml,
          watermark_text: template.watermark_text,
          data_source_table: template.data_source_table,
          data_source_connection_id: template.data_source_connection_id,
          workflow_config: template.workflow_config,
        },
      },
    });
  } catch (err) {
    console.error('[documents] getRejectionContext error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load rejection context.' });
  }
}

/**
 * POST /api/documents/:id/correct-and-resubmit
 * Allows SUPER_ADMIN to save corrected Header, Body, and Footer content specifically
 * for the rejected document, regenerates the PDF, and automatically resubmits it for approval.
 * Does NOT overwrite the master template version unless update_master_template === true.
 */
async function correctAndResubmitDocument(req, res) {
  const { id } = req.params;
  const {
    header_html,
    body_html,
    footer_html,
    record_identifier,
    resubmit_note,
    update_master_template = false,
  } = req.body || {};

  try {
    const [[doc]] = await pool.query('SELECT * FROM generated_docs WHERE id = ?', [id]);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    if (doc.deleted_at) {
      return res.status(410).json({ success: false, message: 'This document has already been deleted.' });
    }

    let docMeta = {};
    try {
      docMeta = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : (doc.metadata || {});
    } catch (e) {}

    if (!isAuthorizedRejectionRecipient(req.user, docMeta, doc.generated_by)) {
      return res.status(403).json({
        success: false,
        message: 'Only the selected rejection recipient can correct and resubmit this document.',
      });
    }

    const template = await loadTemplate(doc.template_id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Associated template not found.' });
    }

    // Find previous signature request to identify the approver
    const [[previousSignatureRequest]] = await pool.query(
      `SELECT id, approver_id, status, rejection_reason
       FROM signature_requests
       WHERE doc_id = ?
       ORDER BY id DESC LIMIT 1`,
      [doc.id]
    );

    if (!previousSignatureRequest || !previousSignatureRequest.approver_id) {
      return res.status(409).json({
        success: false,
        message: 'No previous approver was found for this document to resubmit to.',
      });
    }

    const previousApproverId = previousSignatureRequest.approver_id;
    const recordId = (record_identifier && String(record_identifier).trim()) || doc.record_identifier;
    const note = resubmit_note && String(resubmit_note).trim() ? String(resubmit_note).trim() : null;

    // Build effective template incorporating corrected sections
    const effectiveTemplate = {
      ...template,
      header_html: header_html !== undefined ? header_html : template.header_html,
      body_html: body_html !== undefined ? body_html : template.body_html,
      footer_html: footer_html !== undefined ? footer_html : template.footer_html,
    };

    // If requested by Super Admin, update master template as well
    if (update_master_template && isAdmin) {
      await pool.query(
        `UPDATE templates
         SET header_html = ?, body_html = ?, footer_html = ?, version = version + 1, updated_at = NOW()
         WHERE id = ?`,
        [effectiveTemplate.header_html, effectiveTemplate.body_html, effectiveTemplate.footer_html, template.id]
      );
    }

    // Always preserve the original document creator/owner throughout all workflows
    const originalGeneratorId = docMeta.original_generator_id || doc.generated_by;

    // Generate the corrected document with the effective template preserving original creator
    const newDoc = await generateSingleDocument({
      template: effectiveTemplate,
      recordId,
      userId: originalGeneratorId,
    });

    // Attach correction metadata to the new document
    const [[newDocRow]] = await pool.query('SELECT metadata FROM generated_docs WHERE id = ?', [newDoc.id]);
    const newMetadata = typeof newDocRow?.metadata === 'string'
      ? JSON.parse(newDocRow.metadata)
      : (newDocRow?.metadata || {});

    newMetadata.original_generator_id = originalGeneratorId;
    newMetadata.resubmitNote = note;
    newMetadata.resubmittedFromDocUuid = doc.doc_uuid;
    newMetadata.correctedTemplate = {
      header_html: effectiveTemplate.header_html,
      body_html: effectiveTemplate.body_html,
      footer_html: effectiveTemplate.footer_html,
    };
    newMetadata.correctedBy = {
      id: req.user.id,
      name: req.user.full_name,
      role: req.user.role,
      at: new Date().toISOString(),
    };
    newMetadata.resubmitted_by = {
      id: req.user.id,
      name: req.user.full_name,
      role: req.user.role,
      at: new Date().toISOString(),
    };

    await pool.query('UPDATE generated_docs SET metadata = ? WHERE id = ?', [JSON.stringify(newMetadata), newDoc.id]);

    // Send the new document back into the approval workflow
    const signatureResult = await runInitiateSignature({
      docId: newDoc.id,
      approverId: previousApproverId,
      userId: req.user.id,
      req,
      note,
    });

    if (!signatureResult.ok) {
      return res.status(signatureResult.status || 500).json({
        success: false,
        message: `Corrected document was generated, but approval request could not be created: ${signatureResult.message}`,
        data: { id: newDoc.id, docUuid: newDoc.docUuid },
      });
    }

    // Supersede the old rejected document
    await pool.query('UPDATE generated_docs SET deleted_at = NOW() WHERE id = ?', [doc.id]);

    // Record audit log
    await recordAudit({
      userId: req.user.id,
      docId: newDoc.id,
      action: 'CORRECT_REJECTED_DOCUMENT',
      details: {
        originalDocId: doc.id,
        originalDocUuid: doc.doc_uuid,
        newDocId: newDoc.id,
        newDocUuid: newDoc.docUuid,
        approverId: previousApproverId,
        note,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: `Document ${doc.doc_uuid} corrected and resubmitted as ${newDoc.docUuid} to ${signatureResult.approverName} for approval.`,
      data: {
        id: newDoc.id,
        docId: newDoc.id,
        docUuid: newDoc.docUuid,
        status: 'pending',
        signatureRequestId: signatureResult.signatureRequestId,
        approverId: previousApproverId,
        approverName: signatureResult.approverName,
      },
    });
  } catch (err) {
    console.error('[documents] correctAndResubmitDocument error:', err);
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Failed to correct and resubmit document.',
    });
  }
}

module.exports = {
  previewDocument,
  generateDocument,
  generateBulkDocuments,
  validateBulkGeneration,
  getBulkStatus,
  downloadDocument,
  deleteDocument,
  resubmitDocument,
  listRejectedDocuments,
  getRejectionContext,
  correctAndResubmitDocument,
  viewDocumentByNotifyToken,
  getNotifyTokenMeta,
  notifyViewAutoLogin,
  downloadViaNotifyToken,
  sendSecureLinkViaNotifyToken,
  sendDocumentViaNotifyToken,
  deliverViaNotifyToken,
  regenerateDocument,
};
