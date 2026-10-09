// Single source of truth for page size/padding — see the file itself for why this
// exists. Both this file and TemplateViewer.jsx (the on-screen "View" preview) read
// from the exact same JSON, so the printed PDF and the preview can never disagree on
// how big the page is or how much margin surrounds it on any of its 4 sides again.
const pageSpec = require('../../../frontend/src/shared/documentPageSpec.json');
const path = require('path');
const fs = require('fs');
const { formatGregorianDate, formatEthiopianDate } = require('./ethiopianCalendar');

/**
 * Inlines /uploads/logos/... and /uploads/avatars/... images as base64 data URLs
 * so Puppeteer renders them reliably without requiring network or origin resolution.
 */
function inlineStorageImages(html) {
  if (!html || typeof html !== 'string') return html || '';
  return html.replace(/<img([^>]+)src=["'](\/uploads\/(logos|avatars)\/([^"']+))["']/gi, (match, pre, relPath, folder, filename) => {
    const diskPath = path.join(__dirname, '..', '..', 'storage', folder, filename);
    if (fs.existsSync(diskPath)) {
      try {
        const ext = path.extname(filename).toLowerCase().replace('.', '') || 'png';
        const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        const b64 = fs.readFileSync(diskPath).toString('base64');
        return `<img${pre}src="data:${mime};base64,${b64}"`;
      } catch (err) {
        console.warn('[documentAssembler] Could not inline image:', diskPath, err.message);
      }
    }
    return match;
  });
}

/**
 * Automatically ensures block-level text containers have dir="auto" if not explicitly specified.
 * This activates the browser's native Unicode Bidirectional Algorithm (UBA) on paragraphs,
 * headings, list items, and table cells, correctly handling Arabic (RTL) vs Amharic/Chinese/Latin (LTR).
 */
function ensureAutoBidi(html) {
  if (!html || typeof html !== 'string') return html || '';
  return html.replace(/<(p|h[1-6]|li|blockquote|td|th)(?![^>]*\bdir=)([^>]*)>/gi, '<$1 dir="auto"$2>');
}

const MULTILINGUAL_FONT_FALLBACKS = ", 'Noto Sans Ethiopic', 'Nyala', 'Ebrima', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans TC', 'Microsoft YaHei', Arial, sans-serif";

/**
 * Ensures any inline font-family or legacy <font face="..."> has full Amharic,
 * Arabic, and Chinese fallback support so non-Latin scripts never render as missing glyphs.
 */
function augmentInlineFonts(html) {
  if (!html || typeof html !== 'string') return html || '';
  return html
    // 1. Safely augment font-family inside style="..." attributes without touching style= or any other CSS properties
    .replace(/\bstyle=(["'])([\s\S]*?)\1/gi, (match, quote, styleContent) => {
      if (!styleContent.includes('font-family')) return match;
      const updatedStyle = styleContent.replace(/font-family\s*:\s*([^;]+)(;?)/gi, (m, familyVal, semi) => {
        if (familyVal.includes('Noto Sans Ethiopic') || familyVal.includes('Nyala')) return m;
        return `font-family: ${familyVal.trim()}${MULTILINGUAL_FONT_FALLBACKS}${semi || ';'}`;
      });
      return `style=${quote}${updatedStyle}${quote}`;
    })
    // 2. Handle legacy <font face="...">
    .replace(/<font([^>]+)face=(["'])([^"']+)\2([^>]*)>/gi, (match, pre, q, face, post) => {
      if (face.includes('Noto Sans Ethiopic') || face.includes('Nyala')) return match;
      return `<font${pre}face=${q}${face}${MULTILINGUAL_FONT_FALLBACKS}${q} style="font-family:${face}${MULTILINGUAL_FONT_FALLBACKS};"${post}>`;
    });
}

/**
 * Wraps rendered header/body/footer into a complete, styled A4 HTML document
 * ready for either on-screen preview or Puppeteer PDF rendering.
 * FR-017: watermark (DRAFT/CONFIDENTIAL/FINAL) rendered as a diagonal overlay.
 * FR-014: Full multilingual support for Amharic, Arabic, Chinese, and Latin scripts.
 */
function assembleDocumentHtml({
  headerHtml,
  bodyHtml,
  footerHtml,
  tamperProofFooterHtml,
  deliveryVerificationQrHtml,
  watermarkText,
  signatureHtml,
  generatedDateHtml,
  generationDateGc,
  generationDateEc,
}) {
  // Strip editor-only elements (remove buttons, etc.) before assembling the final PDF,
  // inline storage images as base64 data URLs, and ensure auto-bidi on block tags.
  let cleanBodyRaw = stripEditorOnlyElements(bodyHtml || '');

  // Extract and remove any embedded date block from bodyHtml (handles legacy templates/concatenations)
  let extractedDateHtml = '';
  const dateDivRegex = /<div\s+class=["'](?:document-dates|doc-generated-date)["'][^>]*>([\s\S]*?)<\/div>/gi;
  const dateMatch = dateDivRegex.exec(cleanBodyRaw);
  if (dateMatch) {
    extractedDateHtml = dateMatch[0];
    cleanBodyRaw = cleanBodyRaw.replace(dateDivRegex, '');
  }

  // Determine final Generated Date string
  let finalGeneratedDateHtml = '';
  if (generatedDateHtml && typeof generatedDateHtml === 'string' && generatedDateHtml.trim()) {
    finalGeneratedDateHtml = generatedDateHtml.trim();
  } else if (extractedDateHtml) {
    finalGeneratedDateHtml = extractedDateHtml.trim();
  } else {
    const gc = generationDateGc || formatGregorianDate(new Date());
    const ec = generationDateEc || formatEthiopianDate(new Date());
    finalGeneratedDateHtml = `<div class="doc-generated-date"><em><strong>Generated Date:</strong> ${escapeHtml(gc)} &nbsp;/&nbsp; ${escapeHtml(ec)}</em></div>`;
  }

  // Normalize finalGeneratedDateHtml: wrap in .doc-generated-date and <em> if missing
  if (!finalGeneratedDateHtml.includes('doc-generated-date')) {
    finalGeneratedDateHtml = `<div class="doc-generated-date"><em>${finalGeneratedDateHtml}</em></div>`;
  } else if (!finalGeneratedDateHtml.includes('<em>')) {
    finalGeneratedDateHtml = finalGeneratedDateHtml.replace(/<div\s+class=["']doc-generated-date["'][^>]*>([\s\S]*?)<\/div>/i, '<div class="doc-generated-date"><em>$1</em></div>');
  }

  const cleanHeaderHtml = ensureAutoBidi(augmentInlineFonts(inlineStorageImages(stripEditorOnlyElements(headerHtml || ''))));
  const cleanBodyHtml = ensureAutoBidi(augmentInlineFonts(inlineStorageImages(cleanBodyRaw)));
  const cleanFooterHtml = ensureAutoBidi(augmentInlineFonts(inlineStorageImages(stripEditorOnlyElements(footerHtml || ''))));
  
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
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- High-fidelity Google Fonts CDN for Amharic (Ethiopic), Arabic, and Chinese (Simplified & Traditional) -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&family=Noto+Sans+Ethiopic:wght@400;500;600;700&family=Noto+Serif+Ethiopic:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Amiri:wght@400;700&display=block" rel="stylesheet" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&family=Noto+Sans+Ethiopic:wght@400;500;600;700&family=Noto+Serif+Ethiopic:wght@400;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Amiri:wght@400;700&display=block');

  /* Standard Microsoft Word-style A4 paper margins on all four sides */
  @page {
    size: A4;
    margin: ${pageSpec.pagePaddingMm || 20}mm;
  }

  *, *:before, *:after {
    box-sizing: border-box;
  }

  html {
    font-size: 11pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /*
   * Multilingual typography support:
   * 1. Google Web Fonts: Noto Sans Ethiopic, Noto Sans Arabic, Noto Sans SC/TC, Amiri.
   * 2. Windows native fallbacks: Nyala & Ebrima (Amharic), Segoe UI & Tahoma (Arabic),
   *    Microsoft YaHei (微软雅黑) & SimSun (宋体) & SimHei (黑体) (Chinese).
   * 3. macOS native fallbacks: Kefa (Amharic), Geeza Pro & Damascus (Arabic),
   *    PingFang SC & Hiragino Sans GB (Chinese).
   * 4. Linux native fallbacks: Noto Sans Ethiopic, Abyssinica SIL, Noto Sans Arabic,
   *    WenQuanYi Zen Hei & WenQuanYi Micro Hei.
   */
  body, p, div, span, font, td, th, h1, h2, h3, h4, h5, h6, li, blockquote, strong, em, b, i, a, label {
    font-family: 'Noto Sans',
      /* Amharic / Ethiopic fonts */
      'Noto Sans Ethiopic', 'Nyala', 'Ebrima', 'Abyssinica SIL', 'Kefa',
      /* Arabic fonts */
      'Noto Sans Arabic', 'Noto Naskh Arabic', 'Segoe UI', 'Tahoma', 'Traditional Arabic', 'Arabic Typesetting', 'Geeza Pro', 'Damascus',
      /* Chinese (Simplified & Traditional) fonts */
      'Noto Sans SC', 'Noto Sans TC', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', 'Hiragino Sans GB', 'SimSun', '宋体', 'SimHei', '黑体', 'WenQuanYi Zen Hei', 'WenQuanYi Micro Hei',
      /* Additional scripts */
      'Noto Sans Hebrew', 'Noto Sans Devanagari', 'Noto Sans JP', 'Noto Sans KR',
      Calibri, Arial, Helvetica, sans-serif;
  }

  /* Strict bold and unbold overrides so heading/text boldness is 1:1 identical to editor intent */
  b, strong,
  [style*="font-weight: bold"],
  [style*="font-weight:bold"],
  [style*="font-weight: 600"],
  [style*="font-weight:600"],
  [style*="font-weight: 700"],
  [style*="font-weight:700"],
  [style*="font-weight: 800"],
  [style*="font-weight:800"],
  [style*="font-weight: 900"],
  [style*="font-weight:900"],
  [style*="font-weight: bolder"],
  [style*="font-weight:bolder"] {
    font-weight: 700 !important;
  }

  [style*="font-weight: normal"],
  [style*="font-weight:normal"],
  [style*="font-weight: 400"],
  [style*="font-weight:400"],
  .font-normal {
    font-weight: 400 !important;
  }

  body {
    margin: 0;
    padding: 0;
    width: 100%;
    box-sizing: border-box;
    font-size: 11pt;
    line-height: 1.5;
    color: #1a1a2e;
    background: #ffffff;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    unicode-bidi: plaintext;
  }

  /* BiDi & RTL Support: Auto text direction and alignment */
  p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, div {
    unicode-bidi: plaintext;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  [dir="auto"] {
    text-align: start;
  }
  [dir="rtl"], :dir(rtl), .rtl-block {
    direction: rtl;
    text-align: right;
  }

  /* Formal Word-style printable page container: fills printable area naturally without artificial clipping */
  .doc-container {
    width: 100%;
    max-width: 100%;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    position: relative;
    background: #ffffff;
  }

  /* Typography: Microsoft Word Standards */
  h1 {
    font-size: 18pt;
    font-weight: 700;
    line-height: 1.25;
    margin: 14pt 0 6pt 0;
    color: #0f172a;
    page-break-after: avoid;
    break-after: avoid;
  }
  h2 {
    font-size: 14pt;
    font-weight: 700;
    line-height: 1.3;
    margin: 12pt 0 5pt 0;
    color: #1e293b;
    page-break-after: avoid;
    break-after: avoid;
  }
  h3 {
    font-size: 12pt;
    font-weight: 600;
    line-height: 1.35;
    margin: 10pt 0 4pt 0;
    color: #334155;
    page-break-after: avoid;
    break-after: avoid;
  }
  h4, h5, h6 {
    font-size: 11pt;
    font-weight: 600;
    margin: 8pt 0 4pt 0;
    page-break-after: avoid;
    break-after: avoid;
  }

  p {
    margin: 0 0 8pt 0;
    line-height: 1.5;
    orphans: 2;
    widows: 2;
  }

  ul, ol {
    margin: 0 0 8pt 0;
    padding-left: 24pt;
  }
  li {
    margin-bottom: 3pt;
    line-height: 1.5;
  }

  blockquote {
    margin: 8pt 0;
    padding: 4pt 14pt;
    border-left: 3pt solid #2563eb;
    color: #475569;
    background: #f8fafc;
  }

  hr {
    border: none;
    border-top: 1px solid #cbd5e1;
    margin: 12pt 0;
  }

  /* Tables: Formal Word document layout with clean borders */
  table:not(.signature-table) {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    margin: 10pt 0;
    table-layout: auto;
    page-break-inside: auto;
    break-inside: auto;
  }
  table:not(.signature-table) tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  table:not(.signature-table) th,
  table:not(.signature-table) td {
    border: 1px solid #cbd5e1;
    padding: 6pt 8pt;
    word-break: break-word;
    vertical-align: top;
  }
  table:not(.signature-table) th {
    background-color: #f8fafc;
    font-weight: 600;
    text-align: start;
    color: #0f172a;
  }

  /* Images: Constrained to printable area */
  img {
    max-width: 100%;
    height: auto;
    page-break-inside: avoid;
  }

  /* Page Break utilities */
  .page-break,
  [style*="page-break-after: always"],
  [style*="break-after: page"] {
    page-break-after: always !important;
    break-after: page !important;
    height: 0 !important;
    margin: 0 !important;
    border: none !important;
  }

  /* Header, Body, Footer Sections */
  .doc-header {
    margin-bottom: 12pt;
    position: relative;
    z-index: 1;
  }
  .doc-body {
    min-height: 0;
    position: relative;
    z-index: 1;
  }
  .doc-footer {
    margin-top: 14pt;
    position: relative;
    z-index: 1;
  }
  /* Footer Metadata Section: strictly on final page only, avoids page break */
  .doc-footer-meta {
    margin-top: 14pt;
    font-size: 8.5pt;
    color: #475569;
    position: relative;
    z-index: 1;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  /* Generated Date: directly above QR code on final page with small professional spacing */
  .doc-generated-date {
    font-size: 8.5pt;
    font-style: italic !important;
    color: #475569;
    margin: 8pt 0 4pt 0;
    line-height: 1.4;
    text-align: left;
    direction: ltr !important;
  }
  .doc-generated-date em,
  .doc-generated-date strong,
  .doc-generated-date p,
  .doc-generated-date span {
    font-style: italic !important;
  }
  .qr-footer-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-top: 6pt;
    border-top: 1px solid #e2e8f0;
    padding-top: 6pt;
    font-size: 8pt;
    color: #64748b;
    direction: ltr !important;
  }
  .qr-footer-left  { display: flex; align-items: center; gap: 6px; direction: ltr !important; }
  .qr-footer-right { display: flex; align-items: center; gap: 6px; direction: ltr !important; }

  /* Watermark Overlay */
  .watermark-overlay {
    position: fixed;
    top: 45%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 72px;
    font-weight: 700;
    letter-spacing: 4px;
    z-index: 0;
    pointer-events: none;
    white-space: nowrap;
  }
  .watermark-overlay.watermark-draft { color: rgba(220, 38, 38, 0.16); }
  .watermark-overlay.watermark-final { color: rgba(22, 163, 74, 0.18); }

  /* Font size mappings matching editor toolbar */
  font[size="1"] { font-size: 8pt; }
  font[size="2"] { font-size: 10pt; }
  font[size="3"] { font-size: 11pt; }
  font[size="4"] { font-size: 14pt; }
  font[size="5"] { font-size: 18pt; }
  font[size="6"] { font-size: 24pt; }
  font[size="7"] { font-size: 36pt; }

  /* Signatures */
  .signature-block, .signature-container, .visual-signature, [data-sig-field-id],
  table.signature-table, table.signature-table tr, table.signature-table td {
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  .visual-signature {
    font-style: italic !important;
    font-size: 10pt !important;
    color: #334155 !important;
    margin: 6pt 0 !important;
    line-height: 1.4 !important;
  }

  .rte-block-marker { display: none; }
</style>
</head>
<body>
  <div class="doc-container">
    ${watermarkBlock}
    <div class="doc-header" dir="auto">${cleanHeaderHtml}</div>
    <div class="doc-body" dir="auto">${cleanBodyHtml}</div>
    <div class="doc-footer" dir="auto">${cleanFooterHtml}</div>
    <div class="doc-footer-meta">
      ${signatureHtml || ''}
      ${finalGeneratedDateHtml}
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
 * Strips editor-only elements from HTML before PDF generation.
 * Removes:
 * - ALL <button> elements (signature field remove buttons)
 * - data-editor-only attributes
 * - contenteditable attributes from divs
 * 
 * This ensures the × remove buttons are ONLY visible during template
 * creation/editing in the admin UI, never in generated PDFs or user views.
 * 
 * @param {string} html  The HTML content
 * @returns {string}  Cleaned HTML
 */
function stripEditorOnlyElements(html) {
  if (!html) return html || '';
  
  let cleaned = html;
  
  // Remove ALL <button> tags and their content (multi-line safe)
  cleaned = cleaned.replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');
  
  // Remove contenteditable="false" attribute
  cleaned = cleaned.replace(/\s*contenteditable="false"/gi, '');
  
  // Remove data-editor-only attribute
  cleaned = cleaned.replace(/\s*data-editor-only="true"/gi, '');
  
  // Remove data-sig-field-id attribute (editor tracking only)
  cleaned = cleaned.replace(/\s*data-sig-field-id="[^"]*"/gi, '');
  
  return cleaned;
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
/**
 * Generates an SVG data URL containing an elegant cursive signature of the given name.
 * Renders crisply in Puppeteer/Chromium without external web font dependencies.
 */
function generateSignatureSvg(name) {
  const cleanName = (name || 'Approved').trim();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="52" viewBox="0 0 220 52">
  <text x="50%" y="36" text-anchor="middle" font-family="'Brush Script MT', 'Dancing Script', 'Segoe Script', 'Great Vibes', cursive, sans-serif" font-size="26" font-style="italic" font-weight="600" fill="#0F2747">${escapeHtml(cleanName)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Injects a signed block (name, signature image/SVG, date) into any HTML string
 * containing signature field placeholders (<!-- [[SIGNATURE_FIELD ... or [ SIGNATURE FIELD ]).
 */
function injectSignatureIntoHtml(html, name, photoDataUrl, signedAt, fallbackAppend = false) {
  if (!html || typeof html !== 'string') return { html: html || '', replaced: false };

  // If already contains embedded signature block, do not embed again — strip any stray raw placeholders
  if (html.includes('<!-- SIGNATURE_EMBEDDED -->') || html.includes('class="signature-block"')) {
    let cleaned = html
      .replace(/<!-- \[\[SIGNATURE_FIELD[\s\S]*?<!-- \[\[\/SIGNATURE_FIELD[^\]]*\]\] -->/gi, '')
      .replace(/\[\s*SIGNATURE FIELD\s*\]/gi, '');
    return { html: cleaned, replaced: true };
  }

  let updated = html;
  let replaced = false;

  const dateStr = signedAt
    ? new Date(signedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const effectivePhotoUrl = photoDataUrl || (name ? generateSignatureSvg(name) : null);
  const sigImgHtml = effectivePhotoUrl
    ? `<img src="${effectivePhotoUrl}" alt="Signature"
            style="display:block;max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="font-family:'Edu QLD Beginner','Edu AU VIC WA NT Hand','Brush Script MT','Dancing Script','Segoe Script',cursive;font-size:22px;color:#0F2747;font-style:italic;text-align:center;">${name ? escapeHtml(name) : 'Digitally Approved'}</div>`;

  const signedBlock = `<!-- SIGNATURE_EMBEDDED -->
<div class="signature-block" style="page-break-inside:avoid !important;break-inside:avoid !important;margin-top:12px;display:block;">
<table class="signature-table" style="width:100%;border-collapse:collapse;font-family:inherit;font-size:12px;color:#1a1a2e;page-break-inside:avoid !important;break-inside:avoid !important;">
  <tbody>
    <tr style="page-break-inside:avoid !important;break-inside:avoid !important;">
      <td style="width:38%;padding:4px 8px 4px 0;vertical-align:bottom;page-break-inside:avoid !important;break-inside:avoid !important;">
        <div style="padding-bottom:3px;min-width:80px;font-family:inherit;font-size:14px;font-weight:600;color:#0F2747;border-bottom:2px solid #0F2747;">
          ${name ? escapeHtml(name) : '&nbsp;'}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#64748B;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Name</div>
      </td>
      <td style="width:62%;padding:4px 0 4px 8px;vertical-align:bottom;page-break-inside:avoid !important;break-inside:avoid !important;">
        <div style="border:2px solid #0F2747;border-radius:4px;min-height:52px;padding:6px 8px;background:#fff;display:flex;align-items:center;justify-content:center;">
          ${sigImgHtml}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#64748B;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Signature</div>
      </td>
    </tr>
    <tr style="page-break-inside:avoid !important;break-inside:avoid !important;">
      <td colspan="2" style="padding:8px 0 0;vertical-align:bottom;page-break-inside:avoid !important;break-inside:avoid !important;">
        <div style="padding-bottom:3px;border-bottom:2px solid #64748B;font-size:13px;font-weight:600;color:#0F2747;">
          ${dateStr}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#64748B;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Date</div>
      </td>
    </tr>
  </tbody>
</table>
</div>
<!-- /SIGNATURE_EMBEDDED -->`;

  // 1. Replace comment-delimited signature field placeholders: <!-- [[SIGNATURE_FIELD ...
  // Replaces the first placeholder with signedBlock, and removes any subsequent duplicates so it is NEVER repeated.
  while (true) {
    let startIdx = updated.indexOf('<!-- [[SIGNATURE_FIELD:');
    let isNewFormat = true;
    if (startIdx === -1) {
      startIdx = updated.indexOf('<!-- [[SIGNATURE_FIELD]] -->');
      isNewFormat = false;
    }
    if (startIdx === -1) break;

    let endMarker, endIdx;
    if (isNewFormat) {
      const fieldIdMatch = updated.substring(startIdx).match(/<!-- \[\[SIGNATURE_FIELD:([^\]]+)\]\] -->/);
      if (!fieldIdMatch) break;
      const fieldId = fieldIdMatch[1];
      endMarker = `<!-- [[/SIGNATURE_FIELD:${fieldId}]] -->`;
      endIdx = updated.indexOf(endMarker, startIdx);
    } else {
      endMarker = '<!-- [[/SIGNATURE_FIELD]] -->';
      endIdx = updated.indexOf(endMarker, startIdx);
    }
    if (endIdx === -1) break;

    let outerStart = updated.lastIndexOf('<div', startIdx);
    if (outerStart !== -1 && updated.slice(outerStart, startIdx).includes('</div>')) {
      outerStart = -1;
    }
    let outerEnd = updated.indexOf('</div>', endIdx + endMarker.length);
    if (outerEnd !== -1 && updated.slice(endIdx + endMarker.length, outerEnd).includes('<div')) {
      outerEnd = -1;
    }

    const blockToInsert = replaced ? '' : signedBlock;

    if (outerStart === -1 || outerEnd === -1) {
      const before = updated.slice(0, startIdx);
      const after = updated.slice(endIdx + endMarker.length);
      updated = before + blockToInsert + after;
    } else {
      const before = updated.slice(0, outerStart);
      const after = updated.slice(outerEnd + '</div>'.length);
      updated = before + blockToInsert + after;
    }
    replaced = true;
  }

  // 2. Also handle if the HTML table contains [ SIGNATURE FIELD ] without HTML comments
  while (updated.includes('[ SIGNATURE FIELD ]') || updated.includes('[SIGNATURE FIELD]')) {
    const sigIdx = Math.max(updated.indexOf('[ SIGNATURE FIELD ]'), updated.indexOf('[SIGNATURE FIELD]'));
    if (sigIdx === -1) break;
    const tableStart = updated.lastIndexOf('<table', sigIdx);
    const tableEnd = updated.indexOf('</table>', sigIdx);
    const blockToInsert = replaced ? '' : signedBlock;
    if (tableStart !== -1 && tableEnd !== -1) {
      const outerDivStart = updated.lastIndexOf('<div', tableStart);
      const outerDivEnd = updated.indexOf('</div>', tableEnd);
      if (outerDivStart !== -1 && outerDivEnd !== -1 && (outerDivEnd - outerDivStart) < (tableEnd - tableStart) + 400) {
        updated = updated.slice(0, outerDivStart) + blockToInsert + updated.slice(outerDivEnd + '</div>'.length);
      } else {
        updated = updated.slice(0, tableStart) + blockToInsert + updated.slice(tableEnd + '</table>'.length);
      }
      replaced = true;
    } else {
      updated = updated.replace(/\[\s*SIGNATURE FIELD\s*\]/i, replaced ? '' : sigImgHtml);
      replaced = true;
    }
  }

  // 3. Fallback: ONLY append if absolutely no placeholder existed anywhere AND fallbackAppend is requested
  if (!replaced && fallbackAppend && (name || photoDataUrl)) {
    updated = html + '\n<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;">' + signedBlock + '</div>';
    replaced = true;
  }

  return { html: updated, replaced };
}

/**
 * injectSignatureIntoFooter
 * Replaces the signature placeholder in footerHtml with the signed block.
 */
function injectSignatureIntoFooter(footerHtml, name, photoDataUrl, signedAt) {
  const res = injectSignatureIntoHtml(footerHtml, name, photoDataUrl, signedAt, true);
  return res.html;
}

/**
 * injectSignatureIntoDocument
 * Checks both footerHtml and bodyHtml of renderPieces, replacing any signature
 * field with the signed block. Guarantees that the signature is attached in EXACTLY ONE PLACE.
 */
function injectSignatureIntoDocument(pieces, name, photoDataUrl, signedAt) {
  if (!pieces) return pieces;
  const newPieces = { ...pieces };

  // IDEMPOTENCY: If already embedded in footerHtml or bodyHtml, NEVER duplicate or append!
  const hasEmbeddedInFooter = newPieces.footerHtml && (newPieces.footerHtml.includes('SIGNATURE_EMBEDDED') || newPieces.footerHtml.includes('class="signature-block"'));
  const hasEmbeddedInBody = newPieces.bodyHtml && (newPieces.bodyHtml.includes('SIGNATURE_EMBEDDED') || newPieces.bodyHtml.includes('class="signature-block"'));

  if (hasEmbeddedInFooter || hasEmbeddedInBody) {
    if (newPieces.footerHtml) {
      newPieces.footerHtml = newPieces.footerHtml
        .replace(/<!-- \[\[SIGNATURE_FIELD[\s\S]*?<!-- \[\[\/SIGNATURE_FIELD[^\]]*\]\] -->/gi, '')
        .replace(/\[\s*SIGNATURE FIELD\s*\]/gi, '');
    }
    if (newPieces.bodyHtml) {
      newPieces.bodyHtml = newPieces.bodyHtml
        .replace(/<!-- \[\[SIGNATURE_FIELD[\s\S]*?<!-- \[\[\/SIGNATURE_FIELD[^\]]*\]\] -->/gi, '')
        .replace(/\[\s*SIGNATURE FIELD\s*\]/gi, '');
    }
    return newPieces;
  }

  let replaced = false;

  // Check footerHtml first (primary standard location)
  if (newPieces.footerHtml && (newPieces.footerHtml.includes('SIGNATURE_FIELD') || newPieces.footerHtml.includes('SIGNATURE FIELD'))) {
    const resFooter = injectSignatureIntoHtml(newPieces.footerHtml, name, photoDataUrl, signedAt, false);
    if (resFooter.replaced) {
      newPieces.footerHtml = resFooter.html;
      replaced = true;
    }
  }

  // Check bodyHtml only if NOT already replaced in footerHtml (keep it in exactly ONE place)
  if (!replaced && newPieces.bodyHtml && (newPieces.bodyHtml.includes('SIGNATURE_FIELD') || newPieces.bodyHtml.includes('SIGNATURE FIELD'))) {
    const resBody = injectSignatureIntoHtml(newPieces.bodyHtml, name, photoDataUrl, signedAt, false);
    if (resBody.replaced) {
      newPieces.bodyHtml = resBody.html;
      replaced = true;
    }
  } else if (replaced && newPieces.bodyHtml) {
    // If already placed in footerHtml, clean any leftover placeholder from bodyHtml so it never duplicates
    newPieces.bodyHtml = newPieces.bodyHtml
      .replace(/<!-- \[\[SIGNATURE_FIELD[\s\S]*?<!-- \[\[\/SIGNATURE_FIELD[^\]]*\]\] -->/gi, '')
      .replace(/\[\s*SIGNATURE FIELD\s*\]/gi, '');
  }

  // Fallback: ONLY append to footerHtml if NO placeholder was present anywhere in the document
  if (!replaced && (name || photoDataUrl)) {
    const resFallback = injectSignatureIntoHtml(newPieces.footerHtml || '', name, photoDataUrl, signedAt, true);
    newPieces.footerHtml = resFallback.html;
  }

  return newPieces;
}

module.exports = {
  assembleDocumentHtml,
  resolveWatermarkForStatus,
  injectSignatureIntoFooter,
  injectSignatureIntoHtml,
  injectSignatureIntoDocument,
  generateSignatureSvg,
  stripEditorOnlyElements,
};
