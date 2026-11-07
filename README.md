# Investment Arena mit Florian Homm

Trading-Simulator mit Spielgeld für **www.investment-arena.com**. Jedes Mitglied startet mit 100.000 €, handelt mit echten Kursen long und short, mit Hebel und Optionen, gründet Community-Fonds und tritt in Ranglisten gegen die Community an. Florian Homm erklärt jeden Schritt.

> Simulation zu Lernzwecken. Kein echtes Geld, keine Orders an Börsen, keine Anlageberatung.

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Anmeldung** | Eigene Konten (E-Mail + Passwort), „Demo ausprobieren“ ohne Registrierung, vorbereitet: „Mit Free Homes anmelden“ (Keycloak) |
| **Märkte** | 19 Werte als feste Auswahl (US- und DAX-Aktien, DAX, S&P 500, Gold, 6 Kryptowährungen) plus **Suche nach jeder US-Aktie und jedem US-ETF**. Long, Short, Hebel, Optionen (Profi-Modus), Stop-Loss |
| **Smart-Money-Radar** | Insider-Käufe/-Verkäufe (SEC), Analystenkonsens, Quartalstermine und -überraschungen, ungewöhnliches Volumen, News |
| **Kurs-Charts** | Zeiträume 24h, Woche, Monat, Jahr und Max (5 Jahre); beim Darüberfahren oder Tippen erscheinen Kurs, Veränderung und Zeitpunkt |
| **Anleger kopieren** | Copy Trading wie bei Social-Trading-Plattformen: Trader der Arena mit Rendite (Woche, Monat, gesamt), Risikowert 1–7 und Zahl der Kopierer. Beim Kopieren werden die offenen Positionen anteilig übernommen und jeder neue Trade sowie jedes Schließen automatisch nachgebildet |
| **Großinvestoren** | Depots bekannter Investoren (Buffett, Ackman, Dalio, Druckenmiller u. a.) aus den öffentlichen 13F-Meldungen an die SEC, als kopierbares Depot mit Anteilswert |
| **Community-Fonds** | Mitglieder gründen eigene Aktienpakete (3–10 Werte, long/short, Gewichte), andere investieren Spielgeld; Anteilswert startet bei 100 |
| **TRCM Portfolio** | Portfolio des Analystenteams von Florian Homm, mit Verweis auf den Homm Long Short Börsenbrief. Wertentwicklung für alle sichtbar, **gehaltene Titel nur für Free-Homes-Mitglieder**. Gepflegt über den Admin-Zugang |
| **Arena** | Ranglisten (Monat, Heute, Woche, Depotwert), Monatspreise (Short-Selling-Kurs, Börsenbrief-Abo, Free-Homes-Abo, Partnerpreise), Level, Abzeichen, Aktivitätsserie, Trader-Profile mit aufklappbarem Depot, Folgen |
| **Florian als Coach** | Erklärtexte an jeder Stelle, Tonspuren als MP3 (Fallback: Browser-Stimme), 13 Lektionen |
| **Zwei Modi** | Einsteiger (einfach, Hebel bis 5×) und Profi (Optionen, Hebel bis 20×, Volatilität, Delta, Gebühren) |

Alle Orders, Stop-Loss, Knock-outs und Depotwerte werden **auf dem Server mit Server-Kursen** berechnet. Die Rangliste lässt sich dadurch nicht über den Browser manipulieren. Kursbewegungen gibt es nur durch den echten Markt, nicht durch Vorspulen.

## Schnellstart (lokal)

Voraussetzung: Node.js 22.13 oder neuer (für das eingebaute SQLite).

```bash
npm install
npm run dev          # Offline-Demo mit mitgelieferten Kursen → http://localhost:8080
```

Mit Live-Daten:

```bash
cp .env.example .env     # FINNHUB_KEY eintragen
set -a && . ./.env && set +a
npm start
```

Tests: `npm test`

## Konfiguration (`.env`)

| Variable | Bedeutung |
|---|---|
| `BASE_URL` | Öffentliche Adresse, z. B. `https://www.investment-arena.com` (wichtig für sichere Cookies und den Free-Homes-Login) |
| `FINNHUB_KEY` | Kostenloser Schlüssel von [finnhub.io](https://finnhub.io): US-Kurse in Echtzeit und Smart-Money-Daten |
| `FREEHOMES_CLIENT_ID` / `FREEHOMES_CLIENT_SECRET` | Aktiviert „Mit Free Homes anmelden“ (siehe unten) |
| `FREEHOMES_ISSUER` | Standard: `https://keycloak.free-homes.de/realms/freehomes` |
| `ADMIN_EMAILS` | Kommagetrennte E-Mail-Adressen, die beim Login über Free Homes (bestätigte Adresse) automatisch Admin werden |
| `SEC_USER_AGENT` | Kennung für Abrufe bei der SEC. Die SEC verlangt Name und Kontakt-E-Mail, z. B. `Investment Arena kontakt@ihre-domain.de` |
| `GURUS` | `0` = Großinvestoren ausschalten |
| `DATA_DIR` | Speicherort der Datenbank (Docker: `/data`) |
| `MARKET_OFFLINE` | `1` = nur mitgelieferte Kurse (Tests, Offline-Demo) |
| `SEED_BOTS` | `0` = keine Beispiel-Community anlegen |

## Deployment auf www.investment-arena.com

**Kurzweg auf einem vorhandenen Server (z. B. Hetzner):** als root einen Befehl ausführen. Das Skript installiert bei Bedarf Docker, lädt den Code nach `/opt/investment-arena`, legt die `.env` an, startet alles und prüft den Status. Sind die Ports 80/443 schon durch einen anderen Webserver belegt, startet es die Arena nur intern auf `127.0.0.1:8080`; die passende Webserver-Konfiguration liegt in `deploy/`.

```bash
curl -fsSL https://raw.githubusercontent.com/flashmenandwockman/investment-arena/main/deploy/install.sh | bash
```

Erneut ausführen aktualisiert auf den neuesten Stand. Alternativ Schritt für Schritt:

Empfohlen: ein kleiner Linux-Server (VPS, 2 vCPU, 2–4 GB RAM, z. B. Hostinger VPS oder Hetzner Cloud) mit Docker.

1. **Server anlegen** (Ubuntu 24.04) und Docker installieren: `curl -fsSL https://get.docker.com | sh`
2. **DNS einrichten** (siehe nächster Abschnitt) und warten, bis die Domain auf die Server-IP zeigt.
3. **Code holen und starten:**
   ```bash
   git clone https://github.com/flashmenandwockman/investment-arena.git && cd investment-arena
   cp .env.example .env && nano .env      # BASE_URL, FINNHUB_KEY
   docker compose up -d --build
   ```
   Caddy holt automatisch HTTPS-Zertifikate für `investment-arena.com` und `www.investment-arena.com`. Die Adresse ohne www leitet auf www weiter.
4. **Prüfen:** `https://www.investment-arena.com/healthz` liefert `{"ok":true,…}`.
5. **Updates:** `git pull && docker compose up -d --build`
6. **Datensicherung:** Die Datenbank liegt im Docker-Volume `arena-data` (`/data/arena.sqlite`). Sicherung z. B. täglich per `docker compose exec app sh -c 'cp /data/arena.sqlite /data/backup.sqlite'` und Abholen der Datei.

### DNS-Einträge

| Typ | Name | Inhalt | TTL |
|---|---|---|---|
| A | `@` | **IP-Adresse des Servers** | 300 |
| CNAME | `www` | `investment-arena.com` | 300 |

Den bisherigen A-Eintrag `@ → 2.57.91.91` (Parkseite des Domain-Anbieters) durch die Server-IP ersetzen. Hat der Server eine IPv6-Adresse, zusätzlich `AAAA @ → IPv6-Adresse` anlegen. Ports 80 und 443 müssen in der Firewall offen sein.

## Login über Free Homes (Keycloak)

app.free-homes.de nutzt Keycloak (`https://keycloak.free-homes.de`, Realm `freehomes`). Die Arena ist als OpenID-Connect-Client vorbereitet (Authorization Code Flow mit PKCE S256).

**Was der Free-Homes-Administrator in Keycloak anlegen muss:**

| Einstellung | Wert |
|---|---|
| Client-ID | `investment-arena` |
| Client authentication | an (vertraulicher Client, Secret an uns übergeben) |
| Standard flow | an · Direct access grants: aus |
| Valid redirect URIs | `https://www.investment-arena.com/api/auth/freehomes/callback` |
| Web origins | `https://www.investment-arena.com` |
| Valid post logout redirect URIs | `https://www.investment-arena.com/` |
| PKCE (Advanced → Proof Key for Code Exchange) | S256 |
| Scopes | `openid`, `email`, `profile` |

Danach `FREEHOMES_CLIENT_ID=investment-arena` und `FREEHOMES_CLIENT_SECRET=…` in `.env` setzen und neu starten. Der Button „Mit Free Homes anmelden“ wird dann aktiv.

Verhalten: Ein Free-Homes-Mitglied bekommt beim ersten Login automatisch ein Arena-Konto. Existiert bereits ein eigenes Arena-Konto mit derselben **bestätigten** E-Mail-Adresse, werden beide verknüpft.

## Copy Trading

Im Bereich **Entdecken** stehen unter „Anleger kopieren“ die Trader der Arena, sortierbar nach Beliebtheit (Kopierer), Rendite im Monat, Rendite der Woche und geringem Risiko.

- **Kopieren:** Betrag wählen (mindestens 500 €, höchstens 5 Anleger gleichzeitig). Die Kopie bekommt ein eigenes Guthaben im Depot. Offene Positionen des Vorbilds werden im Verhältnis zu dessen Depotwert übernommen, neue Orders im gleichen Verhältnis nachgebildet, Schließen, Stop-Loss, Knock-out und Verfall ebenfalls. Kopiert werden nur eigene Positionen des Vorbilds, keine Kopien von Kopien.
- **Beenden:** schließt alle kopierten Positionen zum aktuellen Kurs; das Guthaben fließt zurück.
- **Kennzahlen:** Rendite 1 Woche und 1 Monat aus dem täglichen Depotwert-Verlauf, Risikowert 1–7 aus Schwankung und Hebel der Positionen, größter Rückgang, Zahl der Kopierer.

## Großinvestoren (SEC 13F)

US-Vermögensverwalter mit mehr als 100 Mio. $ melden ihre Aktienpositionen jedes Quartal der SEC (Formular 13F, bis 45 Tage nach Quartalsende). Diese Daten sind öffentlich und kostenlos. Der Server lädt alle 12 Stunden die neueste Meldung von 12 bekannten Investoren, übernimmt die 10 größten Aktienpositionen (CUSIP → Börsenkürzel über OpenFIGI) und legt sie als kopierbares Depot mit Anteilswert an. Bei einer neuen Meldung wird zum aktuellen Kurs umgeschichtet, der Anteilswert läuft ohne Sprung weiter. Optionen und Leerverkäufe sind in 13F nicht enthalten. Ohne Netz werden die mitgelieferten Meldungen aus `server/fallback/gurus.json` verwendet (`npm run snapshot` aktualisiert sie).

Hinweis in der App: keine Verbindung zu den genannten Personen, keine Anlageberatung.

## TRCM Portfolio und Admin-Zugang

Das TRCM Portfolio steht im Bereich „Entdecken“ ganz oben, darunter der Verweis auf den [Homm Long Short Börsenbrief](https://homm-longshort.com/). Alle sehen Name, Team, Strategie, Wertentwicklung und die Zahl der Titel. **Welche Titel gehalten werden** (mit Gewichtung, Einstiegskurs, Datum und Notiz) sehen nur Mitglieder, die über Free Homes angemeldet sind, sowie Admins. Die Titel des Portfolios tauchen auch nicht in der öffentlichen Kursliste auf.

**Admins** sehen im Portfolio zusätzlich den Bereich „Admin“:

- Titel hinzufügen (Suche über alle Werte der Arena und jede US-Aktie), long oder short, Gewichtung in %, Einstiegskurs (leer = aktueller Kurs), Einstiegsdatum, Notiz für Mitglieder
- Jede Position nachträglich korrigieren: Richtung, Gewichtung, Einstiegskurs, Datum, Notiz, bei verkauften Titeln auch den Ausstiegskurs
- Titel verkaufen (schließt zum aktuellen Kurs, erscheint unter „Verkaufte Titel“) oder Fehleingaben löschen
- Name, Team und Strategie bearbeiten
- Änderungsprotokoll: wer hat wann was geändert

Berechnung: Wertentwicklung je Titel seit Einstieg; das Portfolio gewichtet die Titel mit ihren Prozentwerten, der nicht investierte Rest gilt als Barreserve.

**Admin-Rechte vergeben** (das Konto muss vorher in der Arena registriert sein):

```bash
cd /opt/investment-arena
docker compose exec app node scripts/admin.js grant name@beispiel.de
docker compose exec app node scripts/admin.js list
docker compose exec app node scripts/admin.js revoke name@beispiel.de
```

Wichtig: Eigene Konten (E-Mail + Passwort) prüfen die E-Mail-Adresse nicht. Vor dem Vergeben daher sicherstellen, dass das Konto wirklich der richtigen Person gehört (Name wird angezeigt). Sobald der Free-Homes-Login aktiv ist, genügt `ADMIN_EMAILS` in der `.env`: Diese Adressen werden beim Login über Free Homes automatisch Admin, wenn Keycloak die Adresse als bestätigt meldet.

## Florians Tonspuren

MP3-Dateien mit den Namen aus [`public/audio/AUFNAHMELISTE.md`](public/audio/AUFNAHMELISTE.md) in `public/audio/` legen (29 Texte). Die App erkennt sie automatisch; fehlt eine Datei, liest die Browser-Stimme vor. Im Docker-Betrieb ist der Ordner eingebunden, ein neuer Build ist nicht nötig.

## Datenquellen und offene Lizenzfragen

| Quelle | Daten | Hinweis |
|---|---|---|
| Finnhub (Free) | US-Kurse in Echtzeit, Insider-Trades, Insider-Stimmung, Analystenkonsens, Quartalstermine, News | Anzeigerecht in einer öffentlichen App vor dem Launch mit Finnhub klären |
| Yahoo Finance | DAX-Werte, Indizes, Gold, Tagesvolumen | Inoffizielle Schnittstelle, **vor dem öffentlichen Start durch lizenzierten Anbieter ersetzen** (15 Minuten Verzögerung genügt) |
| ccxt / Kraken | Krypto in Echtzeit | Öffentliche Börsendaten |
| Unusual Whales | Kongress-Trades, Options-Flow, Dark Pool | Nicht eingebunden: braucht Enterprise-Lizenz |

**Suche nach weiteren Titeln:** Gesuchte US-Titel werden in der Datenbank gespeichert. Ihre Kurse holt der Server nur, solange sie jemand hält, sie in einem Fonds stecken oder sie in den letzten 30 Minuten angesehen wurden (höchstens 20 Titel pro 30-Sekunden-Durchlauf, reihum). Alle Finnhub-Abrufe laufen über eine gemeinsame Drosselung auf 55 pro Minute (`server/finnhub.js`). Für mehrere hundert gleichzeitig gehaltene Titel oder deutsche Titel außerhalb der Auswahl ist ein bezahlter Datenanbieter nötig.

Mitgelieferte Fallback-Daten (`server/fallback/`) halten die App auch ohne Live-Daten lauffähig. Aktualisieren mit `npm run snapshot`.

## API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/config`, `/api/me` | Konfiguration, angemeldeter Nutzer |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/demo`, `/api/auth/logout` | Anmeldung |
| GET | `/api/auth/freehomes/start`, `/api/auth/freehomes/callback` | Login über Free Homes |
| GET | `/api/quotes`, `/api/radar` | Kurse, Smart-Money-Radar |
| GET/PATCH | `/api/state` | Spielstand, Modus, Folgen |
| POST | `/api/orders`, `/api/positions/:id/close` | Order eröffnen, Position schließen |
| GET | `/api/leaderboard`, `/api/profile/:id` | Rangliste, Trader-Profil |
| GET/POST | `/api/funds`, `/api/funds/:id`, `/api/funds/:id/invest` | Community-Fonds |
| GET | `/api/trcm` | TRCM Portfolio (Titel nur für Free-Homes-Mitglieder und Admins) |
| PATCH/POST/DELETE | `/api/admin/trcm`, `/api/admin/trcm/holdings[/:id[/close]]` | Pflege des TRCM Portfolios (nur Admins) |
| GET | `/api/chart?sym=…&r=1d\|5d\|1mo\|1y\|5y` | Kursverlauf für den Chart |
| GET | `/api/discover` | Trader zum Kopieren mit Kennzahlen, Großinvestoren |
| POST | `/api/copy`, `/api/copy/:id/stop` | Kopieren starten, beenden |
| POST | `/api/state/reset` | Neustart, nur mit `{"confirm": true}` |
| GET | `/api/audio`, `/healthz` | vorhandene Tonspuren, Statusprüfung |

## Aufbau

```
server/        Node-Server ohne Framework (http, node:sqlite)
  index.js     Routen, Hintergrund-Aufgaben (Kurse alle 30 s, Radar alle 30 min)
  auth.js      Konten, Sessions (HttpOnly-Cookie), Demo, Free Homes (OIDC + PKCE)
  game.js      Orders, Bewertung, Stop-Loss/Knock-out/Verfall, Abzeichen
  funds.js     Community-Fonds und Anteilswerte
  trcm.js      TRCM Portfolio (Admin-Pflege, Protokoll)
  copy.js      Copy Trading und Kennzahlen (Rendite, Risiko, Kopierer)
  gurus.js     Großinvestoren aus SEC-13F-Meldungen
  market.js    Kurse (Finnhub, Yahoo, ccxt)
  radar.js     Smart-Money-Daten (Finnhub)
  bots.js      Beispiel-Community für die Demo
public/        App (eine HTML-Datei, mobil optimiert), Bilder, Tonspuren
test/          API-Tests (node --test)
```

## Vor dem öffentlichen Start

- [ ] Yahoo durch lizenzierten Kursanbieter ersetzen, Finnhub-Anzeigerechte klären
- [ ] Impressum, Datenschutzerklärung und Teilnahmebedingungen für Preise verlinken
- [ ] Erklärtexte von Florian Homm freigeben lassen, Tonspuren einspielen
- [ ] Keycloak-Client bei Free Homes anlegen lassen
- [ ] Datensicherung der Datenbank einrichten
