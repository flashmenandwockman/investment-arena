// Beispiel-Community für die Demo: Trader-Profile mit Depots und drei Community-Fonds.
// Wird beim ersten Start angelegt. Auf Wunsch per SEED_BOTS=0 abschaltbar.
const db = require('./db');
const market = require('./market');
const game = require('./game');
const store = require('./store');
const funds = require('./funds');

const PEOPLE = [
  {n:'Lena K.', bio:'Studentin, 19 · Krypto & Tech', c:'#8fd3ff', pos:[['SOL/EUR',1,'lev',3,14000,.06],['NVDA',1,'stock',1,20000,-.03],['ETH/EUR',1,'stock',1,12000,.04]], b:['streak','lev']},
  {n:'Werner B.', bio:'Privatinvestor, 61 · Dividenden', c:'#f3e2bd', pos:[['ALV.DE',1,'stock',1,30000,-.05],['SIE.DE',1,'stock',1,25000,-.02],['^GDAXI',-1,'option','put',4000]], b:['opt','stop']},
  {n:'Aylin S.', bio:'Ingenieurin, 34 · Hebel-Trader', c:'#ffb38a', pos:[['^GSPC',1,'lev',10,8000,-.015],['TSLA',-1,'lev',5,6000,.02],['RHM.DE',1,'stock',1,15000,-.08]], b:['lev','short']},
  {n:'Marco D.', bio:'Azubi, 18 · Krypto', c:'#b7a6ff', pos:[['DOGE/EUR',1,'lev',5,5000,-.05],['BTC/EUR',1,'stock',1,30000,.03],['XRP/EUR',1,'stock',1,10000,-.06]], b:['crypto']},
  {n:'Dr. Petra H.', bio:'Ärztin, 52 · Absicherung', c:'#a6f0c6', pos:[['MSFT',1,'stock',1,25000,-.04],['AAPL',1,'stock',1,20000,-.05],['^GSPC',-1,'option','put',5000],['GC=F',1,'stock',1,10000,-.03]], b:['opt','stop']},
  {n:'Jonas W.', bio:'BWL-Student, 22 · Short-Seller', c:'#ff9aa8', pos:[['TSLA',-1,'stock',1,12000,.03],['DBK.DE',-1,'lev',3,6000,-.04],['AMZN',1,'option','call',3000]], b:['short','profit']},
  {n:'Helmut R.', bio:'Rentner, 67 · Gold & DAX', c:'#e0c28a', pos:[['GC=F',1,'stock',1,40000,-.06],['^GDAXI',1,'stock',1,30000,-.03]], b:['first']},
  {n:'Sophie L.', bio:'Marketing, 28 · Index & Krypto', c:'#9fe3e0', pos:[['^GSPC',1,'stock',1,35000,-.02],['BTC/EUR',1,'stock',1,15000,-.04],['SAP.DE',1,'lev',2,8000,-.05]], b:['crypto','lev']},
  {n:'Kemal Y.', bio:'Unternehmer, 45 · Makro', c:'#ffd48a', pos:[['^GDAXI',-1,'lev',5,10000,.01],['GC=F',1,'lev',3,10000,-.04],['NVDA',-1,'option','put',4000]], b:['lev','short','manager']},
];
const FUNDS = [
  {owner:'Lena K.', name:'KI-Rakete', strategy:'Die Gewinner der KI-Welle plus etwas Krypto. Hohes Risiko, hohe Fantasie.',
   holdings:[['NVDA',1,35],['MSFT',1,25],['AMZN',1,20],['ETH/EUR',1,20]], age:21},
  {owner:'Werner B.', name:'Dividenden-Festung', strategy:'Solide Dividendenzahler aus Deutschland und den USA, dazu Gold als Versicherung.',
   holdings:[['ALV.DE',1,30],['SIE.DE',1,20],['SAP.DE',1,20],['MSFT',1,15],['GC=F',1,15]], age:35},
  {owner:'Kemal Y.', name:'Makro-Hedge Long/Short', strategy:'Long Qualität, short Überbewertung. Verdient im Idealfall in beide Richtungen.',
   holdings:[['MSFT',1,25],['GC=F',1,20],['SAP.DE',1,15],['TSLA',-1,20],['DBK.DE',-1,20]], age:14},
];

const qBots = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 1');
const qIns = db.prepare("INSERT INTO users (email, name, pass, provider, provider_sub, bio, color, is_bot, created_at) VALUES (NULL, ?, NULL, 'bot', ?, ?, ?, 1, ?)");
const qFund = db.prepare('INSERT INTO funds (owner_id, name, strategy, holdings, created_at) VALUES (?, ?, ?, ?, ?)');

function seed() {
  if (process.env.SEED_BOTS === '0' || qBots.get().n > 0) return;
  const q = market.get(), fx = market.fx(), ids = {};
  PEOPLE.forEach((pp, i) => {
    const id = Number(qIns.run(pp.n, `bot-${i}`, pp.bio, pp.c, Date.now()).lastInsertRowid); ids[pp.n] = id;
    const st = game.fresh(); st.mode = 'pro'; pp.b.forEach(b => { st.badges[b] = true; st.xp += 25; });
    pp.pos.forEach(([sym, dir, kind, x, stake, off = 0], j) => {
      const Q = q[sym]; if (!Q) return;
      const eur = v => Q.cur === 'USD' ? v / fx : v, P = Q.price;
      const p = {id: `b${i}${j}`, sym, dir, kind, stake, openedTs: Date.now() - (3 + j * 2) * 864e5};
      if (kind === 'option') { p.opt = x; p.strike = game.roundK(P * (x === 'call' ? 1.05 : .95)); p.expiryTs = Date.now() + 60 * 864e5; p.entry = P; p.units = stake / eur(game.bs(P, p.strike, 60 / 365, game.vol(sym), x)); }
      else { p.lev = x; p.entry = P * (1 + off); p.units = stake * x / eur(p.entry); if (kind === 'lev') p.ko = p.entry * (1 - dir / x); }
      st.cash -= stake; st.pos.push(p);
    });
    store.save(id, st);
  });
  // Fonds mit Einstiegskursen aus der Vergangenheit, damit die Demo eine Entwicklung zeigt
  FUNDS.forEach(f => {
    const hs = f.holdings.filter(([s]) => q[s]).map(([sym, dir, w]) => {
      const h = q[sym].hist || [], p0 = h[Math.max(0, h.length - 1 - f.age)] || q[sym].price;
      return {sym, dir, w, p0};
    });
    qFund.run(ids[f.owner], f.name, f.strategy, JSON.stringify(hs), Date.now() - f.age * 864e5);
  });
  // Einige Bots investieren in die Fonds
  const list = funds.list();
  [['Sophie L.', 0, 8000], ['Helmut R.', 1, 10000], ['Dr. Petra H.', 2, 6000], ['Marco D.', 0, 4000]].forEach(([n, k, amt]) => {
    const f = list[k]; if (!f) return; const st = store.load(ids[n]), nav = funds.navOf(f.id);
    st.cash -= amt; st.pos.push({id: `f${ids[n]}${f.id}`, kind: 'fund', fundId: f.id, fundName: f.name, dir: 1, stake: amt, units: amt / nav, entry: nav, openedTs: Date.now() - 2 * 864e5});
    store.save(ids[n], st);
  });
}

module.exports = {seed};
