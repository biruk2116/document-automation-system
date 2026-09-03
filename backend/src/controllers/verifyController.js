const { pool } = require('../config/db');
const { sha256 } = require('../utils/documentIntegrity');
const { recordAudit } = require('../utils/auditLog');

/**
 * POST /api/verify   PUBLIC, no auth.
 * Two modes:
 *  - body: { doc_id }         -> looks up the stored hash directly (FR-033 "pastes a Doc ID")
 *  - multipart file "pdf"     -> hashes the uploaded bytes and compares against the stored hash
 *                                 for the doc_id embedded in the PDF's tamper-proof footer text (FR-034)
 * FR-035: verification works even if the original stored file was deleted, since we only
 * compare against the DB-persisted hash, never require the original file to exist on disk.
 */
async function verifyDocument(req, res) {
  const { doc_id } = req.body;
  const uploadedFile = req.file; // set by multer when a PDF is uploaded

  if (!doc_id && !uploadedFile) {
    return res.status(400).json({ success: false, message: 'Provide either a doc_id or upload a PDF file.' });
  }

  try {
    let targetDocId = doc_id;
    let uploadedHash = null;

    if (uploadedFile) {
      uploadedHash = sha256(uploadedFile.buffer);

      if (!targetDocId) {
        // Try to extract the Doc ID from the PDF's embedded text footer (FR-034: "...with ID: XXXXX").
        try {
          // Lazy-require: pdf-parse pulls in a decent-sized dependency tree we only need here.
          // eslint-disable-next-line global-require
          const pdfParse = require('pdf-parse');
          const parsed = await pdfParse(uploadedFile.buffer);
          const match = parsed.text.match(/ID:\s*(DOC-\d{8}-[A-Z0-9]{5})/i);
          if (match) targetDocId = match[1].toUpperCase();
        } catch (parseErr) {
          console.warn('[verify] pdf-parse failed, falling back to hash-only lookup:', parseErr.message);
        }
      }
    }

    let dbRow = null;
    if (targetDocId) {
      const [[row]] = await pool.query('SELECT id, doc_uuid, file_hash, status, generated_at FROM generated_docs WHERE doc_uuid = ?', [targetDocId]);
      dbRow = row || null;
    } else if (uploadedHash) {
      // No doc ID found in the PDF text — fall back to a direct hash match across all docs.
      const [[row]] = await pool.query('SELECT id, doc_uuid, file_hash, status, generated_at FROM generated_docs WHERE file_hash = ?', [uploadedHash]);
      dbRow = row || null;
    }

    if (!dbRow) {
      return res.status(404).json({
        success: true,
        message: 'No matching document found in our records.',
        data: { verified: false, reason: 'not_found' },
      });
    }

    const hashToCompare = uploadedHash || dbRow.file_hash;
    const isAuthentic = hashToCompare === dbRow.file_hash;

    await recordAudit({ docId: dbRow.id, action: 'VERIFY', details: { result: isAuthentic ? 'authentic' : 'corrupt' }, req });

    return res.status(200).json({
      success: true,
      message: isAuthentic ? 'Document is Authentic & Untampered.' : 'Document is Corrupt/Forged — hash mismatch.',
      data: {
        verified: isAuthentic,
        docId: dbRow.doc_uuid,
        status: dbRow.status,
        originalSignedAt: dbRow.generated_at,
      },
    });
  } catch (err) {
    console.error('[verify] error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed due to a server error.' });
  }
}

module.exports = { verifyDocument };
