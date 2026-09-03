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

  const html = data.html ||
    `${data.header_html || ''}${data.body_html || ''}${data.footer_html || ''}`;
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
    .a4-content { font-size: 11pt; line-height: 1.5; color: #1a1a2e; font-family: 'Calibri', 'Arial', sans-serif; }
    .a4-content h1 { font-size: 16pt; margin: 0.4em 0 0.3em; }
    .a4-content h2 { font-size: 14pt; margin: 0.4em 0 0.3em; }
    .a4-content h3 { font-size: 12pt; margin: 0.4em 0 0.3em; }
    .a4-content p  { margin: 0.3em 0; }
    .a4-content img        { max-width: 100%; height: auto; display: block; }
    .a4-content table      { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .a4-content td,
    .a4-content th         { word-break: break-word; overflow-wrap: break-word; padding: 4px 6px; }
    .a4-content pre,
    .a4-content code       { white-space: pre-wrap; word-break: break-all; }
    .a4-content *          { max-width: 100%; box-sizing: border-box; }
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
        fontFamily: "'Calibri', 'Arial', sans-serif",
        boxSizing: 'border-box',
      }}>
        <style>{contentCSS}</style>
        <div ref={ghostRef} className="a4-content"
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

                  {/* ── Page number (top-right, inside margin) ── */}
                  {pageCount > 1 && (
                    <div style={{
                      position: 'absolute', top: Math.round(PAGE_PAD * 0.4), right: PAGE_PAD,
                      fontSize: 9, color: 'rgba(0,0,0,0.3)',
                      fontFamily: 'system-ui, sans-serif',
                      zIndex: 10, userSelect: 'none', pointerEvents: 'none',
                    }}>
                      {pageIdx + 1} / {pageCount}
                    </div>
                  )}

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
                    <div className="a4-content"
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
