// Florians Tonspuren mit ElevenLabs erzeugen: liest alle Texte aus public/audio/AUFNAHMELISTE.md und legt
// je Text eine MP3 mit genau dem Dateinamen in public/audio/ ab. Die App erkennt die Dateien automatisch.
//
// Aufruf:  ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... node scripts/tts-elevenlabs.js [--force] [--only welcome,short] [--dry]
//   --force   vorhandene Dateien neu erzeugen
//   --only    nur diese Schlüssel (kommagetrennt, Dateiname ohne .mp3)
//   --dry     nur anzeigen, was erzeugt würde (kein Abruf, keine Kosten)
//
// ELEVENLABS_VOICE_ID ist die ID der geklonten Stimme von Florian Homm (ElevenLabs → Voices → Florian Homm → ID).
// Optional: ELEVENLABS_MODEL (Standard eleven_multilingual_v2), ELEVENLABS_STABILITY, ELEVENLABS_SIMILARITY, ELEVENLABS_STYLE.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIST = path.join(ROOT, 'public', 'audio', 'AUFNAHMELISTE.md');
const OUT = path.join(ROOT, 'public', 'audio');
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };
const only = opt('--only') ? opt('--only').split(',').map(s => s.trim()).filter(Boolean) : null;

const key = process.env.ELEVENLABS_API_KEY || '', voice = process.env.ELEVENLABS_VOICE_ID || '';
const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const settings = {stability: Number(process.env.ELEVENLABS_STABILITY || 0.55), similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY || 0.8), style: Number(process.env.ELEVENLABS_STYLE || 0.15), use_speaker_boost: true};

// Zeilen der Form  | `welcome.mp3` | Text … |
function readList() {
  const rows = [];
  for (const line of fs.readFileSync(LIST, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*`([\w-]+)\.mp3`\s*\|\s*(.+?)\s*\|\s*$/);
    if (m) rows.push({key: m[1], text: m[2].replace(/\\\|/g, '|').trim()});
  }
  return rows;
}

async function synth(text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST', headers: {'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg'},
    body: JSON.stringify({text, model_id: model, language_code: 'de', voice_settings: settings}),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  const rows = readList().filter(r => !only || only.includes(r.key));
  if (!rows.length) { console.error('Keine Texte gefunden (Aufnahmeliste oder --only prüfen).'); process.exit(1); }
  const todo = rows.filter(r => flag('--force') || !fs.existsSync(path.join(OUT, `${r.key}.mp3`)));
  console.log(`${rows.length} Texte in der Aufnahmeliste, ${todo.length} zu erzeugen${flag('--dry') ? ' (Probelauf)' : ''}.`);
  if (flag('--dry')) { for (const r of todo) console.log(`  ${r.key}.mp3  (${r.text.length} Zeichen)`); process.exit(0); }
  if (!key || !voice) { console.error('ELEVENLABS_API_KEY und ELEVENLABS_VOICE_ID setzen.'); process.exit(1); }
  let ok = 0, chars = 0;
  for (const r of todo) {
    process.stdout.write(`  ${r.key}.mp3 … `);
    try {
      const buf = await synth(r.text);
      fs.writeFileSync(path.join(OUT, `${r.key}.mp3`), buf);
      ok++; chars += r.text.length;
      console.log(`${Math.round(buf.length / 1024)} KB`);
    } catch (e) { console.log(`FEHLER ${e.message}`); }
    await new Promise(res => setTimeout(res, 400));
  }
  console.log(`Fertig: ${ok} von ${todo.length} Dateien, ${chars} Zeichen verbraucht. Dateien liegen in public/audio/.`);
})();
