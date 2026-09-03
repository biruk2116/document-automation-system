# Unicode fonts for PDF generation (Arabic / Amharic / Chinese / etc.)

Puppeteer's PDF output is only as good as the fonts installed on the **machine or
container that actually runs headless Chromium** — the app ships CSS font-family
rules (see `src/utils/documentAssembler.js`), but it does not, and cannot, bundle the
font *files* themselves. If the right font packages aren't installed on the host,
non-Latin text (Arabic, Amharic/Ge'ez, Chinese/Japanese/Korean, Hebrew, Devanagari,
etc.) will render as blank boxes ("tofu") or empty space in the generated PDF even
though the HTML/placeholder data is completely correct.

## Why "Noto Sans" alone isn't enough

The generic "Noto Sans" family only covers Latin, Cyrillic, Greek, and Vietnamese.
Google splits the rest of Noto's Unicode coverage into separate, script-specific
families — `Noto Sans Arabic`, `Noto Sans Ethiopic` (Amharic/Ge'ez), `Noto Sans SC`
(Simplified Chinese), etc. The app's PDF template now lists all of these explicitly in
its `font-family` stack, and Chromium resolves that stack **per character** — for
every glyph it walks the list and uses the first font that actually has it. That only
works if those font families are actually installed on the server.

## Install (Debian/Ubuntu — the common Docker base)

```bash
apt-get update && apt-get install -y \
  fonts-noto-core \
  fonts-noto-cjk \
  fonts-noto-color-emoji
```

- `fonts-noto-core` — Noto Sans/Serif for Latin, Arabic, Hebrew, Ethiopic (Amharic),
  Devanagari, and most other non-CJK scripts.
- `fonts-noto-cjk` — Chinese, Japanese, Korean (kept separate upstream because it's large).
- `fonts-noto-color-emoji` — optional, only needed if templates might include emoji.

## Install (Alpine — common in slim Docker images)

```sh
apk add --no-cache font-noto font-noto-cjk font-noto-ethiopic font-noto-arabic
```

(Package names vary slightly by Alpine version — `apk search noto` to confirm what's
available on the base image in use.)

## Verifying after install

Restart the backend. It runs a best-effort check on boot (see
`checkUnicodeFontsAvailable` in `src/utils/pdfGenerator.js`) and logs a warning naming
any of Arabic/Amharic/Chinese it can't find via `fc-list`. You can also check manually:

```bash
fc-list | grep -i "noto sans arabic"
fc-list | grep -i "noto sans ethiopic"
fc-list | grep -i "noto sans sc"
```

Each should print at least one matching font file. If a line prints nothing, that
script's font package isn't installed yet.

## Docker note

If this app runs in a container, the fonts must be installed **inside that container's
image** (add the `apt-get`/`apk` lines above to the Dockerfile) — installing fonts on
the host machine has no effect on what Chromium sees inside the container.
