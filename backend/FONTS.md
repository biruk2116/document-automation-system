# Multilingual Unicode Font & Script Support (Amharic / Arabic / Chinese)

The document generation engine provides production-grade, multi-tiered support for **Amharic (Ethiopic)**, **Arabic (Right-to-Left)**, and **Chinese (Simplified & Traditional)**, as well as Hebrew, Japanese, Korean, and Devanagari.

---

## Architecture: Multi-Tiered Typography Engine

The system uses a 4-tier font resolution and layout strategy:

### 1. High-Fidelity Google Web Fonts CDN (Tier 1)
Inside [`src/utils/documentAssembler.js`](src/utils/documentAssembler.js), every generated HTML document embeds Google Fonts CDN stylesheets:
- `Noto Sans Ethiopic` (weights 400, 500, 600, 700) for Amharic and Ge'ez script.
- `Noto Sans Arabic` (weights 400, 500, 600, 700) & `Amiri` (weights 400, 700) for Arabic.
- `Noto Sans SC` & `Noto Sans TC` (weights 400, 500, 700) for Simplified and Traditional Chinese.
- `Noto Sans` for Latin, Greek, and Cyrillic.

When Puppeteer generates a PDF ([`src/utils/pdfGenerator.js`](src/utils/pdfGenerator.js)), it calls:
```javascript
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
});
```
This guarantees all web font glyphs are fully downloaded and compiled before the PDF is printed.

---

### 2. Multi-Platform Local System Font Fallbacks (Tier 2 - Offline / Zero-Latency)
If the server is offline, firewalled, or generating in an air-gapped environment, Chromium resolves glyphs per-character using native system fonts:

- **Amharic / Ethiopic**:
  - Windows: `Nyala` (preinstalled on all Windows versions), `Ebrima`.
  - macOS: `Kefa`.
  - Linux: `Noto Sans Ethiopic`, `Abyssinica SIL`.
- **Arabic**:
  - Windows: `Segoe UI`, `Tahoma`, `Arial`, `Traditional Arabic`, `Arabic Typesetting`.
  - macOS: `Geeza Pro`, `Damascus`.
  - Linux: `Noto Sans Arabic`, `Noto Naskh Arabic`, `Amiri`.
- **Chinese (Simplified & Traditional)**:
  - Windows: `Microsoft YaHei` (微软雅黑), `SimSun` (宋体), `SimHei` (黑体).
  - macOS: `PingFang SC`, `Hiragino Sans GB`, `Heiti SC`.
  - Linux: `Noto Sans SC`, `WenQuanYi Zen Hei`, `WenQuanYi Micro Hei`.

---

### 3. Bidirectional (BiDi) & RTL Layout Engine for Arabic (Tier 3)
Arabic requires both character shaping and right-to-left layout direction:
- **Automatic Paragraph Direction (`dir="auto"`)**: Injected automatically onto all block elements (`<p>`, `<h1>`–`<h6>`, `<li>`, `<td>`, `<th>`, `blockquote`) via `ensureAutoBidi()`.
- **Unicode BiDi Isolation**: `unicode-bidi: plaintext;` ensures mixed Arabic and English/numbers flow naturally.
- **RTL Alignment**: `[dir="auto"] { text-align: start; }` and `[dir="rtl"] { direction: rtl; text-align: right; }` align Arabic paragraphs to the right while keeping LTR text on the left.
- **Protected Technical Stamps**: `.qr-footer-row` is explicitly pinned to `direction: ltr !important;` so that verification QR codes do not invert positions.

---

### 4. Amharic Date & Calendar Localization (Tier 4)
- Dynamic placeholders available in templates:
  - `{{generation_date_gc}}`: Gregorian date (e.g. `September 24, 2026 G.C.`).
  - `{{generation_date_ec}}`: Ethiopian civil calendar in English transliteration (e.g. `Meskerem 14, 2018 E.C.`).
  - `{{generation_date_am}}` / `{{generation_date_ec_am}}`: Pure Amharic Ge'ez script date (e.g. `መስከረም 14 ቀን 2018 ዓ.ም.`).

---

## Installing Local System Fonts (For Offline Linux / Docker Deployments)

### Debian / Ubuntu / Render Docker:
```bash
apt-get update && apt-get install -y \
  fonts-noto-core \
  fonts-noto-cjk \
  fonts-noto-color-emoji
```

### Alpine Linux:
```sh
apk add --no-cache font-noto font-noto-cjk font-noto-ethiopic font-noto-arabic
```
