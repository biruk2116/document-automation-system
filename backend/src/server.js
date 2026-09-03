const app = require('./app');
const { verifyConnection, ensureSchema } = require('./config/db');
const { startScheduler } = require('./utils/scheduler');
const { checkUnicodeFontsAvailable } = require('./utils/pdfGenerator');
require('dotenv').config();

// Last-resort safety net: without these, ANY unexpected async error anywhere in the
// app crashes the entire Node process and takes the server down for every user.
process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err);
});
process.on('uncaughtException', (err) => {
  // EADDRINUSE: give a clear, actionable message instead of a raw stack trace,
  // then exit so nodemon can restart cleanly once the port is freed.
  if (err.code === 'EADDRINUSE') {
    const port = err.port || process.env.PORT || 5000;
    console.error(`\n[server] ERROR: Port ${port} is already in use.`);
    console.error(`[server] To fix: run the following in a NEW terminal, then restart:\n`);
    console.error(`  Windows PowerShell:\n  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess -Force\n`);
    console.error(`  Or change PORT= in .env to an unused port (e.g. PORT=5001).\n`);
    process.exit(1);
  }
  console.error('[uncaught exception]', err);
});

const PORT = process.env.PORT || 5000;

(async () => {
  await verifyConnection();
  await ensureSchema();

  const server = app.listen(PORT, () => {
    console.log(`\n✅ [server] Running on http://localhost:${PORT}`);
    console.log(`   Frontend: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  // Graceful shutdown on Ctrl+C / nodemon restart
  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received — shutting down gracefully…`);
    server.close(() => {
      console.log('[server] Closed. Bye.\n');
      process.exit(0);
    });
    // Force-exit after 5s if connections don't drain
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  startScheduler();
  checkUnicodeFontsAvailable(); // fire-and-forget diagnostic, never blocks boot
})();
