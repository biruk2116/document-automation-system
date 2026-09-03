import { useEffect, useRef, useState } from 'react';

const RELOAD_FLAG_PREFIX = 'secure-one-time-viewer:left:';

// Module-level (not component-level) so it survives React StrictMode's dev-only
// double-invoke of effects (mount -> cleanup -> mount again on the same instance).
// GET fetchUrl is NOT idempotent — the server marks the one-time token used on the
// first successful hit — so a second real fetch() for the same URL would 410 on an
// already-spent token. Just as importantly, a fetch Response's body (res.blob() /
// res.json()) can only ever be read ONCE — if two invocations shared the same
// Response and both tried to read it, the second read throws and surfaces as
// "Failed to load the document." So this map caches the fully-resolved outcome
// (ok/blob/message) per URL, not just the in-flight fetch — every invocation for
// the same fetchUrl (StrictMode's extra one included) shares one real network call
// AND one read of the body.
const inFlightRequests = new Map();

async function fetchDocumentOnce(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let message = null;
    try {
      const payload = await res.json();
      message = payload.message || null;
    } catch {
      // response wasn't JSON — leave message null, caller falls back to a default
    }
    return { ok: false, message };
  }
  const blob = await res.blob();
  return { ok: true, blob };
}

/**
 * Shared by ReviewDocumentPage (Approver) and GeneratorDocumentViewPage (Generator).
 * Both point at a backend endpoint that is single-use SERVER-SIDE (the token is marked
 * used on first successful open, so a second request 410s regardless of what happens
 * here). This component adds TWO client-side layers on top of that:
 *
 *  1. The PDF is fetched once as a blob and held only in memory. The moment the tab is
 *     backgrounded — switched away from, minimized, or the app loses focus — the blob
 *     is revoked and wiped from state immediately.
 *
 *  2. Coming BACK to the tab after having left it does not just show a static "it's
 *     gone" message sitting in memory — it forces a real `location.reload()`, so the
 *     page genuinely re-hits the server on the now-already-used token. Since the
 *     token is spent, the server correctly 410s, and the freshly reloaded page shows
 *     a clean "Failed — session timed out" state. This is a real disappearance
 *     confirmed by the server on return, not just a client-side illusion that could
 *     be undone by inspecting in-memory state.
 */
export default function SecureOneTimeDocumentViewer({ fetchUrl, title = 'Document Review', heightVh = 70 }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | gone | error
  const [errorMessage, setErrorMessage] = useState('');
  const pdfUrlRef = useRef(null); // mirrors pdfUrl so the visibility listener always sees the latest value
  const hadActiveViewRef = useRef(false); // true once the PDF has successfully rendered at least once
  const reloadFlagKey = `${RELOAD_FLAG_PREFIX}${fetchUrl}`;

  useEffect(() => {
    let cancelled = false;

    // If we're loading because we just force-reloaded after the person left and came
    // back to this tab, don't even bother showing the PDF again if the fetch somehow
    // still succeeds (it shouldn't — the server-side token is already spent) — treat
    // it as timed out regardless, for defense in depth.
    const cameBackAfterLeaving = sessionStorage.getItem(reloadFlagKey) === '1';
    if (cameBackAfterLeaving) sessionStorage.removeItem(reloadFlagKey);

    async function load() {
      try {
        let pending = inFlightRequests.get(fetchUrl);
        if (!pending) {
          pending = fetchDocumentOnce(fetchUrl).finally(() => inFlightRequests.delete(fetchUrl));
          inFlightRequests.set(fetchUrl, pending);
        }
        const result = await pending;

        if (!result.ok || cameBackAfterLeaving) {
          let message = 'Failed — your one-time viewing session has timed out. This document could only be viewed once and disappeared the moment you left the tab.';
          if (!result.ok && result.message && !cameBackAfterLeaving) message = result.message;
          if (!cancelled) {
            setErrorMessage(message);
            setStatus('error');
          }
          return;
        }
        // Stop here — before touching result.blob at all — for a stale (StrictMode
        // phantom, or torn-down) invocation, so only the one real invocation ever
        // turns the already-consumed blob into an object URL.
        if (cancelled) return;
        if (document.hidden) {
          // The tab was backgrounded while the (already single-use) fetch was in
          // flight — don't surface the document at all once they come back.
          setStatus('gone');
          return;
        }
        const objectUrl = URL.createObjectURL(result.blob);
        pdfUrlRef.current = objectUrl;
        hadActiveViewRef.current = true;
        setPdfUrl(objectUrl);
        setStatus('ready');
      } catch {
        inFlightRequests.delete(fetchUrl);
        if (!cancelled) {
          setErrorMessage('Failed to load the document. Check your connection and try the link again.');
          setStatus('error');
        }
      }
    }

    load();

    function wipe(nextStatus) {
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
      setPdfUrl(null);
      setStatus((current) => (current === 'ready' ? nextStatus : current));
    }

    // Fires on tab switch, minimize, app backgrounding (mobile), or switching to another
    // window — without needing a refresh or tab close. This is the core "leaves the
    // browser, data disappears" requirement.
    function handleVisibilityChange() {
      if (document.hidden) {
        if (hadActiveViewRef.current) {
          wipe('gone');
        }
        return;
      }
      // Coming BACK to the tab: if the PDF had actually been shown at some point during
      // this page's life, force a real reload rather than just leaving the client-side
      // "gone" message on screen. The reload re-hits the server, which 410s the spent
      // token, and the reloaded page shows a clean, server-confirmed timeout state.
      if (hadActiveViewRef.current) {
        sessionStorage.setItem(reloadFlagKey, '1');
        window.location.reload();
      }
    }
    // Extra safety net for cases visibilitychange can miss (e.g. some in-app browsers).
    function handlePageHide() {
      if (hadActiveViewRef.current) wipe('gone');
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, [fetchUrl, reloadFlagKey]);

  if (status === 'loading') {
    return <div className="verify-status">Loading document…</div>;
  }

  if (status === 'error') {
    return <div className="login-error" style={{ fontWeight: 600 }}>{errorMessage}</div>;
  }

  if (status === 'gone') {
    return (
      <div className="login-error" style={{ fontWeight: 600 }}>
        Failed — your one-time viewing session has timed out. This document was
        cleared because you left the tab, and it can only ever be viewed once.
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', height: `${heightVh}vh`, marginTop: 16 }}>
      <iframe src={pdfUrl} title={title} width="100%" height="100%" style={{ border: 'none' }} />
    </div>
  );
}
