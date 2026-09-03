const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const templateRoutes = require('./routes/templateRoutes');
const dataSourceRoutes = require('./routes/dataSourceRoutes');
const externalDbRoutes = require('./routes/externalDbRoutes');
const documentRoutes = require('./routes/documentRoutes');
const signatureRoutes = require('./routes/signatureRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const publicRoutes = require('./routes/publicRoutes');
const auditRoutes = require('./routes/auditRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

// Must be the very first middleware: if a client disconnects mid-request (slow/large
// upload, page navigated away, network drop — increasingly likely now that the
// template editor can embed sizeable base64 images in header/body/footer HTML), the
// socket emits 'error' (e.g. ECONNRESET) when a later handler tries to write to it.
// With no listener, Node treats that as an unhandled error and crashes the ENTIRE
// process — taking the whole server down for every user, not just the one request
// that was interrupted. Attaching a no-op listener here means a dropped connection is
// just logged and the response quietly abandoned, like any other API should behave.
app.use((req, res, next) => {
  req.on('error', (err) => console.error('[request socket error]', err.code || err.message));
  res.on('error', (err) => console.error('[response socket error]', err.code || err.message));
  next();
});

// CORS: allow the configured CLIENT_URL, localhost:5173 (Vite default), and any
// private LAN IP (192.168.x.x / 10.x.x.x / 172.16-31.x.x) so that dev machines
// on the same network can reach the backend without CORS blocks.
const ALLOWED_ORIGINS = new Set(
  [
    process.env.CLIENT_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter(Boolean)
);

function isLanOrigin(origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return (
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch { return false; }
}

app.use(cors({
  origin(origin, cb) {
    // Allow same-origin requests (origin === undefined) and Vite dev proxy
    // (which strips the origin header), plus the explicit allow-list and LAN IPs.
    if (!origin || ALLOWED_ORIGINS.has(origin) || isLanOrigin(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  // Without this, fetch() in the frontend (a different origin) can't read the
  // Content-Disposition header on file-download responses — see documentService
  // .download / .viewUrl and every other blob-download helper that parses filenames.
  exposedHeaders: ['Content-Disposition'],
}));
// Bumped from 10mb: the rich-text editor can embed several logo/signature/inline
// images as base64 data URLs directly in header_html/body_html/footer_html, which
// inflates the JSON payload well past what plain HTML+placeholders ever needed.
app.use(express.json({ limit: '30mb' }));

// FR-008: uploaded logos are branding assets, safe to serve statically (unlike generated docs — NFR-002)
app.use('/uploads/logos', express.static(path.join(__dirname, '..', 'storage', 'logos')));
// Profile photos are likewise safe to serve statically — public-facing account assets, not documents.
app.use('/uploads/avatars', express.static(path.join(__dirname, '..', 'storage', 'avatars')));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'API is up.' });
});

// Public routes (no auth) — must be mounted before any global auth middleware, if one is ever added
app.use('/api', publicRoutes); // GET /api/deliver/download, POST /api/verify, /api/secure-delivery/*, /api/verify-qr/:id

app.use('/api/auth', authRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/data-sources', dataSourceRoutes);
// Commercial-tier external database connections (MongoDB/PostgreSQL/SQLite) — was fully
// implemented (controller, routes, safety guard against the internal doc_automation DB)
// but never actually mounted, so every /api/external-db/* call was 404ing.
app.use('/api/external-db', externalDbRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/signatures', signatureRoutes);
app.use('/api', deliveryRoutes); // POST /api/documents/:id/deliver, /secure-link, /secure-delivery, PATCH /hand-delivered, /revoke
app.use('/api', auditRoutes);    // /api/audit-logs, /api/dashboard/kpis, /api/reports/monthly, /api/documents/search
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Central error handler — guarantees JSON errors, never leaks a stack trace or HTML error page
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
});

module.exports = app;
