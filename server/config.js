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
  // Postings von Florian Homm aus Free Homes (siehe server/homm.js)
  freehomesFeed: {
    base: env('FREEHOMES_APP_URL', 'https://app.free-homes.de').replace(/\/$/, ''),
    category: env('FREEHOMES_FEED_CATEGORY', 'florian-homm'),
    author: env('FREEHOMES_FEED_AUTHOR', 'homm').toLowerCase(),   // nur Beiträge dieses Autors, leer = alle der Kategorie
    token: env('FREEHOMES_FEED_TOKEN', ''),                        // fester Zugangsschlüssel (Bearer), falls Free Homes einen ausstellt
    user: env('FREEHOMES_FEED_USER', ''),                          // oder: Free-Homes-Konto, mit dem die Arena die Postings liest
    pass: env('FREEHOMES_FEED_PASS', ''),
    clientId: env('FREEHOMES_FEED_CLIENT_ID', 'public-client'),
    clientSecret: env('FREEHOMES_FEED_CLIENT_SECRET', ''),
  },
  freehomesNewsUrl: env('FREEHOMES_NEWS_URL', ''),                 // ersatzweise ein RSS/Atom/JSON-Feed
  boersenbriefUrl: env('BOERSENBRIEF_URL', 'https://homm-longshort.com/'),
  freehomes: {
    issuer: env('FREEHOMES_ISSUER', 'https://keycloak.free-homes.de/realms/freehomes'),
    clientId: env('FREEHOMES_CLIENT_ID', ''),
    clientSecret: env('FREEHOMES_CLIENT_SECRET', ''),
    get enabled() { return !!this.clientId; },
  },
};
