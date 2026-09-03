/**
 * signatureEmbedder.js
 *
 * Embeds the recipient's typed name and/or signature image directly into an
 * existing PDF buffer at the Admin-configured position, producing a new PDF
 * buffer with the signature baked into the correct page.
 *
 * Coordinate system:
 *   The Admin defines the signature field in the TemplateForm using millimetres
 *   measured from the TOP-LEFT of the page (CSS/screen convention):
 *     { page, x, y, width, height }   — all in mm, page is 1-indexed.
 *
 *   pdf-lib uses POINTS measured from the BOTTOM-LEFT of each page.
 *   Conversion:
 *     1 mm = MM_TO_PT points
 *     ptX  = x_mm × MM_TO_PT
 *     ptY  = pageHeight_pt − (y_mm × MM_TO_PT) − height_pt
 *             (flip Y, then move up by the field height so the origin is
 *              the top-left of the field rather than the bottom-left)
 *
 * Layout inside the field:
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [signature image — top portion if provided]          │
 *   │ [typed name  — bottom band, always shown]            │
 *   └──────────────────────────────────────────────────────┘
 *   • If no image is provided, the name fills the whole field.
 *   • If no name is provided, the image fills the whole field.
 *   • A thin separator line is drawn between image and name bands.
 *   • A single-pixel border is drawn around the entire field so the
 *     Admin-defined box is always visible in the finished document.
 */

'use strict';

const { PDFDocument, rgb, StandardFonts, LineCapStyle } = require('pdf-lib');

// ── Constants ────────────────────────────────────────────────────────────────

/** Points per millimetre (1 inch = 25.4 mm = 72 pt → 72/25.4 ≈ 2.8346). */
const MM_TO_PT = 72 / 25.4;

/** A4 page dimensions in points (ISO 216). */
const A4_WIDTH_PT  = 210 * MM_TO_PT; // 595.28 pt
const A4_HEIGHT_PT = 297 * MM_TO_PT; // 841.89 pt

/** Minimum name band height in points. */
const MIN_NAME_BAND_PT = 14;

/** Font size for the typed name inside the field. */
const NAME_FONT_SIZE = 11;

/** Colour of the field border and name text. */
const BORDER_COLOR = rgb(0.059, 0.153, 0.278); // #0F2747 — matches app brand
const TEXT_COLOR   = BORDER_COLOR;
const LINE_COLOR   = rgb(0.886, 0.910, 0.941); // #E2E8F0 — light separator

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parses a base64 data URL into a raw Buffer and its MIME type.
 * Accepts either:
 *   "data:image/png;base64,<b64>"
 *   "data:image/jpeg;base64,<b64>"
 *   "<b64>"   (bare base64, assumed PNG)
 *
 * Throws if the string does not look like a supported image.
 */
function parseBase64Image(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('signatureEmbedder: signature_photo must be a non-empty string.');
  }

  const dataUrlMatch = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (dataUrlMatch) {
    const mime   = dataUrlMatch[1].toLowerCase().replace('image/', '');
    const buffer = Buffer.from(dataUrlMatch[2], 'base64');
    return { buffer, mime: mime === 'jpg' ? 'jpeg' : mime };
  }

  // Bare base64 (no data-URL prefix) — assume PNG.
  // Strip any whitespace that could survive JSON serialisation.
  const clean = dataUrl.replace(/\s/g, '');
  return { buffer: Buffer.from(clean, 'base64'), mime: 'png' };
}

/**
 * Returns the pdf-lib page height in points for a given PDFPage.
 * Falls back to A4 if the page size cannot be determined.
 */
function pageHeightPt(page) {
  try {
    const { height } = page.getSize();
    return height > 0 ? height : A4_HEIGHT_PT;
  } catch {
    return A4_HEIGHT_PT;
  }
}

/**
 * Returns the pdf-lib page width in points for a given PDFPage.
 * Falls back to A4 if the page size cannot be determined.
 */
function pageWidthPt(page) {
  try {
    const { width } = page.getSize();
    return width > 0 ? width : A4_WIDTH_PT;
  } catch {
    return A4_WIDTH_PT;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embeds a signature (typed name and/or image) into an existing PDF buffer at
 * the exact position defined by the Admin's signatureField configuration.
 *
 * @param {Buffer}   pdfBuffer      Existing PDF file bytes (from fs.readFileSync).
 * @param {object}   signatureField Admin-defined field config from workflow_config.
 *   @param {number}  signatureField.page    1-indexed page number.
 *   @param {number}  signatureField.x       Distance from page left edge in mm.
 *   @param {number}  signatureField.y       Distance from page top edge in mm.
 *   @param {number}  signatureField.width   Field width in mm.
 *   @param {number}  signatureField.height  Field height in mm.
 * @param {string|null} signatureName   Typed name string, or null/empty to omit.
 * @param {string|null} signaturePhoto  Base64 data URL of the signature image, or null.
 *
 * @returns {Promise<Buffer>}  New PDF buffer with the signature embedded.
 *
 * @throws If neither name nor photo is provided, or if pdf-lib parsing fails.
 */
async function embedSignatureIntoPdf(pdfBuffer, signatureField, signatureName, signaturePhoto) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('signatureEmbedder: pdfBuffer must be a Buffer.');
  }
  if (!signatureField || typeof signatureField !== 'object') {
    throw new Error('signatureEmbedder: signatureField config is required.');
  }

  const hasName  = !!(signatureName && String(signatureName).trim());
  const hasPhoto = !!signaturePhoto;

  if (!hasName && !hasPhoto) {
    throw new Error('signatureEmbedder: at least one of signatureName or signaturePhoto must be provided.');
  }

  // ── Parse field dimensions ──────────────────────────────────────────────────
  const pageIndex = Math.max(0, (Number(signatureField.page) || 1) - 1); // 0-indexed
  const fieldXMm  = Number(signatureField.x)      || 20;
  const fieldYMm  = Number(signatureField.y)       || 240;
  const fieldWMm  = Number(signatureField.width)   || 80;
  const fieldHMm  = Number(signatureField.height)  || 24;

  // Convert to points
  const fieldXPt = fieldXMm * MM_TO_PT;
  const fieldWPt = fieldWMm * MM_TO_PT;
  const fieldHPt = fieldHMm * MM_TO_PT;

  // ── Load PDF ────────────────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages  = pdfDoc.getPages();

  // Guard: if the requested page doesn't exist, use the last page.
  const targetPage = pages[Math.min(pageIndex, pages.length - 1)];
  const pgHeight   = pageHeightPt(targetPage);

  // Convert Y from top-left (CSS) to bottom-left (PDF points).
  // fieldYMm is the distance of the top edge of the field from the page top.
  // In pdf-lib: origin is bottom-left → bottom of field = pgHeight - (y + h) * MM_TO_PT
  const fieldYPt = pgHeight - (fieldYMm * MM_TO_PT) - fieldHPt;

  // ── Embed image (if provided) ────────────────────────────────────────────────
  let embeddedImage = null;
  if (hasPhoto) {
    try {
      const { buffer: imgBuf, mime } = parseBase64Image(signaturePhoto);
      embeddedImage = mime === 'png'
        ? await pdfDoc.embedPng(imgBuf)
        : await pdfDoc.embedJpg(imgBuf);
    } catch (imgErr) {
      // Image embedding failed (corrupt/unsupported format). Fall back to name-only.
      console.warn('[signatureEmbedder] Could not embed signature photo (falling back to name only):', imgErr.message);
      embeddedImage = null;
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────────────
  // Determine how to split the field between image and name bands.
  const useImage = !!(embeddedImage);
  const useName  = hasName;

  // Name band height: enough to hold the font at NAME_FONT_SIZE with top/bottom padding.
  const nameBandPt = useName ? Math.max(MIN_NAME_BAND_PT, NAME_FONT_SIZE + 6) : 0;
  // Image band gets the remainder (or the full field if no name).
  const imageBandPt = useImage ? (fieldHPt - nameBandPt - (useName ? 1 : 0)) : 0;

  // Y positions inside the field (all in pdf-lib's bottom-up coordinate space)
  const fieldTopPt = fieldYPt + fieldHPt; // top edge in pt (bottom-up)

  // ── Draw field border ─────────────────────────────────────────────────────
  targetPage.drawRectangle({
    x:           fieldXPt,
    y:           fieldYPt,
    width:       fieldWPt,
    height:      fieldHPt,
    borderColor: BORDER_COLOR,
    borderWidth: 0.75,
    color:       rgb(1, 1, 1), // white fill so the field is clearly bounded
    opacity:     1,
    borderOpacity: 1,
  });

  // ── Draw signature image ───────────────────────────────────────────────────
  if (useImage && imageBandPt > 0) {
    const padding = 3; // pt padding inside image band
    const imgDrawW = fieldWPt - padding * 2;
    const imgDrawH = imageBandPt - padding * 2;

    if (imgDrawW > 0 && imgDrawH > 0) {
      // Scale image to fit within the band while preserving aspect ratio.
      const { width: naturalW, height: naturalH } = embeddedImage;
      const scale = Math.min(imgDrawW / naturalW, imgDrawH / naturalH);
      const drawW = naturalW * scale;
      const drawH = naturalH * scale;

      // Centre the image horizontally and vertically within the image band.
      const imgBandBottomPt = useName ? (fieldYPt + nameBandPt + 1) : fieldYPt;
      const centreX = fieldXPt + (fieldWPt - drawW) / 2;
      const centreY = imgBandBottomPt + (imageBandPt - drawH) / 2;

      targetPage.drawImage(embeddedImage, {
        x:      centreX,
        y:      centreY,
        width:  drawW,
        height: drawH,
      });
    }
  }

  // ── Draw separator line between image and name bands ──────────────────────
  if (useImage && useName) {
    const separatorY = fieldYPt + nameBandPt;
    targetPage.drawLine({
      start:     { x: fieldXPt,             y: separatorY },
      end:       { x: fieldXPt + fieldWPt,  y: separatorY },
      thickness: 0.5,
      color:     LINE_COLOR,
    });
  }

  // ── Draw typed name ────────────────────────────────────────────────────────
  if (useName) {
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const nameStr = String(signatureName).trim();

    // Truncate name if it overflows the field width (leave 4 pt margin each side).
    const maxNameWidth = fieldWPt - 8;
    let displayName = nameStr;
    let fontSize = NAME_FONT_SIZE;

    // Reduce font size if the name is too wide (down to 7pt minimum).
    while (fontSize > 7 && font.widthOfTextAtSize(displayName, fontSize) > maxNameWidth) {
      fontSize -= 0.5;
    }
    // If still too wide at minimum font size, truncate with ellipsis.
    if (font.widthOfTextAtSize(displayName, fontSize) > maxNameWidth) {
      while (displayName.length > 1 && font.widthOfTextAtSize(displayName + '…', fontSize) > maxNameWidth) {
        displayName = displayName.slice(0, -1);
      }
      displayName += '…';
    }

    // Vertically centre the text within the name band.
    const textHeight = font.heightAtSize(fontSize);
    const nameBandBottomPt = fieldYPt;
    const textY = nameBandBottomPt + (nameBandPt - textHeight) / 2;

    // Horizontally centre the name within the field.
    const textWidth = font.widthOfTextAtSize(displayName, fontSize);
    const textX = fieldXPt + (fieldWPt - textWidth) / 2;

    targetPage.drawText(displayName, {
      x:        textX,
      y:        textY,
      size:     fontSize,
      font,
      color:    TEXT_COLOR,
    });
  }

  // ── Serialise and return ──────────────────────────────────────────────────
  const modifiedBytes = await pdfDoc.save();
  return Buffer.from(modifiedBytes);
}

module.exports = { embedSignatureIntoPdf };
