const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

let sharedBrowser = null;

// Prevent multiple simultaneous requests from launching multiple browsers.
let launchPromise = null;

/**
 * Check whether a Puppeteer browser instance is still usable.
 *
 * Puppeteer versions differ:
 * - Newer versions use browser.connected
 * - Older versions use browser.isConnected()
 */
function isBrowserConnected(browser) {
  if (!browser) {
    return false;
  }

  if (typeof browser.connected === 'boolean') {
    return browser.connected;
  }

  if (typeof browser.isConnected === 'function') {
    return browser.isConnected();
  }

  return false;
}

/**
 * Get the Chrome executable path.
 *
 * Priority:
 * 1. PUPPETEER_EXECUTABLE_PATH from Render environment variables
 * 2. Puppeteer's automatically detected Chrome path
 */
function getChromeExecutablePath() {
  const configuredPath = process.env.PUPPETEER_EXECUTABLE_PATH;

  if (configuredPath && configuredPath.trim()) {
    return configuredPath.trim();
  }

  return puppeteer.executablePath();
}

/**
 * Launch/reuse a shared Chromium browser.
 *
 * This is important for production because launching a new browser
 * for every PDF request is slow and can consume a lot of memory.
 */
async function getBrowser() {
  if (isBrowserConnected(sharedBrowser)) {
    return sharedBrowser;
  }

  // If another request is already launching Chrome, wait for it.
  if (!launchPromise) {
    launchPromise = (async () => {
      const executablePath = getChromeExecutablePath();

      console.log(
        '[pdfGenerator] Puppeteer executable:',
        executablePath
      );

      console.log(
        '[pdfGenerator] Puppeteer cache directory:',
        process.env.PUPPETEER_CACHE_DIR ||
          '(Puppeteer default cache directory)'
      );

      /*
       * Verify that Puppeteer actually found an executable path.
       */
      if (!executablePath) {
        throw new Error(
          'Puppeteer could not determine the Chrome executable path.'
        );
      }

      console.log('[pdfGenerator] Launching Chrome...');

      const browser = await puppeteer.launch({
        headless: true,

        /*
         * Explicit executable path is important on Render.
         */
        executablePath,

        /*
         * Required/recommended for container environments such as Render.
         */
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
        ],

        /*
         * Give Chrome enough time to start on a cloud server.
         */
        timeout: 60000,
      });

      console.log('[pdfGenerator] Chrome started successfully.');

      /*
       * If Chrome unexpectedly disconnects, clear the shared reference
       * so the next PDF request can launch a new browser.
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
 * Render complete HTML into an A4 PDF buffer.
 *
 * @param {string} html
 * @returns {Promise<Buffer>}
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
     * Set viewport for consistent document rendering.
     */
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    /*
     * Load the complete document.
     *
     * networkidle0 waits until there are no active network requests.
     */
    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    /*
     * Wait until all web/system fonts have finished loading.
     *
     * This is especially important for:
     * - Amharic / Ethiopic
     * - Arabic
     * - Chinese
     */
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    /*
     * Give the browser a small amount of time to finish
     * layout/font rendering before creating the PDF.
     */
    await new Promise((resolve) => setTimeout(resolve, 100));

    /*
     * Generate A4 PDF.
     *
     * Margins are controlled by your HTML/CSS.
     */
    const pdfBuffer = await page.pdf({
      format: 'A4',

      printBackground: true,

      preferCSSPageSize: true,

      margin: {
        top: '0mm',
        bottom: '0mm',
        left: '0mm',
        right: '0mm',
      },

      /*
       * Ensure the PDF is generated in print mode.
       */
      displayHeaderFooter: false,
    });

    return pdfBuffer;
  } catch (error) {
    console.error(
      '[pdfGenerator] PDF generation error:',
      error
    );

    /*
     * If Chrome has crashed/disconnected, force a fresh browser
     * on the next request.
     */
    if (!isBrowserConnected(browser)) {
      sharedBrowser = null;
    }

    throw error;
  } finally {
    /*
     * Always close the page, but keep the browser alive for reuse.
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
 * Useful during application shutdown.
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
      console.log('[pdfGenerator] Chrome browser closed.');
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
 * Check whether required Unicode fonts are available.
 *
 * This function NEVER prevents the server from starting.
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
        '[pdfGenerator] Unicode font check: missing system fonts for:',
        missing.join(', ')
      );

      console.warn(
        '[pdfGenerator] PDFs containing these scripts may have ' +
        'missing or incorrect characters.'
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
 * Export functions used by the rest of the application.
 */
module.exports = {
  htmlToPdfBuffer,
  closeBrowser,
  checkUnicodeFontsAvailable,
};