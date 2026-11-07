// Zentrale Konfiguration aus Umgebungsvariablen (siehe .env.example)
const path = require('path');

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  port: Number(env('PORT', 8080)),
  baseUrl: env('BASE_URL', 'http://localhost:8080').replace(/\/$/, ''),
  dataDir: path.resolve(env('DATA_DIR', path.join(__dirname, '..', 'data'))),
  // true = keine externen Kursabrufe, nur die mitgelieferten Fallback-Daten (Tests, Offline-Demo)
  offline: env('MARKET_OFFLINE', '0') === '1',
  finnhubKey: env('FINNHUB_KEY', ''),
  // E-Mail-Adressen, die beim Login über Free Homes (bestätigte Adresse) Admin-Rechte erhalten
  adminEmails: env('ADMIN_EMAILS', '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
  // Großinvestoren aus den 13F-Meldungen der SEC. Die SEC verlangt einen aussagekräftigen User-Agent mit Kontakt.
  secUserAgent: env('SEC_USER_AGENT', 'InvestmentArena/1.0 (+https://www.investment-arena.com)'),
  gurus: env('GURUS', '1') !== '0',
  startCash: 100000,
  sessionDays: 30,
  demoUserDays: 7,
  // Login über Free Homes (Keycloak, OpenID Connect). Aktiv, sobald FREEHOMES_CLIENT_ID gesetzt ist.
  freehomes: {
    issuer: env('FREEHOMES_ISSUER', 'https://keycloak.free-homes.de/realms/freehomes'),
    clientId: env('FREEHOMES_CLIENT_ID', ''),
    clientSecret: env('FREEHOMES_CLIENT_SECRET', ''),
    get enabled() { return !!this.clientId; },
  },
};
