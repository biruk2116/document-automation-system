const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let sharedBrowser = null;
let launchPromise = null;

/**
 * Check whether a Puppeteer browser instance is connected.
 *
 * Supports both newer and older Puppeteer versions.
 */
function isBrowserConnected(browser) {
  if (!browser) {
    return false;
  }

  // Puppeteer newer versions
  if (typeof browser.connected === 'boolean') {
    return browser.connected;
  }

  // Older Puppeteer versions
  if (typeof browser.isConnected === 'function') {
    return browser.isConnected();
  }

  return false;
}

/**
 * Get the Chrome executable path.
 *
 * Priority:
 * 1. PUPPETEER_EXECUTABLE_PATH environment variable
 * 2. Puppeteer's automatically detected executable path
 *
 * IMPORTANT:
 * puppeteer.executablePath() may return a Promise in the
 * Puppeteer version being used, so this function is async.
 */
async function getChromeExecutablePath() {
  const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH;

  if (configuredPath && configuredPath.trim()) {
    return configuredPath.trim();
  }

  const executablePath = await puppeteer.executablePath();

  return executablePath;
}

/**
 * Get or create the shared browser.
 *
 * Reusing one browser is much faster than launching Chrome
 * for every PDF generation request.
 */
async function getBrowser() {
  // Reuse existing browser if it is still connected.
  if (isBrowserConnected(sharedBrowser)) {
    return sharedBrowser;
  }

  // If another request is already launching Chrome,
  // wait for that same launch instead of starting another one.
  if (!launchPromise) {
    launchPromise = (async () => {
      const executablePath = await getChromeExecutablePath();

      console.log(
        '[pdfGenerator] Puppeteer executable:',
        executablePath
      );

      console.log(
        '[pdfGenerator] Puppeteer cache directory:',
        process.env.PUPPETEER_CACHE_DIR ||
          '(Puppeteer default cache directory)'
      );

      if (!executablePath) {
        throw new Error(
          'Puppeteer could not determine the Chrome executable path.'
        );
      }

      console.log('[pdfGenerator] Launching Chrome...');

      const browser = await puppeteer.launch({
        headless: true,

        /*
         * Explicit Chrome executable.
         */
        executablePath: executablePath,

        /*
         * Required/recommended for Render and other
         * Linux container environments.
         */
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
        ],

        /*
         * Allow enough time for Chrome to start on Render.
         */
        timeout: 60000,
      });

      console.log(
        '[pdfGenerator] Chrome started successfully.'
      );

      /*
       * If Chrome crashes or disconnects, clear the
       * shared browser so the next request can relaunch it.
       */
      browser.on('disconnected', () => {
        console.warn(
          '[pdfGenerator] Chrome browser disconnected.'
        );

        if (sharedBrowser === browser) {
          sharedBrowser = null;
        }
      });

      return browser;
    })().finally(() => {
      launchPromise = null;
    });
  }

  sharedBrowser = await launchPromise;

  return sharedBrowser;
}

/**
 * Convert HTML to an A4 PDF buffer.
 *
 * @param {string} html - Complete HTML document
 * @returns {Promise<Buffer>} PDF buffer
 */
async function htmlToPdfBuffer(html) {
  if (!html || typeof html !== 'string') {
    throw new Error(
      'htmlToPdfBuffer requires a valid HTML string.'
    );
  }

  const browser = await getBrowser();

  let page = null;

  try {
    page = await browser.newPage();

    /*
     * Set a standard A4-like viewport.
     *
     * Actual PDF size is controlled by page.pdf({ format: 'A4' }).
     */
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    /*
     * Load the assembled HTML.
     */
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    /*
     * Wait for all document fonts to finish loading.
     *
     * Important for:
     * - Amharic
     * - Arabic
     * - Chinese
     * - Other Unicode text
     */
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    /*
     * Small delay to allow final browser layout/font
     * rendering before PDF capture.
     */
    await new Promise((resolve) => setTimeout(resolve, 100));

    /*
     * Generate A4 PDF.
     *
     * Margins are handled by the HTML/CSS.
     */
    const pdfBuffer = await page.pdf({
      format: 'A4',

      printBackground: true,

      /*
       * Allows CSS @page size to be respected.
       */
      preferCSSPageSize: true,

      /*
       * The document HTML controls its own margins.
       */
      margin: {
        top: '0mm',
        bottom: '0mm',
        left: '0mm',
        right: '0mm',
      },

      displayHeaderFooter: false,
    });

    return pdfBuffer;
  } catch (error) {
    console.error(
      '[pdfGenerator] PDF generation error:',
      error
    );

    /*
     * If Chrome disconnected/crashed, force a fresh
     * browser on the next request.
     */
    if (!isBrowserConnected(browser)) {
      sharedBrowser = null;
    }

    throw error;
  } finally {
    /*
     * Close only the page.
     *
     * The browser itself remains alive and is reused.
     */
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        console.warn(
          '[pdfGenerator] Could not close PDF page:',
          closeError.message
        );
      }
    }
  }
}

/**
 * Close the shared browser.
 *
 * Call this when shutting down the Node.js application.
 */
async function closeBrowser() {
  if (!sharedBrowser) {
    return;
  }

  const browser = sharedBrowser;

  sharedBrowser = null;

  try {
    if (isBrowserConnected(browser)) {
      await browser.close();

      console.log(
        '[pdfGenerator] Chrome browser closed.'
      );
    }
  } catch (error) {
    console.warn(
      '[pdfGenerator] Error closing Chrome:',
      error.message
    );
  }
}

/**
 * Recommended Unicode fonts.
 *
 * These are checked at application startup.
 */
const RECOMMENDED_UNICODE_FONTS = [
  {
    label: 'Arabic',
    pattern: /noto sans arabic/i,
  },
  {
    label: 'Amharic / Ethiopic',
    pattern: /noto sans ethiopic/i,
  },
  {
    label: 'Chinese (Simplified)',
    pattern: /noto sans (sc|cjk sc)/i,
  },
];

/**
 * Check whether recommended Unicode fonts
 * are installed on the server.
 *
 * This is only a diagnostic.
 * It NEVER prevents the server from starting.
 */
async function checkUnicodeFontsAvailable() {
  try {
    const { stdout } = await execFileAsync(
      'fc-list',
      [],
      {
        timeout: 5000,
      }
    );

    const missing = RECOMMENDED_UNICODE_FONTS
      .filter((font) => !font.pattern.test(stdout))
      .map((font) => font.label);

    if (missing.length > 0) {
      console.warn(
        `[pdfGenerator] Unicode font check: missing system fonts for: ${missing.join(', ')}`
      );

      console.warn(
        '[pdfGenerator] PDFs containing these scripts may have missing or incorrect characters.'
      );

      console.warn(
        '[pdfGenerator] See backend/FONTS.md for font installation instructions.'
      );
    } else {
      console.log(
        '[pdfGenerator] Unicode font check: all recommended fonts are available.'
      );
    }
  } catch (error) {
    /*
     * fc-list may not exist on Windows or some Linux
     * environments. This must not stop the application.
     */
    console.warn(
      '[pdfGenerator] Could not check system fonts:',
      error.message
    );
  }
}

/**
 * Export functions used by the rest of the application.
 */
module.exports = {
  htmlToPdfBuffer,
  closeBrowser,
  checkUnicodeFontsAvailable,
};