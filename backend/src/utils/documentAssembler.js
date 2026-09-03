// Single source of truth for page size/padding — see the file itself for why this
// exists. Both this file and TemplateViewer.jsx (the on-screen "View" preview) read
// from the exact same JSON, so the printed PDF and the preview can never disagree on
// how big the page is or how much margin surrounds it on any of its 4 sides again.
const pageSpec = require('../../../frontend/src/shared/documentPageSpec.json');

/**
 * Wraps rendered header/body/footer into a complete, styled A4 HTML document
 * ready for either on-screen preview or Puppeteer PDF rendering.
 * FR-017: watermark (DRAFT/CONFIDENTIAL/FINAL) rendered as a diagonal overlay.
 *
 * Layout parity with the "View" preview (TemplateViewer.jsx) is deliberate and
 * load-bearing here — anything the preview doesn't do, this must not do either, or
 * "View" and the actual PDF silently diverge:
 *   - page padding: uniform on all 4 sides, taken from pageSpec (previously 20mm
 *     top/bottom vs 18mm left/right here — asymmetric AND a different size than the
 *     preview's own uniform 40px, so the PDF was never actually the same size as
 *     what the admin reviewed on the View page)
 *   - header/body/footer are concatenated exactly like the preview's combinedHtml
 *     (`${headerHtml}${bodyHtml}${automaticDateHtml}${footerHtml}`, see
 *     documentController.js) — no extra margin-bottom on the header, no artificial
 *     min-height forcing the body taller than its actual content, and no forced
 *     font-size/color on the author's own footer text. All three of those existed
 *     here before and pushed/shrunk/recolored content in ways the preview never
 *     showed, so a document that looked right on the View page could still come out
 *     of PDF generation with different spacing or a grayed-out footer.
 *   - the verification stamp (tamperProofFooterHtml/signatureHtml) is generation-only
 *     content the preview never renders at all (see previewDocument in
 *     documentController.js), so ITS small/gray styling now lives in its own
 *     `.doc-footer-meta` wrapper, separate from `.doc-footer` — so it can keep looking
 *     like a stamp without leaking that styling onto the template author's own footer
 *     content, which must render exactly as authored/previewed.
 */
function assembleDocumentHtml({ headerHtml, bodyHtml, footerHtml, tamperProofFooterHtml, deliveryVerificationQrHtml, watermarkText, signatureHtml }) {
  // FR-017 color coding: DRAFT stays red (unapproved/in-progress), FINAL is green
  // (approved/complete) so the two are never visually confusable. Anything else
  // (e.g. a legacy CONFIDENTIAL value already saved on an old template row) falls
  // back to the original neutral red.
  const watermarkClass = watermarkText === 'FINAL'
    ? 'watermark-overlay watermark-final'
    : watermarkText === 'DRAFT'
      ? 'watermark-overlay watermark-draft'
      : 'watermark-overlay';
  const watermarkBlock = watermarkText
    ? `<div class="${watermarkClass}">${escapeHtml(watermarkText)}</div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  /* Uniform on all 4 sides, sourced from pageSpec — kept in sync with the .page rule
     below even though page.pdf() currently passes its own margin:0 and overrides this
     (see pdfGenerator.js), so this stays correct as a fallback for any other renderer
     (e.g. a direct browser "Print" of this HTML) instead of silently going stale. */
  @page { size: A4; margin: ${pageSpec.pagePaddingMm}mm; }
  /*
   * FR-014 Unicode support: the base "Noto Sans" family only covers Latin/Cyrillic/
   * Greek/Vietnamese — it does NOT include Arabic, Ethiopic (Amharic/Ge'ez), or CJK
   * (Chinese/Japanese/Korean) glyphs, despite the name suggesting otherwise. Chromium
   * (which Puppeteer drives) resolves font-family lists per-character: for every glyph
   * it walks the stack left-to-right and uses the first font that actually has that
   * character, falling through to the next entry rather than failing. So listing every
   * script's dedicated Noto family here — instead of relying on one generic name — is
   * what actually makes Arabic/Amharic/Chinese (and Hebrew/Devanagari/Korean/Japanese)
   * text render instead of showing as tofu boxes (□□□) or blank space.
   * This still depends on the fonts being installed on the machine/container running
   * Puppeteer's Chromium — see backend/FONTS.md for the required OS packages; there is
   * no bundled/embedded font file here to fall back on.
   */
  body {
    font-family: 'Noto Sans', 'Noto Sans Arabic', 'Noto Naskh Arabic', 'Noto Sans Ethiopic',
      'Noto Sans Hebrew', 'Noto Sans Devanagari', 'Noto Sans SC', 'Noto Sans TC',
      'Noto Sans JP', 'Noto Sans KR', Arial, sans-serif;
    /* No forced text color here on purpose: the PDF must render placeholders and
       authored content in exactly the color they were given in the template editor
       (RichTextEditor) / preview (TemplateViewer) — same #1a1a2e inherited default,
       and any inline color a field/placeholder itself carries. Never overwrite it
       with a separate "PDF-only" color. */
    color: #1a1a2e;
    position: relative;
    margin: 0;
    /* Lets the browser's bidi algorithm pick text direction per paragraph instead of
       forcing LTR everywhere — needed for Arabic (RTL) content mixed into an otherwise
       LTR (English/Amharic) document to flow and punctuate correctly. */
    unicode-bidi: plaintext;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    /* Uniform on all 4 sides — matches TemplateViewer.jsx's .a4-page padding exactly
       (same pageSpec.json), so the PDF's margins are identical, corner for corner, to
       what was reviewed on the View page. */
    padding: ${pageSpec.pagePaddingMm}mm;
    box-sizing: border-box;
    position: relative;
    background: #fff;
  }
  /* No margin/min-height/font overrides here — the preview concatenates header + body
     + footer flush against each other with no extra spacing or restyling (see
     combinedHtml in documentController.js), so this must not add any either. */
  .doc-header { margin-bottom: 0; }
  .doc-body { min-height: 0; }
  .doc-footer { margin-top: 0; }
  /* Verification stamp only (signature + tamper-proof footer) — this never appears in
     the preview at all, so unlike .doc-footer it's free to have its own distinct,
     deliberately small/gray "stamp" styling without affecting the author's own footer
     content above it. */
  .doc-footer-meta { margin-top: 24px; font-size: 11px; color: #444; }
  /* Two-QR footer row: left QR = verify by Doc ID, right QR = scan for VALID/REVOKED.
     Both sit inside .doc-footer-meta so they share the same border-top stamp styling. */
  .qr-footer-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    border-top: 1px solid #ccc;
    padding-top: 8px;
    font-size: 9px;
    color: #555;
  }
  .qr-footer-left  { display:flex; align-items:center; gap:6px; }
  .qr-footer-right { display:flex; align-items:center; gap:6px; }
  .watermark-overlay {
    position: fixed;
    top: 45%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 72px;
    font-weight: 700;
    color: rgba(220, 38, 38, 0.18);
    letter-spacing: 4px;
    z-index: 0;
    pointer-events: none;
    white-space: nowrap;
  }
  /* FR-017: DRAFT (unapproved) is always red; FINAL (approved) is always green — kept
     visually distinct on purpose so the two are never mistaken for each other. */
  .watermark-overlay.watermark-draft { color: rgba(220, 38, 38, 0.18); }
  .watermark-overlay.watermark-final { color: rgba(22, 163, 74, 0.20); }
  .doc-header, .doc-body, .doc-footer, .doc-footer-meta { position: relative; z-index: 1; }
  /* Font size mapping — matches the editor's FONT_SIZE_OPTIONS exactly, so what admins see while
     authoring in RichTextEditor.jsx is what actually renders in the generated PDF. */
  font[size="1"] { font-size: 10px; }
  font[size="2"] { font-size: 13px; }
  font[size="3"] { font-size: 16px; }
  font[size="4"] { font-size: 18px; }
  font[size="5"] { font-size: 24px; }
  font[size="6"] { font-size: 32px; }
  font[size="7"] { font-size: 48px; }
  /* Conditional/loop block markers are authoring-time visual aids only — never shown in the final PDF. */
  .rte-block-marker { display: none; }
</style>
</head>
<body>
  <div class="page">
    ${watermarkBlock}
    <div class="doc-header">${headerHtml || ''}</div>
    <div class="doc-body">${bodyHtml || ''}</div>
    <div class="doc-footer">${footerHtml || ''}</div>
    <div class="doc-footer-meta">
      ${signatureHtml || ''}
      <div class="qr-footer-row">
        <div class="qr-footer-left">${tamperProofFooterHtml || ''}</div>
        <div class="qr-footer-right">${deliveryVerificationQrHtml || ''}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * FR-017: watermark is status-driven, not just a static template field.
 * Unapproved (draft/pending/rejected) docs always show DRAFT, regardless of what
 * the template's default watermark says. Once signed/delivered, the template's
 * chosen watermark (CONFIDENTIAL or FINAL) applies — defaulting to FINAL if unset.
 *
 * Defensive normalization: templateController now rejects "DRAFT" as a saved
 * template watermark outright (see normalizeWatermarkText), but a template row
 * saved before that validation existed could still have "DRAFT" sitting in the
 * database. Treat that the same as unset here too, so an old row can never make a
 * signed/delivered document show "DRAFT" forever — it falls back to FINAL like any
 * other unset watermark instead.
 */
function resolveWatermarkForStatus(docStatus, templateWatermarkText) {
  const cleanTemplateWatermark =
    templateWatermarkText && String(templateWatermarkText).trim().toUpperCase() !== 'DRAFT'
      ? templateWatermarkText
      : null;

  if (docStatus === 'draft' || docStatus === 'pending' || docStatus === 'rejected') {
    return 'DRAFT';
  }
  if (docStatus === 'signed' || docStatus === 'delivered') {
    return cleanTemplateWatermark || 'FINAL';
  }
  return cleanTemplateWatermark || null;
}

/**
 * injectSignatureIntoFooter
 *
 * Replaces the `<!-- [[SIGNATURE_FIELD]] --> … <!-- [[/SIGNATURE_FIELD]] -->`
 * block that the Admin embedded in footer_html at template-creation time with
 * the actual signed HTML: the user's typed name, their signature image (base64
 * data URL), and the submission date.
 *
 * This runs on the *stored* `renderPieces.footerHtml` — i.e. the footer HTML
 * after template placeholders have already been substituted for the recipient's
 * data record — so we are only touching the signature placeholder, nothing else.
 *
 * The replacement block is intentionally self-contained inline HTML: no external
 * resources, no classes that depend on the app's CSS, so it renders identically
 * when Puppeteer generates the PDF on any machine.
 *
 * @param {string}      footerHtml  The rendered footer HTML containing the placeholder.
 * @param {string|null} name        User's typed full name (null if not provided).
 * @param {string|null} photoDataUrl Base64 data URL of the signature image (null if none).
 * @param {string}      signedAt    ISO timestamp of when the user signed.
 * @returns {string}  Footer HTML with the placeholder replaced by the filled-in signature.
 *                    If no placeholder is found, returns footerHtml unchanged.
 */
function injectSignatureIntoFooter(footerHtml, name, photoDataUrl, signedAt) {
  if (!footerHtml) return footerHtml || '';

  // The placeholder block is delimited by these exact HTML comments, which are
  // part of the block injected by TemplateForm's handleAddSignatureField().
  const START_MARKER = '<!-- [[SIGNATURE_FIELD]] -->';
  const END_MARKER   = '<!-- [[/SIGNATURE_FIELD]] -->';

  const startIdx = footerHtml.indexOf(START_MARKER);
  const endIdx   = footerHtml.indexOf(END_MARKER);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No placeholder found — footer is already signed or template did not use
    // the footer-field approach. Return unchanged.
    return footerHtml;
  }

  // Format the date in a human-readable way for the PDF
  const dateStr = signedAt
    ? new Date(signedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Build the signature image cell — only included when a photo/drawing was provided
  const sigImgHtml = photoDataUrl
    ? `<img src="${photoDataUrl}" alt="Signature"
            style="display:block;max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<span style="font-size:0.72rem;color:#94A3B8;font-style:italic;">No image provided</span>`;

  // The filled-in block that replaces everything from START_MARKER to END_MARKER
  // (inclusive of both markers and the wrapper div that encloses them).
  // The outer `<div data-sig-field="1">` that wraps the block in the editor is
  // preserved visually but replaced with a clean, locked version here.
  const signedBlock = `<!-- [[SIGNATURE_FIELD]] -->
<table style="width:100%;border-collapse:collapse;font-family:inherit;font-size:12px;color:#1a1a2e;margin-top:4px;">
  <tbody>
    <tr>
      <td style="width:38%;padding:4px 8px 4px 0;vertical-align:bottom;">
        <div style="padding-bottom:3px;min-width:80px;font-family:Georgia,serif;font-size:13px;color:#0F2747;border-bottom:1.5px solid #0F2747;">
          ${name ? escapeHtml(name) : ''}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;">Name</div>
      </td>
      <td style="width:62%;padding:4px 0 4px 8px;vertical-align:bottom;">
        <div style="border:1.5px solid #0F2747;border-radius:4px;min-height:48px;padding:4px 6px;background:#fff;display:flex;align-items:center;justify-content:center;">
          ${sigImgHtml}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;">Signature</div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding:8px 0 0;vertical-align:bottom;">
        <div style="padding-bottom:3px;border-bottom:1.5px solid #94A3B8;font-size:12px;color:#0F2747;">
          ${dateStr}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#94A3B8;letter-spacing:0.04em;text-transform:uppercase;">Date</div>
      </td>
    </tr>
  </tbody>
</table>
<!-- [[/SIGNATURE_FIELD]] -->`;

  // Find the outer wrapper `<div ... data-sig-field="1">` that encloses both markers.
  // We want to replace from the opening of that div to its closing `</div>`.
  // Strategy: walk backwards from startIdx to find the last `<div` before it,
  // then forward from endIdx to find the matching `</div>` after END_MARKER.
  let outerStart = footerHtml.lastIndexOf('<div', startIdx);
  let outerEnd   = footerHtml.indexOf('</div>', endIdx + END_MARKER.length);

  if (outerStart === -1 || outerEnd === -1) {
    // Fallback: just replace between the markers without touching the wrapper
    const before = footerHtml.slice(0, startIdx);
    const after  = footerHtml.slice(endIdx + END_MARKER.length);
    return before + signedBlock + after;
  }

  const before = footerHtml.slice(0, outerStart);
  const after  = footerHtml.slice(outerEnd + '</div>'.length);
  return before + signedBlock + after;
}

module.exports = { assembleDocumentHtml, resolveWatermarkForStatus, injectSignatureIntoFooter };
