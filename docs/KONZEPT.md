# Investment Arena mit Florian Homm

**Konzept, Idee und alle Funktionen**
Stand: 8. November 2026 · www.investment-arena.com

---

## 1. Die Idee

Die Investment Arena ist ein Börsenspiel mit Spielgeld, in dem jeder so handeln kann wie ein Hedgefonds-Manager, ohne echtes Geld zu riskieren. Jedes Mitglied startet mit **100.000 € Spielgeld**, handelt mit **echten Kursen**, setzt auf steigende und fallende Kurse, nutzt Hebel und Optionen und tritt gegen die Community, gegen Freunde und Kollegen an.

Florian Homm begleitet die Mitglieder als Coach: Er erklärt jeden Schritt, warnt vor typischen Fehlern und sucht über das Programm **Scouting & Talents** die besten Investoren für ein Gespräch mit seinem Analystenteam.

**Leitgedanke:** Lernen durch Tun. Wer in der Arena Fehler macht, zahlt mit Spielgeld statt mit echtem Vermögen. Wer gut und diszipliniert handelt, wird sichtbar.

### Für wen

| Zielgruppe | Was sie in der Arena findet |
|---|---|
| Einsteiger (z. B. Schüler, Studierende, Auszubildende) | Einfacher Modus, große Knöpfe, Erklärungen zu jedem Begriff, 13 Lektionen, keine Angst vor Verlusten |
| Erfahrene Privatanleger | Profi-Modus mit Optionen, Hebel bis 20×, Volatilität, Delta, Gebühren, Smart-Money-Daten |
| Freundeskreise, Büros, Vereine | Private Arenen mit eigener Rangliste, wie eine Tipprunde |
| Talente | Talent-Score und die Chance, sich beim Analystenteam von Florian Homm vorzustellen |

### Grundsätze

- **Fair Play:** Alle Orders, Stop-Loss, Knock-outs und Depotwerte berechnet der Server mit Server-Kursen. Niemand kann die Rangliste über den Browser manipulieren. Es gibt kein Vorspulen des Marktes: Positionen bewegen sich nur mit dem echten Markt.
- **Mobil zuerst:** Die App ist für das Handy gebaut, mit festem Menü unten, großen Bedienelementen und ohne Zoom oder seitliches Verschieben.
- **Ehrlich und transparent:** Simulation zu Lernzwecken, keine Anlageberatung, keine echten Orders. Datenquellen werden offen genannt.
- **Long und short gleichwertig:** Man kann auch mit fallenden Kursen gewinnen. Der Markt muss nicht steigen, damit man vorne liegt.

---

## 2. Aufbau der App

Die App hat fünf Bereiche im Menü unten:

| Bereich | Inhalt |
|---|---|
| **Märkte** | Depotwert, Florians Erklärungen, Smart-Money-Radar, Suche, Kursliste, Fair-Play-Hinweis |
| **Depot** | Kopierte Anleger, offene Positionen, Verlauf, Zurücksetzen |
| **Entdecken** | TRCM Portfolio, Anleger kopieren, Großinvestoren, Community-Fonds |
| **Arena** | Drei Reiter: Global (Preise, Profil, Rangliste), Meine Arenen (private Arenen, Gruppen-Liga), Talente (Scouting & Talents) |
| **Lernen** | 13 Lektionen von Florian Homm |

---

## 3. Anmeldung und Konten

- **Eigenes Konto** mit E-Mail und Passwort (Passwörter verschlüsselt gespeichert, Schutz gegen Passwort-Raten).
- **Demo ohne Anmeldung:** sofort ausprobieren; Gastkonten werden nach 7 Tagen gelöscht.
- **Login mit Free Homes** (vorbereitet): Mitglieder von app.free-homes.de melden sich mit ihrem Free-Homes-Konto an. Bestehende Arena-Konten mit derselben bestätigten E-Mail-Adresse werden verknüpft. Die Freischaltung erfolgt, sobald der Zugang bei Free Homes eingerichtet ist.
- **Zwei Modi**, jederzeit oben umschaltbar:
  - **Start:** einfach, Hebel bis 5×, keine Optionen
  - **Profi:** Optionen, Hebel bis 20×, Volatilität, Delta, Gebühren
- Der Spielstand liegt auf dem Server: Anmelden auf jedem Gerät, dort weitermachen.

---

## 4. Märkte

### Kurse und Auswahl
- **19 Werte als feste Auswahl:** Apple, NVIDIA, Microsoft, Amazon, Tesla, SAP, Siemens, Rheinmetall, Allianz, Deutsche Bank, DAX, S&P 500, Gold, Bitcoin, Ethereum, Solana, XRP, Cardano, Dogecoin.
- **Suche nach jeder US-Aktie, jedem US-ETF und ADR** (rund 27.000 Titel, auch Aktienklassen wie Berkshire Hathaway BRK.B). Treffer erscheinen nach rund 0,2 Sekunden, ein neuer Titel öffnet in etwa 0,1 Sekunden.
- **Filter:** Alle, Krypto, Deutschland, USA, Indizes & Rohstoffe.
- Jede Zeile zeigt Kurs, Tagesveränderung, Mini-Chart, Volatilität und Hinweise wie „Zahlen am 17.11.“, „Insider kauft“ oder „Volumen 2,3×“.

### Kurs-Chart
- Zeiträume **24h, Woche, Monat, Jahr, Max (5 Jahre)**.
- Beim Darüberfahren oder Tippen erscheinen Kurs, Veränderung und Zeitpunkt.
- Unter dem Chart: Veränderung im gewählten Zeitraum.

### Smart-Money-Radar
Was die „großen Spieler“ tun, aufbereitet für jeden verständlich:
- **Insider-Käufe und -Verkäufe** aus den Pflichtmeldungen an die US-Börsenaufsicht SEC, mit Insider-Stimmung
- **Analystenkonsens** (Kaufen, Halten, Verkaufen)
- **Quartalszahlen:** nächster Termin, letzte Überraschung
- **Ungewöhnliches Handelsvolumen**
- **Schlagzeilen** zum Unternehmen
- Radar-Karten oben im Bereich Märkte zeigen die auffälligsten Signale des Tages, mit Florians Erklärung.

---

## 5. Handeln

| Produkt | Beschreibung |
|---|---|
| **Aktie / Direkt** | Long (Kurs steigt) oder Short (Kurs fällt). Short kostet 0,01 % pro Tag Leihgebühr |
| **Hebel** | Start: 2×, 3×, 5× · Profi: 2×, 5×, 10×, 20×. Mit Knock-out-Schwelle; Finanzierung 0,02 % pro Tag auf das Positionsvolumen |
| **Option** (Profi) | Call oder Put, Laufzeit rund 1, 3 oder 6 Monate, Basispreis am Geld oder 5 bzw. 10 % aus dem Geld. Bewertung nach Black-Scholes |

- **Absicherung:** Stop-Loss bei −5 %, −10 % oder −20 %.
- **Einsatz:** frei wählbar ab 100 €, Schnellwahl 1.000 / 5.000 / 10.000 / 25 % des Depots.
- **Zusammenfassung vor dem Kauf:** Positionsgröße, Knock-out-Schwelle, Kosten pro Tag, Gewinn und Verlust bei ±10 %, maximaler Verlust.
- **Begründung (optional):** ein Satz zum Trade. Zählt für den Talent-Score.
- Stop-Loss, Knock-out, Zwangseindeckung und Verfall prüft der Server automatisch alle 30 Sekunden.

---

## 6. Depot

- **Depotwert, verfügbares Spielgeld, investiert, heute**, Rang in der Monatswertung.
- **Offene Positionen** mit Einsatz, aktuellem Wert, Einstieg und Kurs, Gewinn/Verlust; Warnung bei drohendem Knock-out.
- **Verlauf** aller Trades mit realisiertem Ergebnis.
- **Kopierte Anleger** als eigene Karten (siehe Copy Trading).
- **Depot-Umschalter** „Hauptdepot | Arena-Depot“, sobald man in einer Arena mit eigenem Depot spielt.
- **Arena zurücksetzen** auf 100.000 € nur mit ausdrücklicher Bestätigung: Man sieht, was verloren geht (Depotwert, Ranglistenplatz, Positionen, Kopien, Verlauf, Abzeichen), und muss ein Häkchen setzen.

---

## 7. Entdecken

### TRCM Portfolio
Das Portfolio des **Analystenteams von Florian Homm**, long und short, aktiv gemanagt.
- **Für alle sichtbar:** Wertentwicklung, Tagesveränderung, Anzahl der Titel, Strategie.
- **Nur für Free-Homes-Mitglieder:** die gehaltenen Titel mit Gewichtung, Einstiegskurs, Datum, aktuellem Kurs und Begründung, dazu die verkauften Titel. Die Titel erscheinen auch nicht in der öffentlichen Kursliste.
- **Verweis** auf den Homm Long Short Börsenbrief (homm-longshort.com).
- **Pflege über den Admin-Zugang:** Titel hinzufügen, nachträglich korrigieren (Richtung, Gewichtung, Einstiegskurs, Datum, Notiz, Ausstiegskurs), verkaufen, Fehleingaben löschen, Beschreibung ändern. Jede Änderung steht im Änderungsprotokoll.

### Anleger kopieren (Copy Trading)
Wie bei Social-Trading-Plattformen, mit den Tradern der Arena:
- **Liste** sortierbar nach Beliebt (Kopierer), Rendite im Monat, Rendite der Woche, geringem Risiko.
- **Kennzahlen je Trader:** Rendite Woche, Monat und gesamt, **Risikowert 1–7**, größter Rückgang, Zahl der Kopierer.
- **Kopieren:** Betrag wählen (mindestens 500 €, höchstens 5 Anleger gleichzeitig). Offene Positionen werden anteilig übernommen, jeder neue Trade, jedes Schließen, jeder Stop-Loss und Knock-out wird automatisch nachgebildet.
- **Kopie beenden** schließt alle kopierten Positionen; das Guthaben fließt zurück.

### Großinvestoren
Die Depots bekannter Investoren aus ihren öffentlichen Pflichtmeldungen an die SEC (Formular 13F):
Warren Buffett, Bill Ackman, Ray Dalio, Stanley Druckenmiller, David Tepper, Carl Icahn, Dan Loeb, Seth Klarman, Li Lu, Chase Coleman, Cathie Wood, Andreas Halvorsen.
- Jeweils die **10 größten Aktienpositionen**, als kopierbares Depot mit Anteilswert.
- Neue Meldungen werden alle 12 Stunden geprüft; dann wird zum aktuellen Kurs umgeschichtet.
- Hinweis: Meldungen erscheinen bis zu 45 Tage nach Quartalsende; keine Verbindung zu den genannten Personen.

### Community-Fonds
- Jedes Mitglied kann **bis zu 3 eigene Fonds** gründen: 3 bis 10 Werte, long oder short, Gewichte zusammen 100 %, Strategie in zwei Sätzen.
- Andere investieren Spielgeld; der **Anteilswert startet bei 100**.
- Rangliste der Fonds nach Wertentwicklung; Fondsmanager erhalten ein Abzeichen.

---

## 8. Arena

### Global
- **Preise des Monats** (Wertung nach Kalendermonat, Countdown bis Monatsende):

  | Preis | Gewinn |
  |---|---|
  | 🏆 Monatssieger, höchste Rendite im Monat | Short-Selling-Kurs (Wert 1.100 €) |
  | 🥈 Platz 2 und 3 | Abo Homm Long Short Börsenbrief (Wert 99 €) |
  | 🔥 Dranbleiben, Verlosung unter allen mit mindestens 10 Handelstagen im Monat | Free-Homes-Abo (Wert 9,90 €) |
  | 🤝 Partner & Sponsoren | weitere Preise folgen |

- **Mein Profil:** Level, XP, Aktivitätsserie, Abzeichen.
- **Rangliste:** Monat, Heute, Woche, Depotwert. Tippen öffnet das Trader-Profil mit Depotwert, Kennzahlen, aufklappbaren Positionen, „Kopieren“ und „Folgen“.

### Private Arenen
Eigene Gruppen mit Freunden, Kollegen und Bekannten, wie eine Tipprunde.
- **Eröffnen auf einem Bildschirm:** Name (mit Vorschau des Links), Depot-Format, Zeitraum (1 Monat, 3 Monate, ohne Ende, bis Datum), privat oder öffentlich, optional: Trades im Feed sichtbar oder verborgen.
- **Zwei Depot-Formate:**
  - **Mit dem Hauptdepot:** Alle spielen mit ihrem normalen Depot, gewertet wird die Rendite ab dem Beitritt. Wer sein Depot zurücksetzt, behält sein bisheriges Ergebnis in der Arena.
  - **Eigenes Arena-Depot:** separates Depot für diese Arena, beim Beitritt neu mit 100.000 € oder als Kopie des Hauptdepots. So lassen sich zwei Strategien parallel ausprobieren.
- **Einladen:** Link kopieren, WhatsApp, E-Mail, Teilen-Menü des Handys, QR-Code. Geteilte Links zeigen eine Vorschau mit Einladungsbild, Arena-Name, Mitgliederzahl und Platz 1.
- **Beitreten mit einem Tipp:** Wer den Link öffnet, sieht die Einladung, meldet sich an oder registriert sich und tritt direkt bei.
- **Arena-Seite** mit drei Reitern:
  - **Rangliste** mit Auf- und Abstiegen seit gestern, Wochenrückblick, Abstand zum nächsten Platz, „Freunde einladen“
  - **Aktivität:** Trades der Mitglieder mit Reaktionen 🔥 🚀 😂 🐻
  - **Info:** Regeln, Einladungslink; für Gründer: umbenennen, Sichtbarkeit, Mitglieder entfernen, neue Runde starten, Arena löschen
- **Runden:** Nach Ablauf wird der Endstand festgeschrieben, der Sieger erscheint im Feed; der Gründer startet eine neue Runde.
- **Gruppen-Liga:** Arenen ab 3 Mitgliedern treten gegeneinander an, gewertet wird die durchschnittliche Rendite der besten fünf. Private Arenen erscheinen ohne Namen.
- Grenzen: bis zu 10 eigene Arenen je Mitglied, bis zu 200 Mitglieder je Arena.

### Scouting & Talents
Das Besondere der Arena: Die besten Investoren und Gruppen können sich beim **Analystenteam von Florian Homm** vorstellen.

**Nachricht von Florian Homm** (Entwurf zur Freigabe):
> *Ich suche keine Zocker. Ich suche Talente.*
> In der Arena sehe ich nicht nur, wer vorne liegt, sondern wie jemand dorthin gekommen ist. Wer sein Risiko im Griff hat, wer Verluste früh begrenzt und wer in einer schwachen Woche nicht die Nerven verliert, fällt mir auf.
> Die Besten jedes Quartals lade ich ein, sich meinem Analystenteam vorzustellen. Kein Lebenslauf, kein Titel, keine Bankausbildung nötig. Es zählen Ihre Zahlen und Ihre Begründung.
> Die größten Talente, die ich in meiner Laufbahn getroffen habe, kamen selten aus der Bankfiliale. Zeigen Sie mir, was Sie können.

**Talent-Score (0–100)** aus dem Hauptdepot der letzten 90 Tage. Gewinnen soll nicht der größte Glücksspieler, sondern wer gut und diszipliniert handelt:

| Baustein | Gewicht |
|---|---|
| Rendite im Verhältnis zum Risiko | 35 % |
| Verlustbegrenzung (größter Rückgang) | 20 % |
| Beständigkeit (Anteil positiver Wochen) | 20 % |
| Disziplin (Stop-Loss, vernünftige Positionsgrößen) | 15 % |
| Begründungen zu den Trades | 10 % |

**Der Weg zum Pitch in vier Stufen:**
1. **Talent-Wertung freischalten:** 30 Tage in der Arena, 20 eigene Trades, Free-Homes-Konto, kein Zurücksetzen im laufenden Quartal (Checkliste mit Fortschritt)
2. **Beobachtet:** Platz in der Talent-Wertung des Quartals
3. **Shortlist:** die besten 50 des Quartals mit mindestens 55 Punkten
4. **Pitch beim Analystenteam:** persönliches Gespräch, einmal im Quartal

- **Vorstellung** (für die Shortlist): Name, drei Fragen (Strategie, bester Trade, Ziel), optional ein Video-Link, ausdrückliche Einwilligung zur Weitergabe an das Analystenteam.
- **Top-Talente** des Quartals als Rangliste.
- **Pitch-Day** nach Quartalsende; die Shortlist schließt am letzten Tag des Quartals.
- **Scouting-Board für Admins:** alle Vorstellungen mit Kennzahlen, Antworten, Video, Status (Neu, Gesichtet, Gespräch, Abgeschlossen, Abgesagt) und internen Notizen.

---

## 9. Florian Homm als Coach und Lernen

- **Erklärkarte „Florian Homm erklärt“** an jeder Stelle der App, passend zur Situation (Begrüßung, erster Short, Hebel, Knock-out, Gewinn, Verlust, Fonds, Arenen, Talente und mehr).
- **Tonspuren:** Jeder Text kann als MP3 von Florian eingesprochen werden; bis dahin liest die Browser-Stimme vor. Die Liste aller Texte steht in `public/audio/AUFNAHMELISTE.md`.
- **Florians Tipps** im Handelsfenster, bei Fonds und beim Kopieren.
- **13 Lektionen:** Long, Short, Hebel, Call-Option, Put-Option, Stop-Loss, Positionsgröße, Krypto, Insider-Trades lesen, Analysten-Konsens, Quartalszahlen, ungewöhnliches Volumen, eigenen Fonds bauen.

---

## 10. Motivation und Spielmechanik

- **XP und Level:** Rookie → Lehrling → Trader → Stratege → Profi → Hedgefonds-Talent → Legende.
- **Abzeichen:** Erster Trade, Erster Short, Stop-Loss gesetzt, Hebel probiert, Option gekauft, Krypto gehandelt, Gewinn realisiert, 5 Tage aktiv, In Fonds investiert, Fondsmanager.
- **Aktivitätsserie** der letzten Tage.
- **Ranglisten** global, in privaten Arenen, in der Gruppen-Liga und im Talent-Programm.
- **Soziale Elemente:** Folgen, Kopieren, Reaktionen, Einladungen.

---

## 11. Verwaltung (Admin)

- **Admin-Rechte** vergibt der Betreiber auf dem Server (`scripts/admin.js`) oder automatisch für bestätigte Free-Homes-Adressen aus der Einstellung `ADMIN_EMAILS`.
- **TRCM Portfolio** pflegen (siehe Abschnitt 7).
- **Scouting-Board** (siehe Abschnitt 8).

---

## 12. Bedienung auf dem Handy

- Festes Menü unten, Kopfzeile mit Platz unter dem Logo.
- Kein Zoom, kein seitliches Verschieben; Eingabefelder ohne automatisches Hineinzoomen.
- **Fenster legen sich sauber übereinander:** Ein neues Fenster liegt vollständig über dem vorigen, das × führt eine Ebene zurück, Tippen daneben schließt alle; die Seite dahinter scrollt nicht mit.
- Angepasst an kleine Bildschirme (ab 320 px, z. B. iPhone SE).
- Einheitliche, großzügige Abstände für gute Lesbarkeit.

---

## 13. Verbindung zum Homm-Ökosystem

| Baustein | Rolle in der Arena |
|---|---|
| **Free Homes** | Login, Zugang zu den Titeln des TRCM Portfolios, Voraussetzung für die Talent-Wertung, Preis (Free-Homes-Abo) |
| **Homm Long Short Börsenbrief** | Verweis im TRCM Portfolio, Preis (Abo), Hintergründe und Analysen |
| **Short-Selling-Kurs / Long & Short Workshop** | Hauptpreis des Monats |
| **Analystenteam von Florian Homm** | TRCM Portfolio, Scouting & Talents, Pitch-Day |
| **Partner und Sponsoren** | zusätzliche Preise (in Vorbereitung) |

---

## 14. Datenquellen und Technik

| Quelle | Daten |
|---|---|
| Finnhub | US-Kurse in Echtzeit, Insider-Trades, Analystenkonsens, Quartalstermine, Nachrichten, Verzeichnis aller US-Titel |
| Yahoo Finance | DAX-Werte, Indizes, Gold, Kursverläufe bis 5 Jahre, Volumen |
| Kraken (über ccxt) | Kryptowährungen in Echtzeit |
| SEC EDGAR und OpenFIGI | 13F-Meldungen der Großinvestoren und Zuordnung zu Börsenkürzeln |

- Server ohne Framework auf Node.js mit eingebauter SQLite-Datenbank, Betrieb in Docker mit automatischem HTTPS (Caddy) auf einem eigenen Server bei Hetzner.
- Alle Berechnungen (Orders, Bewertung, Ranglisten, Kopien, Scores) laufen auf dem Server.
- Kurse alle 30 Sekunden, Radar alle 30 Minuten, Großinvestoren alle 12 Stunden, Depotwert-Verlauf alle 10 Minuten.
- Ohne Live-Daten läuft die App mit mitgelieferten Daten weiter.
- Automatische Tests für alle Kernfunktionen.

---

## 15. Offene Punkte vor dem öffentlichen Start

- [ ] Yahoo Finance durch einen lizenzierten Kursanbieter ersetzen, Anzeigerechte bei Finnhub klären
- [ ] Impressum, Datenschutzerklärung und Teilnahmebedingungen (Preise, Scouting als Chance auf ein Gespräch, kein Stellenangebot, Einwilligung zur Weitergabe)
- [ ] Rechtliche Prüfung: Anzeige der TRCM-Titel und der Großinvestoren-Depots (mögliche Einordnung als Anlageempfehlung)
- [ ] Texte und Nachricht von Florian Homm freigeben, Tonspuren einsprechen
- [ ] Free-Homes-Login freischalten (Zugang bei Free Homes einrichten lassen)
- [ ] Datensicherung der Datenbank einrichten
- [ ] Teilnahmebedingungen für die Preise festlegen (Aufteilung, Verlosung, Partnerpreise)

## 16. Ideen für später

- **Trading-Gym:** wöchentliche Übungen (Aufwärmen, Workout, Endgegner), Wochen-Depot mit gleichem Start für alle, Ligen mit Auf- und Abstieg, Trader-Fitness
- **Wochenrückblick per E-Mail oder Push**
- **Echte Social Trader** (eToro, wikifolio) über eine Partnerschaft
- **Weitere deutsche Titel** mit einem lizenzierten Datenanbieter
