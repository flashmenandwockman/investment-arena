// Admin-Rechte vergeben oder entziehen (für die Pflege des TRCM-Portfolios)
//   node scripts/admin.js list
//   node scripts/admin.js grant  name@beispiel.de
//   node scripts/admin.js revoke name@beispiel.de
// Im Docker-Betrieb: docker compose exec app node scripts/admin.js grant name@beispiel.de
// Das Konto muss vorher in der Arena registriert sein (eigenes Konto oder Login über Free Homes).
const db = require('../server/db');

const [cmd, email] = process.argv.slice(2);
const find = db.prepare('SELECT id, name, email, provider, role FROM users WHERE lower(email) = lower(?)');
const set = db.prepare('UPDATE users SET role = ? WHERE id = ?');

if (cmd === 'list') {
  const rows = db.prepare("SELECT name, email, provider FROM users WHERE role = 'admin' ORDER BY name").all();
  console.log(rows.length ? rows.map(r => `${r.name} <${r.email || '–'}> (${r.provider})`).join('\n') : 'Keine Admins.');
} else if ((cmd === 'grant' || cmd === 'revoke') && email) {
  const u = find.get(email.trim());
  if (!u) { console.error(`Kein Konto mit ${email}. Bitte zuerst in der Arena registrieren.`); process.exit(1); }
  set.run(cmd === 'grant' ? 'admin' : '', u.id);
  console.log(`${u.name} <${u.email}> ist ${cmd === 'grant' ? 'jetzt Admin' : 'kein Admin mehr'}.`);
} else {
  console.log('Verwendung: node scripts/admin.js list | grant <E-Mail> | revoke <E-Mail>');
  process.exit(1);
}
