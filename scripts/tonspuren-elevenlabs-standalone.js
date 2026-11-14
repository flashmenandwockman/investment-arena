// Tonspuren fuer die Investment Arena mit Florian Homm (ElevenLabs)
// Voraussetzung: Node.js 18 oder neuer (https://nodejs.org). Keine weiteren Pakete noetig.
//
// Aufruf (Mac/Linux):
//   ELEVENLABS_API_KEY=xi-... ELEVENLABS_VOICE_ID=... node tonspuren-elevenlabs.js
// Aufruf (Windows PowerShell):
//   $env:ELEVENLABS_API_KEY="xi-..."; $env:ELEVENLABS_VOICE_ID="..."; node tonspuren-elevenlabs.js
//
// Optionen:  --dry (nur anzeigen, keine Kosten)   --force (vorhandene Dateien neu erzeugen)
//            --only welcome,short (nur diese Dateien)   --out ordner (Zielordner, Standard ./tonspuren)
// Optional:  ELEVENLABS_MODEL (Standard eleven_multilingual_v2), ELEVENLABS_STABILITY (0.55),
//            ELEVENLABS_SIMILARITY (0.8), ELEVENLABS_STYLE (0.15)
//
// Ergebnis: 33 MP3-Dateien (44,1 kHz, 128 kbit/s) im Zielordner. Bitte den ganzen Ordner (oder als ZIP) zuruecksenden.
// Die Dateinamen duerfen nicht geaendert werden, die App erkennt die Dateien am Namen.
const fs = require("fs"), path = require("path");

const TEXTE = {
  "welcome": "Willkommen in meiner Investment Arena. Sie haben 100.000 Euro Spielgeld. Hier dürfen Sie die Fehler machen, die im echten Leben ein Vermögen kosten. Tippen Sie auf einen Wert und probieren Sie es aus.",
  "welcomePro": "Sie kennen das Spiel. Hier haben Sie Optionen, Hebel bis zwanzigfach und echte Kurse. Zeigen Sie der Community, wie man auch in fallenden Märkten verdient.",
  "long": "Long heißt: Sie setzen auf steigende Kurse. Ihr Risiko ist der Einsatz, Ihre Chance ist nach oben offen. So handeln die meisten Anleger – und genau deshalb lohnt es sich, auch die andere Seite zu verstehen.",
  "short": "Short heißt: Sie setzen auf fallende Kurse. Sie verkaufen etwas, das Sie sich geliehen haben, und kaufen es später hoffentlich billiger zurück. Vorsicht: Steigt der Kurs, ist Ihr Verlust theoretisch unbegrenzt.",
  "stock": "Direkt investiert: kein Hebel, kein Verfallstag. Klingt langweilig – aber so überlebt man an der Börse. Beim Short leihen Sie sich den Wert und zahlen dafür eine kleine Leihgebühr.",
  "crypto": "Krypto handelt rund um die Uhr und schwankt oft fünfmal so stark wie eine Aktie. Das macht Spaß, solange die Position klein ist. Setzen Sie hier nur, was Sie auch ganz verlieren könnten.",
  "lev": "Ein Hebel vervielfacht Gewinn und Verlust. Bei Hebel fünf reicht ein Minus von zwanzig Prozent, und Ihr Einsatz ist weg. Ein Hebel ist kein Turbo, sondern ein Messer. Und er kostet jeden Tag Finanzierungszinsen.",
  "call": "Ein Call ist das Recht, zu einem festen Preis zu kaufen. Er gewinnt, wenn der Kurs deutlich über den Basispreis steigt. Mehr als die Prämie können Sie nicht verlieren – aber die Zeit arbeitet gegen Sie, jeden einzelnen Tag.",
  "put": "Ein Put ist das Recht, zu einem festen Preis zu verkaufen. Er gewinnt, wenn der Kurs fällt. Profis nutzen Puts vor allem als Versicherung für ihr Depot. Ihr maximaler Verlust ist die gezahlte Prämie.",
  "otm": "Je weiter aus dem Geld, desto billiger die Option – und desto unwahrscheinlicher, dass sie sich lohnt. Billig ist nicht dasselbe wie günstig.",
  "size": "Setzen Sie nie mehr als fünf bis zehn Prozent Ihres Depots auf eine einzige Idee. Viele, die pleitegegangen sind, lagen gar nicht falsch. Sie waren nur zu groß positioniert.",
  "forex": "Devisen sind der größte Markt der Welt: Jeden Tag werden Billionen gehandelt, rund um die Uhr. Die Kurse bewegen sich oft nur um Zehntelprozent, deshalb gibt es hier Hebel von dreißig bis zweihundert. Bei Hebel zweihundert reicht ein halbes Prozent gegen Sie, und der Einsatz ist weg. Profis handeln Devisen mit kleinen Positionen, engem Stop und einer klaren Meinung zu Zinsen und Notenbanken. Für Privatanleger in der EU sind dreißig erlaubt, mehr bekommen nur Profis. Üben Sie hier, was Sie dort nie ohne Plan tun sollten.",
  "stop": "Ein Stop-Loss ist Ihre Notbremse. Legen Sie fest, wie viel Sie verlieren wollen, bevor Sie kaufen – nicht danach, wenn die Gefühle mitreden.",
  "live": "Ihre Position läuft jetzt mit dem echten Markt. Alle in der Arena sehen dieselben Kurse. Schauen Sie morgen wieder rein – und bei Optionen denken Sie daran: Die Zeit frisst jeden Tag ein Stück vom Wert.",
  "margin": "Nachschussalarm! Eine Hebelposition hat drei Viertel ihres Einsatzes verloren. Merken Sie sich dieses Gefühl. Genau hier treffen die meisten ihre schlechtesten Entscheidungen.",
  "knock": "Knock-out. Die Position ist ausgelöscht. Bei einem Hebel ist das kein Pech, sondern Mathematik.",
  "profit": "Gewinne mitzunehmen ist keine Schande. Niemand ist je pleitegegangen, weil er zu früh Gewinne realisiert hat.",
  "loss": "Ein Verlust ist Lehrgeld – solange er klein bleibt. Fragen Sie sich ehrlich: War das eine Idee oder eine Hoffnung?",
  "insider": "Insider verkaufen aus hundert Gründen: Steuern, Hauskauf, Scheidung. Aber sie kaufen nur aus einem einzigen Grund. Ein Insiderkauf mit eigenem Geld ist das stärkste Signal, das ich kenne. Verkäufe dagegen nehme ich ernst, wenn viele gleichzeitig verkaufen.",
  "analyst": "Wenn alle Analysten Kaufen sagen, frage ich mich zuerst: Wer soll eigentlich noch kaufen? Der Konsens ist meistens schon im Kurs. Interessant wird es, wenn die Zahlen anders aussehen als die Meinung.",
  "earnings": "Quartalszahlen sind der Moment der Wahrheit. Entscheidend ist nicht, ob ein Unternehmen Gewinn macht, sondern ob es die Erwartungen schlägt. Vor den Zahlen eine große Position aufzubauen, ist eher Zocken als Investieren.",
  "volume": "Ungewöhnlich hohes Volumen heißt: Irgendjemand weiß etwas oder glaubt, etwas zu wissen. Das ist kein Kaufsignal, sondern ein Grund, genauer hinzuschauen.",
  "radar": "Das ist mein Radar. Hier sehen Sie, was Insider tun, was Analysten erwarten und wo es bald Zahlen gibt. Profis schauen zuerst hierhin und erst danach auf den Kurs.",
  "fundInvest": "Bevor Sie Geld in einen Fonds stecken, schauen Sie nicht nur auf die Rendite. Schauen Sie, wie der Manager denkt. Eine gute Strategie mit Pech ist mir lieber als eine schlechte mit Glück.",
  "fundCreate": "Ein guter Fonds ist kein Sammelsurium von Lieblingsaktien. Er hat eine klare Idee. Streuen Sie über mehrere Werte, setzen Sie keinem Einzelwert mehr als ein Viertel und denken Sie an eine Absicherung auf der Short-Seite.",
  "fundIntro": "Hier zeigt die Community, was sie kann. Jeder kann Fondsmanager werden. Die Besten stehen oben, und alle sehen, wer wirklich etwas vom Geschäft versteht.",
  "account": "Ihr Spielstand wird auf dem Server gespeichert. Sie können sich auf jedem Gerät anmelden und dort weitermachen.",
  "empty": "Noch keine Positionen. Ein guter Trader wartet auf die richtige Gelegenheit. Aber zum Lernen dürfen Sie hier ruhig einfach anfangen.",
  "arena": "Hier treten Sie gegen die Community an. Wichtig: Gewinnen kann man long wie short. Der Markt muss nicht steigen, damit Sie vorne liegen.",
  "profile": "Schauen Sie ruhig, was die Besten halten. Aber kopieren Sie nie blind. Verstehen Sie zuerst, warum jemand eine Position hat.",
  "arenas": "Am meisten lernen Sie im Vergleich mit Leuten, die Sie kennen. Eröffnen Sie eine Arena, schicken Sie den Link in Ihre Gruppe und schauen Sie, wer nach einem Monat vorne liegt.",
  "talents": "Ich suche keine Zocker. Ich suche Leute, die ihr Risiko im Griff haben. Wer das zeigt, kann sich bei meinem Analystenteam vorstellen.",
  "scouting": "Die ganze Nachricht „Scouting & Talents“ (Bereich Arena → Talente): Ich suche keine Zocker. Ich suche Talente. In der Arena sehe ich nicht nur, wer vorne liegt, sondern wie jemand dorthin gekommen ist. Wer sein Risiko im Griff hat, wer Verluste früh begrenzt und wer in einer schwachen Woche nicht die Nerven verliert, fällt mir auf. Die Besten jedes Quartals lade ich ein, sich meinem Analystenteam vorzustellen. Kein Lebenslauf, kein Titel, keine Bankausbildung nötig. Es zählen Ihre Zahlen und Ihre Begründung. Die größten Talente, die ich in meiner Laufbahn getroffen habe, kamen selten aus der Bankfiliale. Zeigen Sie mir, was Sie können.",
};

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ""; };
const only = opt("--only") ? opt("--only").split(",").map(s => s.trim()).filter(Boolean) : null;
const OUT = path.resolve(opt("--out") || "tonspuren");
const key = process.env.ELEVENLABS_API_KEY || "", voice = process.env.ELEVENLABS_VOICE_ID || "";
const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const settings = {stability: Number(process.env.ELEVENLABS_STABILITY || 0.55), similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY || 0.8), style: Number(process.env.ELEVENLABS_STYLE || 0.15), use_speaker_boost: true};

async function synth(text) {
  const r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice) + "?output_format=mp3_44100_128", {
    method: "POST", headers: {"xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg"},
    body: JSON.stringify({text, model_id: model, language_code: "de", voice_settings: settings}),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error("ElevenLabs " + r.status + ": " + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  const rows = Object.entries(TEXTE).filter(([k]) => !only || only.includes(k));
  if (!rows.length) { console.error("Keine Texte gewaehlt (--only pruefen)."); process.exit(1); }
  fs.mkdirSync(OUT, {recursive: true});
  const todo = rows.filter(([k]) => flag("--force") || !fs.existsSync(path.join(OUT, k + ".mp3")));
  const zeichen = todo.reduce((n, [, t]) => n + t.length, 0);
  console.log(rows.length + " Texte, " + todo.length + " zu erzeugen (" + zeichen + " Zeichen)" + (flag("--dry") ? " - Probelauf" : "") + ". Zielordner: " + OUT);
  if (flag("--dry")) { for (const [k, t] of todo) console.log("  " + k + ".mp3  (" + t.length + " Zeichen)"); return; }
  if (!key || !voice) { console.error("Bitte ELEVENLABS_API_KEY und ELEVENLABS_VOICE_ID setzen."); process.exit(1); }
  let ok = 0;
  for (const [k, t] of todo) {
    process.stdout.write("  " + k + ".mp3 ... ");
    try { const buf = await synth(t); fs.writeFileSync(path.join(OUT, k + ".mp3"), buf); ok++; console.log(Math.round(buf.length / 1024) + " KB"); }
    catch (e) { console.log("FEHLER " + e.message); }
    await new Promise(res => setTimeout(res, 400));
  }
  console.log("Fertig: " + ok + " von " + todo.length + " Dateien in " + OUT + ". Bitte den Ordner als ZIP zuruecksenden.");
})();
