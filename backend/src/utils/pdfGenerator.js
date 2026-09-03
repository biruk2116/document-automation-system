const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

let sharedBrowser = null;
// Guards against concurrent callers (e.g. a bulk job's records racing a separate
// single-document request) each seeing sharedBrowser as null/disconnected and
// launching their own Chromium instance at the same time.
let launchPromise = null;

/**
 * True if `browser` is a live, usable Puppeteer Browser instance.
 * Puppeteer 25 removed the `isConnected()` method in favor of the `.connected`
 * property (https://github.com/puppeteer/puppeteer/pull/14910); older versions
 * only have the method. Support both so this keeps working across upgrades instead
 * of throwing "sharedBrowser.isConnected is not a function".
 */
function isBrowserConnected(browser) {
  if (!browser) return false;
  if (typeof browser.connected === 'boolean') return browser.connected;
  if (typeof browser.isConnected === 'function') return browser.isConnected();
  return false;
}

/** Reuses one headless Chromium instance across requests instead of relaunching each time (NFR-001: <2s per PDF). */
async function getBrowser() {
  if (!isBrowserConnected(sharedBrowser)) {
    // If a launch is already in flight (concurrent callers), await that one
    // instead of starting a second Chromium process.
    if (!launchPromise) {
      launchPromise = puppeteer
        .launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'], // required in most containerized/CI environments
        })
        .finally(() => {
          launchPromise = null;
        });
    }
    sharedBrowser = await launchPromise;
  }
  return sharedBrowser;
}

/**
 * Renders full HTML into a PDF buffer, A4 sized.
 * `html` must already be a full assembled document (see documentAssembler.js).
 */
async function htmlToPdfBuffer(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // FR-014 Unicode fonts: `networkidle0` only guarantees network requests have
    // settled — it does NOT guarantee the browser has finished selecting/rasterizing
    // the fallback fonts declared in documentAssembler.js's font-family stack (Noto
    // Sans Arabic/Ethiopic/SC/etc). Explicitly waiting on document.fonts.ready closes
    // that race so Arabic/Amharic/Chinese text is never captured mid-swap (which is
    // what causes intermittent tofu boxes/missing glyphs in an otherwise-correct PDF).
    await page.evaluate(() => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()));
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }, // margins are handled in the HTML's @page/.page CSS instead
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * FR-014 Unicode fonts: best-effort startup diagnostic (Linux/fontconfig only — the
 * usual case for a server/container running headless Chromium). Never throws and never
 * blocks startup: if `fc-list` isn't available (e.g. Windows dev machine, or fontconfig
 * genuinely missing) this just skips the check silently. Its only job is to turn "why
 * is Amharic text blank in the PDF" into a clear log line at boot instead of a support
 * ticket after go-live. See FONTS.md for the OS packages this is checking for.
 */
const RECOMMENDED_UNICODE_FONTS = [
  { label: 'Arabic', pattern: /noto sans arabic/i },
  { label: 'Amharic / Ethiopic', pattern: /noto sans ethiopic/i },
  { label: 'Chinese (Simplified)', pattern: /noto sans (sc|cjk sc)/i },
];

async function checkUnicodeFontsAvailable() {
  try {
    const { stdout } = await execFileAsync('fc-list', [], { timeout: 5000 });
    const missing = RECOMMENDED_UNICODE_FONTS.filter((f) => !f.pattern.test(stdout)).map((f) => f.label);
    if (missing.length > 0) {
      console.warn(
        `[pdfGenerator] Unicode font check: missing system fonts for: ${missing.join(', ')}. ` +
        `PDFs with that script's text will show blank/garbled glyphs until the fonts are installed. ` +
        `See backend/FONTS.md for the install command.`
      );
    }
  } catch {
    // fc-list not available on this OS, or fontconfig isn't installed — nothing to report.
  }
}

module.exports = { htmlToPdfBuffer, closeBrowser, checkUnicodeFontsAvailable };
