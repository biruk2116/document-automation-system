const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let sharedBrowser = null;
let launchPromise = null;

/**
 * Check whether the browser is still connected.
 *
 * Supports both newer and older Puppeteer versions.
 */
function isBrowserConnected(browser) {
  if (!browser) {
    return false;
  }

  // Newer Puppeteer versions
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
 * Get a shared Chromium browser.
 *
 * Puppeteer automatically finds the Chrome browser that was
 * installed with:
 *
 * npm install && npx puppeteer browsers install chrome
 *
 * No executablePath is specified.
 */
async function getBrowser() {
  // Reuse existing browser.
  if (isBrowserConnected(sharedBrowser)) {
    return sharedBrowser;
  }

  // Prevent multiple simultaneous Chrome launches.
  if (!launchPromise) {
    launchPromise = (async () => {
      console.log('[pdfGenerator] Launching Puppeteer Chrome...');

      const browser = await puppeteer.launch({
        headless: true,

        /*
         * Required for Render/Linux container environments.
         */
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],

        /*
         * Give Chrome enough time to start on Render.
         */
        timeout: 60000,
      });

      console.log(
        '[pdfGenerator] Chrome started successfully.'
      );

      /*
       * If Chrome crashes or disconnects,
       * allow the next request to start a new browser.
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
 * Convert HTML into an A4 PDF.
 *
 * @param {string} html Complete HTML document
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
    /*
     * Create a new page for this PDF request.
     */
    page = await browser.newPage();

    /*
     * Standard A4-like viewport.
     */
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    /*
     * Load the complete HTML document.
     */
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    /*
     * Wait for fonts to finish loading.
     *
     * This is particularly useful for:
     * - Amharic
     * - Arabic
     * - Chinese
     * - Other Unicode characters
     */
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    /*
     * Allow the browser to finish final layout/font rendering.
     */
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });

    /*
     * Generate A4 PDF.
     */
    const pdfBuffer = await page.pdf({
      format: 'A4',

      printBackground: true,

      /*
       * Respect @page CSS rules from the generated document.
       */
      preferCSSPageSize: true,

      /*
       * Margins are controlled by the HTML/CSS.
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
     * If Chrome crashed, clear the shared browser.
     */
    if (!isBrowserConnected(browser)) {
      sharedBrowser = null;
    }

    throw error;
  } finally {
    /*
     * Close only this page.
     *
     * Keep Chrome running for the next PDF request.
     */
    if (page) {
      try {
        await page.close();
      } catch (error) {
        console.warn(
          '[pdfGenerator] Could not close PDF page:',
          error.message
        );
      }
    }
  }
}

/**
 * Close the shared browser.
 *
 * Useful when shutting down the application.
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
 * This is only a diagnostic check.
 * It will NEVER stop the server from starting.
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
     * fc-list may not exist on Windows or some Linux environments.
     * This must not stop the application.
     */
    console.warn(
      '[pdfGenerator] Could not check system fonts:',
      error.message
    );
  }
}

/**
 * Export functions used by the application.
 */
module.exports = {
  htmlToPdfBuffer,
  closeBrowser,
  checkUnicodeFontsAvailable,
};