/**
 * FR-026: e-sign timestamps must be NTP-synced for legal defensibility — the
 * server's own clock shouldn't be the sole source of truth for a signing time.
 *
 * Production setup: install an NTP client (e.g. the `ntp-client` package) and
 * query a trusted time server (e.g. pool.ntp.org) here. Networked NTP lookups
 * aren't reachable from every deployment environment (firewalls, sandboxes),
 * so this module fails safe: try NTP if configured, fall back to system time,
 * and always tag the result so it's clear which source was used —
 * that provenance matters for the audit trail.
 */

let ntpClient = null;
try {
  // Optional dependency — only used if installed. Falls back gracefully if not.
  // eslint-disable-next-line global-require
  ntpClient = require('ntp-client');
} catch {
  ntpClient = null;
}

function getSystemTime() {
  return { timestamp: new Date(), source: 'system_clock' };
}

async function getSyncedTime(ntpServer = 'pool.ntp.org', ntpPort = 123, timeoutMs = 2000) {
  if (!ntpClient) {
    return getSystemTime();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(getSystemTime()), timeoutMs);
    try {
      ntpClient.getNetworkTime(ntpServer, ntpPort, (err, date) => {
        clearTimeout(timer);
        if (err || !date) {
          resolve(getSystemTime());
        } else {
          resolve({ timestamp: date, source: 'ntp' });
        }
      });
    } catch {
      clearTimeout(timer);
      resolve(getSystemTime());
    }
  });
}

module.exports = { getSyncedTime, getSystemTime };
