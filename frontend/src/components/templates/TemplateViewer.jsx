import { useEffect, useRef, useState } from 'react';
import pageSpec from '../../shared/documentPageSpec.json';

/**
 * MS-Word "Print Layout" document viewer.
 *
 * A4 dimensions at 96 dpi (ISO standard):
 *   Page  : 794 × 1123 px  (210 × 297 mm)
 *   Margin: 96 px on all four sides  (25.4 mm = 1 inch — Word default)
 *   Content area per page: 602 × 931 px
 *
 * Rendering strategy
 * ──────────────────
 * 1. A hidden "ghost" div renders the full HTML at content-area width (602 px)
 *    with no page breaks.  Its scrollHeight gives the total content height.
 * 2. pageCount = ceil(contentHeight / CONTENT_H)   where CONTENT_H = 931 px.
 * 3. Each visual page is a white 794 × 1123 box with 96 px padding.
 *    Inside sits an absolutely-positioned content div that is translated upward
 *    by  pageIdx × CONTENT_H  so that only the correct slice is visible through
 *    the page's overflow:hidden clip.
 * 4. CSS zoom scales the whole multi-page stack to fit the container.
 *
 * This is identical to the way a browser renders a multi-page print preview
 * and to how Word's Print Layout view works: one continuous content stream,
 * clipped into fixed-size pages.
 */

const PAGE_W     = pageSpec.pageWidthPx;    // 794
const PAGE_H     = pageSpec.pageHeightPx;   // 1123
const PAGE_PAD   = pageSpec.pagePaddingPx;  // 96  (1-inch Word margin)
const CONTENT_W  = PAGE_W  - PAGE_PAD * 2; // 602
const CONTENT_H  = PAGE_H  - PAGE_PAD * 2; // 931
const PAGE_GAP   = 16;                      // gap between pages in the viewer

function cleanViewerHtml(rawHtml) {
  if (!rawHtml) return '';
  return String(rawHtml)
    .replace(/<button[^>]*class=["'][^"']*sig-field-remove-btn[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');
}

function injectClientSignature(html, userSigned) {
  if (!html || !userSigned) return html || '';

  // If already contains embedded signature block, do not embed again — strip any stray raw placeholders
  if (html.includes('<!-- SIGNATURE_EMBEDDED -->') || html.includes('signature-block')) {
    return html
      .replace(/<!-- \[\[SIGNATURE_FIELD[\s\S]*?<!-- \[\[\/SIGNATURE_FIELD[^\]]*\]\] -->/gi, '')
      .replace(/\[\s*SIGNATURE FIELD\s*\]/gi, '');
  }

  const name = userSigned.name || userSigned.signatureText || userSigned.recipientName || '';
  const photo = userSigned.photo || userSigned.signaturePhoto || null;
  const signedAt = userSigned.signedAt || userSigned.workflow_user_signed_at || userSigned.date || new Date();
  const dateStr = new Date(signedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const sigImgHtml = photo
    ? `<img src="${photo}" alt="Signature" style="display:block;max-height:48px;max-width:180px;object-fit:contain;" />`
    : `<div style="font-family:'Edu QLD Beginner','Brush Script MT','Segoe Script',cursive;font-size:22px;color:#0F2747;font-style:italic;text-align:center;">${name || 'Digitally Approved'}</div>`;

  const signedBlock = `<!-- SIGNATURE_EMBEDDED -->
<div class="signature-block" style="break-inside:avoid !important;margin-top:12px;display:block;">
<table class="signature-table" style="width:100%;border-collapse:collapse;font-family:inherit;font-size:12px;color:#1a1a2e;break-inside:avoid !important;">
  <tbody>
    <tr style="break-inside:avoid !important;">
      <td style="width:38%;padding:4px 8px 4px 0;vertical-align:bottom;break-inside:avoid !important;">
        <div style="padding-bottom:3px;min-width:80px;font-family:inherit;font-size:14px;font-weight:600;color:#0F2747;border-bottom:2px solid #0F2747;">
          ${name || '&nbsp;'}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#64748B;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Name</div>
      </td>
      <td style="width:62%;padding:4px 0 4px 8px;vertical-align:bottom;break-inside:avoid !important;">
        <div style="border:2px solid #0F2747;border-radius:4px;min-height:52px;padding:6px 8px;background:#fff;display:flex;align-items:center;justify-content:center;">
          ${sigImgHtml}
        </div>
        <div style="margin-top:4px;font-size:9px;color:#64748B;letter-spacing:0.04em;text-transform:uppercase;font-weight:600;">Signature</div>
      </td>
    </tr>
    <tr style="break-inside:avoid !important;">
      <td colspan="2" style="padding:8px 0 0;vertical-align:bottom;break-inside:avoid !important;">
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

  let updated = html;
  let replaced = false;

  while (updated.includes('<!-- [[SIGNATURE_FIELD') || updated.includes('[ SIGNATURE FIELD ]') || updated.includes('[SIGNATURE FIELD]')) {
    const blockToInsert = replaced ? '' : signedBlock;
    let startIdx = updated.indexOf('<!-- [[SIGNATURE_FIELD');
    if (startIdx !== -1) {
      let endIdx = updated.indexOf('<!-- [[/SIGNATURE_FIELD', startIdx);
      if (endIdx !== -1) {
        let commentEnd = updated.indexOf('-->', endIdx) + 3;
        let outerStart = updated.lastIndexOf('<div', startIdx);
        let outerEnd = updated.indexOf('</div>', commentEnd);
        if (outerStart !== -1 && outerEnd !== -1) {
          updated = updated.slice(0, outerStart) + blockToInsert + updated.slice(outerEnd + 6);
          replaced = true;
          continue;
        }
      }
    }
    let sigIdx = Math.max(updated.indexOf('[ SIGNATURE FIELD ]'), updated.indexOf('[SIGNATURE FIELD]'));
    if (sigIdx !== -1) {
      let tblStart = updated.lastIndexOf('<table', sigIdx);
      let tblEnd = updated.indexOf('</table>', sigIdx);
      if (tblStart !== -1 && tblEnd !== -1) {
        let divStart = updated.lastIndexOf('<div', tblStart);
        let divEnd = updated.indexOf('</div>', tblEnd);
        if (divStart !== -1 && divEnd !== -1 && (divEnd - divStart) < (tblEnd - tblStart) + 400) {
          updated = updated.slice(0, divStart) + blockToInsert + updated.slice(divEnd + 6);
        } else {
          updated = updated.slice(0, tblStart) + blockToInsert + updated.slice(tblEnd + 8);
        }
        replaced = true;
        continue;
      }
      updated = updated.replace(/\[\s*SIGNATURE FIELD\s*\]/i, replaced ? '' : sigImgHtml);
      replaced = true;
      break;
    }
    break;
  }
  return updated;
}

export default function TemplateViewer({ data }) {
  const containerRef = useRef(null);
  const ghostRef     = useRef(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [pageCount,      setPageCount]      = useState(1);
  const [userZoomDelta,  setUserZoomDelta]  = useState(0);

  /* ── Measure container to compute auto-fit zoom ── */
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* ── Measure ghost content height to derive page count ── */
  useEffect(() => {
    if (!ghostRef.current) return;

    const measure = () => {
      const h = ghostRef.current?.scrollHeight || CONTENT_H;
      setPageCount(Math.max(1, Math.ceil(h / CONTENT_H)));
    };
    measure();

    const imgs = ghostRef.current?.querySelectorAll('img') || [];
    imgs.forEach(img => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });

    const ro = new ResizeObserver(measure);
    if (ghostRef.current) ro.observe(ghostRef.current);
    return () => ro.disconnect();
  }, [data]);

  if (!data) return null;

  // Extract signature info if attached
  const userSigned = data.user_signed || data.userSigned || data.workflow_signature_data || data.metadata?.userSigned || null;
  const parsedUserSigned = typeof userSigned === 'string' ? JSON.parse(userSigned) : userSigned;

  const rawHtml = data.html ||
    `${data.header_html || ''}${data.body_html || ''}${data.footer_html || ''}`;
  const cleanedHtml = cleanViewerHtml(rawHtml);
  const html = injectClientSignature(cleanedHtml, parsedUserSigned);

  const watermarkText = data.watermark_text;
  const warnings      = data.placeholder_warnings || [];

  /* ── Zoom ── */
  // Fit page width into container; cap at 100 % so we don't enlarge by default
  const autoFitPct = containerWidth > 0
    ? Math.min(100, Math.round((containerWidth / PAGE_W) * 100))
    : 100;
  const finalPct  = Math.max(30, Math.min(150, autoFitPct + userZoomDelta));
  const zoomFrac  = finalPct / 100;

  const zoomIn  = () => setUserZoomDelta(d => Math.min(50,  d + 10));
  const zoomOut = () => setUserZoomDelta(d => Math.max(-70, d - 10));
  const reset   = () => setUserZoomDelta(0);

  /* ── Shared CSS for document content inside every page ── */
  const contentCSS = `
    .a4-content,
    .a4-content *,
    .a4-content p,
    .a4-content div,
    .a4-content span,
    .a4-content font,
    .a4-content td,
    .a4-content th,
    .a4-content h1,
    .a4-content h2,
    .a4-content h3,
    .a4-content h4,
    .a4-content h5,
    .a4-content h6,
    .a4-content li {
      font-family: 'Noto Sans',
        /* Amharic / Ethiopic fonts */
        'Noto Sans Ethiopic', 'Nyala', 'Ebrima', 'Abyssinica SIL', 'Kefa',
        /* Arabic fonts */
        'Noto Sans Arabic', 'Noto Naskh Arabic', 'Segoe UI', 'Tahoma', 'Traditional Arabic',
        /* Chinese (Simplified & Traditional) fonts */
        'Noto Sans SC', 'Noto Sans TC', 'Microsoft YaHei', '微软雅黑', 'PingFang SC', 'Hiragino Sans GB', 'SimSun', '宋体', 'SimHei',
        /* Additional scripts */
        'Noto Sans Hebrew', 'Noto Sans Devanagari', 'Noto Sans JP', 'Noto Sans KR',
        Calibri, Arial, Helvetica, sans-serif;
    }
    .a4-content {
      font-size: 11pt;
      line-height: 1.5;
      color: #1a1a2e;
      unicode-bidi: plaintext;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    .a4-content p, .a4-content h1, .a4-content h2, .a4-content h3, .a4-content h4, .a4-content h5, .a4-content h6, .a4-content li, .a4-content td, .a4-content th, .a4-content div {
      unicode-bidi: plaintext;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    .a4-content [dir="auto"] {
      text-align: start;
    }
    .a4-content [dir="rtl"], .a4-content :dir(rtl), .a4-content .rtl-block {
      direction: rtl;
      text-align: right;
    }
    .a4-content h1 { font-size: 18pt; font-weight: 700; line-height: 1.25; margin: 14pt 0 6pt 0; color: #0f172a; }
    .a4-content h2 { font-size: 14pt; font-weight: 700; line-height: 1.3; margin: 12pt 0 5pt 0; color: #1e293b; }
    .a4-content h3 { font-size: 12pt; font-weight: 600; line-height: 1.35; margin: 10pt 0 4pt 0; color: #334155; }
    .a4-content h4, .a4-content h5, .a4-content h6 { font-size: 11pt; font-weight: 600; margin: 8pt 0 4pt 0; color: #1e293b; }
    .a4-content p  { margin: 0 0 8pt 0; line-height: 1.5; }

    /* Strict bold & unbold overrides */
    .a4-content b,
    .a4-content strong,
    .a4-content [style*="font-weight: bold"],
    .a4-content [style*="font-weight:bold"],
    .a4-content [style*="font-weight: 600"],
    .a4-content [style*="font-weight:600"],
    .a4-content [style*="font-weight: 700"],
    .a4-content [style*="font-weight:700"],
    .a4-content [style*="font-weight: 800"],
    .a4-content [style*="font-weight:800"],
    .a4-content [style*="font-weight: 900"],
    .a4-content [style*="font-weight:900"],
    .a4-content [style*="font-weight: bolder"],
    .a4-content [style*="font-weight:bolder"] {
      font-weight: 700 !important;
    }
    .a4-content [style*="font-weight: normal"],
    .a4-content [style*="font-weight:normal"],
    .a4-content [style*="font-weight: 400"],
    .a4-content [style*="font-weight:400"],
    .a4-content .font-normal {
      font-weight: 400 !important;
    }

    .a4-content ul, .a4-content ol { margin: 0 0 8pt 0; padding-left: 24pt; }
    .a4-content li { margin-bottom: 3pt; line-height: 1.5; }
    .a4-content blockquote { margin: 8pt 0; padding: 4pt 14pt; border-left: 3pt solid #0856C3; color: #475569; background: #f8fafc; }
    .a4-content hr { border: none; border-top: 1px solid #cbd5e1; margin: 12pt 0; }
    .a4-content img { max-width: 100%; height: auto; display: block; }
    .a4-content table:not(.signature-table) { width: 100%; max-width: 100%; border-collapse: collapse; margin: 10pt 0; table-layout: auto; }
    .a4-content table:not(.signature-table) th,
    .a4-content table:not(.signature-table) td { border: 1px solid #cbd5e1; padding: 6pt 8pt; word-break: break-word; vertical-align: top; }
    .a4-content table:not(.signature-table) th { background-color: #f8fafc; font-weight: 600; text-align: start; color: #0f172a; }
    .a4-content pre,
    .a4-content code { white-space: pre-wrap; word-break: break-all; }
    .a4-content .doc-generated-date,
    .a4-content .document-dates {
      font-size: 8.5pt;
      font-style: italic !important;
      color: #475569;
      margin: 8pt 0 4pt 0;
      line-height: 1.4;
      text-align: left;
      direction: ltr !important;
    }
    .a4-content .doc-generated-date em,
    .a4-content .doc-generated-date strong,
    .a4-content .document-dates em,
    .a4-content .document-dates strong {
      font-style: italic !important;
    }
    .a4-content * { max-width: 100%; box-sizing: border-box; }
  `;

  return (
    <div ref={containerRef} style={{ width: '100%', minWidth: 0 }}>

      {/* ── Placeholder warnings ── */}
      {warnings.length > 0 && (
        <div className="placeholder-warning-banner" style={{ marginBottom: 12 }}>
          <p>
            <strong>{warnings.length} placeholder issue{warnings.length > 1 ? 's' : ''} found</strong>
            {' — fix these before generating a real PDF.'}
          </p>
          <ul>
            {warnings.map((w, i) => (
              <li key={`${w.region}-${w.fieldPath}-${i}`}>
                <strong>{w.region}:</strong> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Zoom toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        marginBottom: 10, flexWrap: 'wrap',
      }}>
        <button type="button" onClick={zoomOut} title="Zoom out" style={zoomBtnStyle}>−</button>
        <span style={zoomLabelStyle}>{finalPct}%</span>
        <button type="button" onClick={zoomIn}  title="Zoom in"  style={zoomBtnStyle}>+</button>
        <button type="button" onClick={reset}   title="Reset to fit width" style={zoomBtnStyle}>Fit</button>
        <span style={{
          marginLeft: 8, fontSize: '0.78rem', color: 'var(--text-muted)',
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '3px 10px', flexShrink: 0,
        }}>
          {pageCount} page{pageCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/*
        ── Ghost ──
        Renders the full HTML at content-area width (CONTENT_W = 602 px),
        completely off-screen, so scrollHeight gives us the real content height.
        No page padding here — we're measuring content only.
      */}
      <div aria-hidden="true" style={{
        position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
        width: CONTENT_W,
        top: 0, left: '-9999px',
        background: '#ffffff', color: '#1a1a2e',
        fontSize: '11pt', lineHeight: '1.5',
        fontFamily: "'Noto Sans', 'Noto Sans Arabic', 'Noto Sans Ethiopic', 'Noto Sans SC', Arial, sans-serif",
        boxSizing: 'border-box',
      }}>
        <style>{contentCSS}</style>
        <div ref={ghostRef} className="a4-content" dir="auto"
          dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      {/*
        ── Page stack surround ──
        Neutral grey background mimics Word's page canvas.
        Scrolls only inside this region — the app body never scrolls.
      */}
      <div style={{
        width: '100%',
        background: '#ADB5BD',   /* Word-style grey surround */
        borderRadius: 6,
        padding: `${14 * zoomFrac}px ${12 * zoomFrac}px`,
        boxSizing: 'border-box',
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: finalPct > autoFitPct ? 'auto' : 'hidden',
        scrollBehavior: 'smooth',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'thin',
        scrollbarColor: '#868E96 transparent',
      }}>
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: PAGE_GAP * zoomFrac,
        }}>
          {Array.from({ length: pageCount }, (_, pageIdx) => {
            // The content slice for this page starts at pageIdx * CONTENT_H
            const offsetY = pageIdx * CONTENT_H;

            return (
              <div key={pageIdx} style={{ position: 'relative', flexShrink: 0 }}>

                {/* ── White A4 paper sheet ── */}
                <div style={{
                  width: PAGE_W,
                  height: PAGE_H,
                  background: '#ffffff',
                  boxSizing: 'border-box',
                  position: 'relative',
                  overflow: 'hidden',
                  // Classic Word page shadow
                  boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.18)',
                  zoom: `${finalPct}%`,
                }}>

                  {/* ── Watermark ── */}
                  {watermarkText && (
                    <div style={{
                      position: 'absolute', top: '45%', left: '50%',
                      transform: 'translate(-50%, -50%) rotate(-35deg)',
                      fontSize: 72, fontWeight: 700, whiteSpace: 'nowrap',
                      pointerEvents: 'none', zIndex: 0, userSelect: 'none',
                      letterSpacing: 4,
                      color: watermarkText === 'FINAL'
                        ? 'rgba(37,99,235,0.10)'
                        : 'rgba(15,23,42,0.10)',
                    }}>
                      {watermarkText}
                    </div>
                  )}

                  {/* ── Automatic Page Number (bottom printable footer area: 1, 2, 3...) ── */}
                  <div style={{
                    position: 'absolute',
                    bottom: Math.round(PAGE_PAD * 0.28),
                    left: 0,
                    width: '100%',
                    textAlign: 'center',
                    fontSize: '9.5pt',
                    color: '#64748b',
                    fontFamily: "'Noto Sans', Arial, sans-serif",
                    zIndex: 10,
                    userSelect: 'none',
                    pointerEvents: 'none',
                  }}>
                    {pageIdx + 1}
                  </div>

                  {/*
                    ── Content layer ──
                    Absolutely positioned inside the page padding area.
                    translateY moves the full content stream up by the correct
                    amount so only the right CONTENT_H slice is visible.

                    Width is clamped to CONTENT_W (= PAGE_W - 2*PAGE_PAD).
                    The clip is enforced by the parent's overflow:hidden.
                  */}
                  <div style={{
                    position: 'absolute',
                    top: PAGE_PAD,
                    left: PAGE_PAD,
                    width: CONTENT_W,
                    // Translate upward so this page's slice is at the top
                    transform: `translateY(-${offsetY}px)`,
                    // Total height of the content stream
                    height: CONTENT_H * pageCount,
                    zIndex: 1,
                  }}>
                    <style>{contentCSS}</style>
                    <div className="a4-content" dir="auto"
                      dangerouslySetInnerHTML={{ __html: html }} />
                  </div>

                </div>

                {/* ── Page-break ruler (between pages, not after last) ── */}
                {pageIdx < pageCount - 1 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: `${4 * zoomFrac}px 0`,
                    width: PAGE_W * zoomFrac,
                    marginTop: PAGE_GAP * zoomFrac * 0.25,
                    marginBottom: PAGE_GAP * zoomFrac * 0.25,
                  }}>
                    <div style={{
                      flex: 1, height: 1,
                      background: 'rgba(255,255,255,0.35)',
                    }} />
                    <span style={{
                      fontSize: Math.max(9, 10 * zoomFrac),
                      color: 'rgba(255,255,255,0.6)',
                      whiteSpace: 'nowrap', userSelect: 'none',
                      fontFamily: 'system-ui, sans-serif',
                    }}>
                      Page {pageIdx + 2}
                    </span>
                    <div style={{
                      flex: 1, height: 1,
                      background: 'rgba(255,255,255,0.35)',
                    }} />
                  </div>
                )}

              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Zoom toolbar button style ── */
const zoomBtnStyle = {
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: '0.82rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  lineHeight: 1,
  flexShrink: 0,
  fontFamily: 'inherit',
};

const zoomLabelStyle = {
  minWidth: 44,
  textAlign: 'center',
  fontSize: '0.82rem',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  flexShrink: 0,
};
