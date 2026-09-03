const crypto = require('crypto');
const QRCode = require('qrcode');

/** SHA-256 hex digest of a file buffer — used for tamper-proofing (FR-016, NFR-003). */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** FR-015: DOC-YYYYMMDD-XXXXX */
function generateDocId() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return `DOC-${datePart}-${randomPart}`;
}

/**
 * FR-016: builds the tamper-proof footer HTML containing TWO QR codes side by side.
 *
 * LEFT QR  — encodes the /verify?id=<docId> URL so anyone with a browser can paste
 *             the Doc ID and confirm the document is authentic and untampered.
 *
 * RIGHT QR — encodes the /verify-qr/<verificationId> URL (opaque, never the doc_uuid)
 *             so scanning it directly reports VALID / REVOKED / INVALID without needing
 *             to type anything.
 *
 * Both QRs are generated at PDF-creation time and baked in as inline base64 data URLs
 * so they survive the document being moved or the backend being offline later.
 */
async function buildTamperProofFooterHtml(docId, verifyBaseUrl) {
  const docVerifyUrl = `${verifyBaseUrl}/verify?id=${encodeURIComponent(docId)}`;
  const qrDocId = await QRCode.toDataURL(docVerifyUrl, { margin: 1, width: 120 });

  return `
    <div class="tamper-proof-footer" style="
      display:flex; align-items:flex-start; justify-content:space-between;
      gap:8px; font-size:9px; color:#555;
      margin-top:12px; border-top:1px solid #ccc; padding-top:8px;">
      <!-- LEFT: verify by Doc ID -->
      <div style="display:flex;align-items:center;gap:6px;flex:1;">
        <img src="${qrDocId}" alt="Verify by Doc ID QR" style="width:52px;height:52px;flex-shrink:0;" />
        <div>
          <div style="font-weight:600;margin-bottom:2px;">Verify Authenticity</div>
          <div>Scan or visit: <b>${verifyBaseUrl}/verify</b></div>
          <div>Document ID: <b>${docId}</b></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Secure Document Delivery module: the RIGHT-side QR code embedded in every generated
 * PDF. Encodes ONLY the opaque `verification_id` — never the doc_uuid, never the file
 * hash. Scanning it opens the public /verify-qr/:id page which reports exactly one of
 * VALID / REVOKED / INVALID.
 */
async function buildDeliveryVerificationQrHtml(verificationId, verifyBaseUrl) {
  const verifyUrl = `${verifyBaseUrl}/verify-qr/${encodeURIComponent(verificationId)}`;
  const qrScan = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 120 });

  return `
    <div class="delivery-verification-footer" style="
      display:flex; align-items:flex-start; justify-content:flex-end;
      font-size:9px; color:#555; margin-top:4px;">
      <!-- RIGHT: scan to get VALID / REVOKED / INVALID instantly -->
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="text-align:right;">
          <div style="font-weight:600;margin-bottom:2px;">Delivery Status</div>
          <div>Scan to verify: <b>VALID / REVOKED / INVALID</b></div>
        </div>
        <img src="${qrScan}" alt="Delivery Status QR" style="width:52px;height:52px;flex-shrink:0;" />
      </div>
    </div>
  `;
}

module.exports = { sha256, generateDocId, buildTamperProofFooterHtml, buildDeliveryVerificationQrHtml };
