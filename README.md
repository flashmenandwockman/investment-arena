# Investment Arena mit Florian Homm

Trading-Simulator mit Spielgeld für **www.investment-arena.com**. Jedes Mitglied startet mit 100.000 €, handelt mit echten Kursen long und short, mit Hebel und Optionen, gründet Community-Fonds und tritt in Ranglisten gegen die Community an. Florian Homm erklärt jeden Schritt.

> Simulation zu Lernzwecken. Kein echtes Geld, keine Orders an Börsen, keine Anlageberatung.

Idee, Konzept und alle Funktionen im Überblick: [docs/KONZEPT.md](docs/KONZEPT.md)

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Anmeldung** | Eigene Konten (E-Mail + Passwort), „Demo ausprobieren“ ohne Registrierung, vorbereitet: „Mit Free Homes anmelden“ (Keycloak) |
| **Märkte** | Oben die Suche nach jeder US-Aktie und jedem US-ETF, darunter **Aktuell** (drei Einträge: zwei Nachrichten mit Wirkung auf Kurse und Wirtschaft, als dritter dezent der neueste Beitrag von Florian Homm aus Free Homes im selben Stil, der vierte Eintrag unscharf, „Mehr aktuelle News laden“ zeigt alle; alle 240 Minuten aktualisiert), dann ein zweiter Suchschlitz und die **Kurse** in der Übersicht: die heute beliebtesten Titel der Arena je Gruppe (3 Aktien, 2 Rohstoffe, 2 ETFs, 2 Kryptowerte, berechnet aus Positionen, Orders, Watchlists und Aufrufen aller Mitglieder, alle 10 Minuten), auf Wunsch alle 22 Werte mit Filtern, darunter das Smart-Money-Radar. Long, Short, Hebel, Optionen (Profi-Modus), Stop-Loss |
| **Aktuell** | Überschriften von tagesschau.de (RSS, `NEWS_FEEDS`) und Finnhub-Marktnachrichten, nach Stichworten (Notenbanken, Zinsen, Inflation, Zölle, Öl, Quartalszahlen, Indizes) gewichtet, nur Überschrift, Quelle, Zeit und Link; englische Meldungen mit Kennzeichnung |
| **Smart-Money-Radar** | Insider-Käufe/-Verkäufe (SEC), Analystenkonsens, Quartalstermine und -überraschungen, ungewöhnliches Volumen, News |
| **Florian Homm aus Free Homes** | Die täglichen Postings und das Wochenvideo von Florian Homm aus Free Homes, untergemischt in die Radar-Karten und im Smart-Money-Feld je Titel. **Inhalt, Chart und Video nur für Free-Homes-Mitglieder**, alle anderen sehen eine unscharfe Karte mit Schloss. Jede Meldung verweist auf den Homm Long Short Börsenbrief |
| **Kurs-Charts** | Zeiträume 24h, Woche, Monat, Jahr und Max (5 Jahre); beim Darüberfahren oder Tippen erscheinen Kurs, Veränderung und Zeitpunkt |
| **Anleger kopieren** | Copy Trading wie bei Social-Trading-Plattformen: Trader der Arena mit Rendite (Woche, Monat, gesamt), Risikowert 1–7 und Zahl der Kopierer. Beim Kopieren werden die offenen Positionen anteilig übernommen und jeder neue Trade sowie jedes Schließen automatisch nachgebildet |
| **Großinvestoren** | Depots bekannter Investoren (Buffett, Ackman, Dalio, Druckenmiller u. a.) aus den öffentlichen 13F-Meldungen an die SEC, als kopierbares Depot mit Anteilswert |
| **Community-Fonds** | Mitglieder gründen eigene Aktienpakete (3–10 Werte, long/short, Gewichte), andere investieren Spielgeld; Anteilswert startet bei 100 |
| **TRCM Portfolio** | Portfolio des Analystenteams von Florian Homm, mit Verweis auf den Homm Long Short Börsenbrief. Wertentwicklung für alle sichtbar, **gehaltene Titel nur für Free-Homes-Mitglieder**. Gepflegt über den Admin-Zugang |
| **Private Arenen** | Eigene Gruppen mit Freunden und Kollegen wie bei einer Tipprunde: eröffnen, per Link, WhatsApp oder QR-Code einladen, Rangliste mit Auf- und Abstiegen, Aktivitäts-Feed mit Reaktionen, Gruppen-Liga. Wahlweise mit dem Hauptdepot oder einem eigenen Arena-Depot (neu oder als Kopie des Hauptdepots) |
| **Scouting & Talents** | Nachricht von Florian Homm, Talent-Score, Stufen bis zum Pitch beim Analystenteam, Vorstellung mit Einwilligung, Scouting-Board für Admins |
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
| `FREEHOMES_FEED_TOKEN` oder `FREEHOMES_FEED_USER` / `FREEHOMES_FEED_PASS` | Zugang, mit dem die Arena die Postings von Florian Homm aus der Free-Homes-App liest (siehe unten) |
| `FREEHOMES_NEWS_URL` | Ersatzweise ein RSS-, Atom- oder JSON-Feed mit den Postings |
| `BOERSENBRIEF_URL` | Standardlink zur Vertiefung an jeder Meldung (Standard: homm-longshort.com) |
| `NEWS_FEEDS` | RSS-Feeds für „Aktuell“, kommagetrennt (Standard: tagesschau Wirtschaft) |
| `SEC_USER_AGENT` | Kennung für Abrufe bei der SEC. Die SEC verlangt Name und Kontakt-E-Mail, z. B. `Investment Arena kontakt@ihre-domain.de` |
| `GURUS` | `0` = Großinvestoren ausschalten |
| `DATA_DIR` | Speicherort der Datenbank (Docker: `/data`) |
| `MARKET_OFFLINE` | `1` = nur mitgelieferte Kurse (Tests, Offline-Demo) |

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

## Private Arenen

Im Bereich **Arena → Meine Arenen** eröffnet jedes Mitglied eigene Arenen (höchstens 10, bis 200 Mitglieder je Arena).

- **Format „Hauptdepot“:** Alle treten mit ihrem normalen Depot an. Gewertet wird die Rendite ab dem Beitritt bzw. ab Rundenbeginn. Setzt jemand sein Hauptdepot zurück, bleibt das bisherige Ergebnis in der Arena-Wertung stehen.
- **Format „Eigenes Arena-Depot“:** Jedes Mitglied bekommt für diese Arena ein separates Depot, wahlweise neu mit 100.000 € oder als Kopie des Hauptdepots. Über dem Depotwert erscheint ein Umschalter „Hauptdepot | Arena“, alle Orders gehen in das gewählte Depot. Kopieren und Fonds gibt es nur im Hauptdepot.
- **Zeitraum:** 1 Monat, 3 Monate, ohne Ende oder bis zu einem Datum. Nach Ablauf wird der Endstand festgeschrieben, der Gründer kann eine neue Runde starten.
- **Einladen:** Link `www.investment-arena.com/a/<name>` mit Vorschau in WhatsApp & Co. (Titel, Mitglieder, Platz 1, Bild `public/img/og-arena.jpg`, 1200 × 630), QR-Code unter `/qr/a/<name>.svg`. Wer den Link öffnet, meldet sich an und tritt mit einem Tipp bei.
- **Rangliste** mit Pfeilen für Auf- und Abstiege seit gestern, Wochenrückblick, Abstand zum nächsten Platz. **Aktivität:** Trades der Mitglieder (abschaltbar) mit Reaktionen 🔥 🚀 😂 🐻.
- **Gruppen-Liga:** Arenen ab 3 Mitgliedern, gewertet wird die durchschnittliche Rendite der besten fünf. Private Arenen erscheinen ohne Namen.

## Scouting & Talents

Im Bereich **Arena → Talente** steht die Nachricht von Florian Homm (Text in `server/talents.js`, Tonspur `public/audio/scouting.mp3`, Freigabe durch Florian ausstehend).

- **Talent-Score 0–100** aus dem Hauptdepot der letzten 90 Tage: Rendite im Verhältnis zum Risiko 35 %, Verlustbegrenzung 20 %, Beständigkeit 20 %, Disziplin (Stop-Loss, Positionsgrößen) 15 %, Begründungen zu den Trades 10 % (Feld „Ihre Begründung“ im Handelsfenster).
- **Stufen:** Talent-Wertung freigeschaltet (30 Tage, 20 eigene Trades, Free-Homes-Konto, kein Zurücksetzen im Quartal) → Beobachtet → Shortlist (Top 50 des Quartals mit mindestens 55 Punkten) → Pitch beim Analystenteam.
- **Vorstellung:** Wer auf der Shortlist steht, beantwortet drei Fragen (Strategie, bester Trade, Ziel), optional mit Video-Link, und stimmt der Weitergabe ausdrücklich zu.
- **Scouting-Board** für Admins: Vorstellungen mit Kennzahlen, Status (Neu, Gesichtet, Gespräch, Abgeschlossen, Abgesagt) und internen Notizen. Status „Gespräch“ zeigt dem Mitglied die Stufe „Pitch“.
- **Pitch-Day:** nach Quartalsende, die Shortlist schließt am letzten Tag des Quartals.

## Florian Homm aus Free Homes

Florian Homm veröffentlicht bei Free Homes täglich ein Posting (Überschrift, Chart, deutscher Text, Quelle) und einmal die Woche ein Video. Die Arena übernimmt diese Beiträge alle 30 Minuten und mischt sie in das Smart-Money-Radar: als Karte zwischen Insider-, Analysten- und Großinvestoren-Signalen und im Smart-Money-Feld jedes Titels, der im Posting vorkommt (erkannt über `$NVDA`-Kürzel und bekannte Namen wie NVIDIA, SAP, DAX, Bitcoin).

**Sperre wie beim TRCM Portfolio:** Der neueste Beitrag steht unter „Aktuell“ als dritter Eintrag im Stil der Nachrichten (Quellenzeile „Florian Homm · Free Homes“), im Fenster dann mit Überschrift und Teaser (erster Satz). Wer nicht über Free Homes angemeldet ist, kommt danach an die Paywall: Text, Chart und Video werden Nicht-Mitgliedern gar nicht erst vom Server geliefert, das Fenster zeigt den Hinweis mit dem Knopf „Mit Free Homes anmelden“. Chart-Bilder legt der Server lokal unter `DATA_DIR/homm/` ab und liefert sie nur an Mitglieder aus (`/api/homm/:id/image`), weil die Bild-Links von Free Homes signiert sind und ablaufen.

**Kopplung an den Börsenbrief:** Jede Meldung trägt den Kasten „Vertiefung: Homm Long Short Börsenbrief“ mit Link (`BOERSENBRIEF_URL`, je Meldung im Admin überschreibbar).

**Quelle:** Die Free-Homes-App liefert die Beiträge über `POST /api/getRecentNews` (Kategorie `florian-homm`, Felder `title`, `contentText`, `contentTextGermanTranslation`, `imageIdsAndSignedLinks`, `videoCloudflareIds`, `postingTime`). Der Aufruf braucht ein Keycloak-Token. Zwei Wege:

1. Free Homes stellt der Arena einen festen Zugangsschlüssel aus: `FREEHOMES_FEED_TOKEN` setzen.
2. Ein eigenes Free-Homes-Konto für die Arena (z. B. „Investment Arena Leser“): `FREEHOMES_FEED_USER` und `FREEHOMES_FEED_PASS` setzen. Die Arena holt sich damit bei Keycloak ein Token (Password Grant, Client `public-client` oder per `FREEHOMES_FEED_CLIENT_ID` ein eigener Client, für den der Free-Homes-Administrator **Direct Access Grants** einschalten muss).

Ohne Zugang lassen sich Meldungen im Admin-Bereich (Radar-Karte → Admin) von Hand anlegen, ausblenden und löschen; dort steht auch der Knopf „Jetzt abgleichen“ und das Protokoll. Ersatzweise liest `FREEHOMES_NEWS_URL` einen RSS-, Atom- oder JSON-Feed. Bis der Zugang steht, zeigen vier Beispielbeiträge nach dem Muster der Free-Homes-Postings (Quelle „beispiel“ im Admin), wie es aussieht; der erste echte Abgleich entfernt sie automatisch.

## Täglicher Test-Trader

Statt einer festen Beispiel-Community legt der Server jeden Tag ein neues Bot-Konto „Test-Trader TT.MM.“ an. Es liest die Schlagzeilen unter „Aktuell“ und die Postings von Florian Homm, erkennt die genannten Titel, entscheidet nach dem Ton der Meldung zwischen Long und Short, hebelt mit 2× bis 5×, setzt Stop-Loss (10 %) und Kursziel (20 %) und begründet jeden Trade mit der Schlagzeile. Gewinne ab 6 % nimmt es mit, nach 20 Stunden schließt es alles. Fehlen Titel in den Nachrichten, folgt es den größten Tagesbewegungen. Test-Trader älter als 14 Tage werden gelöscht; Konten der früheren Beispiel-Community werden beim Start entfernt.

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
| GET | `/api/quotes`, `/api/radar` | Kurse (mit `popular`: Beliebtheit je Titel), Smart-Money-Radar (mit `homm`: Postings von Florian Homm, Inhalt nur für Mitglieder) |
| GET | `/api/news` | Aktuell: Nachrichten mit Marktwirkung (alle 240 Minuten) |
| GET | `/api/homm`, `/api/homm/:id/image` | Alle Postings von Florian Homm, Chart-Bild (nur Mitglieder) |
| POST/PATCH/DELETE | `/api/admin/homm[/:id]`, `/api/admin/homm/sync` | Meldungen pflegen, Abgleich mit Free Homes anstoßen (nur Admins) |
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
| GET/POST | `/api/arenas`, `/api/arenas/by/:name`, `/api/arenas/by/:name/join`, `/api/arenas/league` | Private Arenen, Beitreten, Gruppen-Liga |
| PATCH/POST/DELETE | `/api/arenas/:id`, `/api/arenas/:id/leave\|round\|kick`, `/api/arenas/feed/:id/react` | Verwalten, Reaktionen |
| GET/POST | `/api/talents`, `/api/talents/apply` | Talent-Programm, Vorstellung |
| GET/PATCH | `/api/admin/talents`, `/api/admin/talents/:id` | Scouting-Board (nur Admins) |
| – | `?book=<Arena-ID>` an `/api/state`, `/api/orders`, `/api/positions/…` | Handeln im eigenen Arena-Depot |
| GET | `/api/audio`, `/healthz` | vorhandene Tonspuren, Statusprüfung |

## Aufbau

```
server/        Node-Server ohne Framework (http, node:sqlite)
  index.js     Routen, Hintergrund-Aufgaben (Kurse alle 30 s, Radar alle 30 min)
  auth.js      Konten, Sessions (HttpOnly-Cookie), Demo, Free Homes (OIDC + PKCE)
  game.js      Orders, Bewertung, Stop-Loss/Knock-out/Verfall, Abzeichen
  funds.js     Community-Fonds und Anteilswerte
  trcm.js      TRCM Portfolio (Admin-Pflege, Protokoll)
  homm.js      Postings von Florian Homm aus Free Homes (Import, Mitglieder-Sperre, Admin-Pflege)
  news.js      Aktuell: Nachrichten mit Marktwirkung aus RSS und Finnhub, alle 240 Minuten
  popular.js   Beliebteste Titel des Tages für die Kursübersicht (ohne Daten: Top des Quartals)
  copy.js      Copy Trading und Kennzahlen (Rendite, Risiko, Kopierer)
  arenas.js    Private Arenen, Arena-Depots, Feed, Gruppen-Liga
  talents.js   Scouting & Talents (Score, Stufen, Vorstellungen, Scouting-Board)
  gurus.js     Großinvestoren aus SEC-13F-Meldungen
  market.js    Kurse (Finnhub, Yahoo, ccxt)
  radar.js     Smart-Money-Daten (Finnhub)
  daybot.js    Täglicher Test-Trader: handelt aus den Tagesnachrichten (Long/Short, Hebel, Stop, Ausstieg)
public/        App (eine HTML-Datei, mobil optimiert), Bilder, Tonspuren
test/          API-Tests (node --test)
```

## Vor dem öffentlichen Start

- [ ] Yahoo durch lizenzierten Kursanbieter ersetzen, Finnhub-Anzeigerechte klären
- [ ] Impressum, Datenschutzerklärung und Teilnahmebedingungen für Preise verlinken
- [ ] Erklärtexte von Florian Homm freigeben lassen, Tonspuren einspielen
- [ ] Keycloak-Client bei Free Homes anlegen lassen
- [ ] Datensicherung der Datenbank einrichten
