# THE 12TH MAN – Technical Report & Development Guide

**Stand:** 17.10.2026 · Rebuild aus PR #4 (gemergt), Realismus-Kalibrierung auf Branch `claude/confident-mendeleev-0eee62`.
**Rolle:** verbindliche Source of Truth für Architektur, tatsächlichen Stand, Versionen, Tests, Messwerte und nächste Schritte.
**Kennzeichnung:** **Implementiert** = Code vorhanden · **Getestet** = durch tatsächlich ausgeführte Tests belegt · **Gemessen** = Zahl aus einem tatsächlichen Lauf · **Geplant** = nicht vorhanden · **Nicht geprüft** = vorhanden, ohne Nachweis.

## 1. Produktauftrag (README.md)

Elf gegen elf spielen eigenständig Fußball. Ein **Decisive Moment Director** erkennt seltene Situationen, in denen eine Entscheidung des Benutzers den Verlauf spürbar beeinflussen kann, und bietet nur ausführbare Optionen an. Die Entscheidung ändert Handlungsmöglichkeiten, nicht das Ergebnis: Körper, Fußkontakt, Ballphysik, Gegner und Schiedsrichter bestimmen, was passiert. Keine geskripteten Szenen, keine Teleports, keine garantierten Erfolge. Leerlauf darf verdichtet (schneller abgespielt), aber nicht erfunden werden.

## 2. Tech Stack (installiert und geprüft)

Geprüft am 16.10.2026 per `npm view <paket> version engines peerDependencies` gegen Node 24.20.0 / npm 11.19.0. Die Systeminstallation von Node/npm wurde nicht verändert; alle Pakete sind lokal.

| Paket | Version | Zweck | Kompatibilität |
| --- | --- | --- | --- |
| `three` | 0.186.1 | Rendering | – |
| `@dimforge/rapier3d-simd-compat` | 0.21.0 | Physik (WASM mit SIMD, inline) | WASM-SIMD: Chrome/Edge ≥ 91, Firefox ≥ 89, Safari ≥ 16.4 |
| `typescript` | 7.0.2 | Typprüfung | node ≥ 16.20 |
| `vite` | 8.3.4 | Dev-Server, Build (Rolldown) | node ^20.19 ∥ ≥ 22.12 |
| `vitest` | 5.0.5 | Tests | node ^22.12 ∥ ^24; peer vite ^6–^8 |
| `@types/three` | 0.186.0 | Typen | passend zu three 0.186 |
| `@types/node` | 24.19.2 | Typen (Node-24-Linie, nicht 26.x) | – |

Kein React/Framework (die Oberfläche besteht aus wenigen DOM-Panels über einem WebGL-Canvas), kein Backend, kein Tailwind.

## 3. Architektur

```text
src/
  engine/    A  Match Engine: Zeit, Halbzeiten, Phasen, Spielfortsetzungen, Ereignisse, Snapshots (headless)
  physics/   B  Rapier-Welt, Feld/Tore/Netze/Banden/Tribünenfront, Ball, Körper, Schuhe, Torwarthände
  ai/        C  Wahrnehmung, Mannschaftsform, Optionsbewertung, Ausführung, Torwartspiel
  rules/     D  Schiedsrichter: Tor, Aus, Abseits, Fouls, Karten, Elfmeter, Vorteil, Handspiel, Rückpass
  director/  E  Decisive Moment Director
  ui/        F  Startbildschirm, HUD/Ticker, Entscheidungspanel, Kommentar aus Ereignissen (CSS neben TS)
  render/    G  Stadion, Rasen, Spielerfiguren, Ball, TV-Regie
  audio/     G  synthetisierter Stadionton aus echten Ereignissen
  app.ts     Spielschleife: fester Physikschritt, Interpolation, Zeitraffer, Ereignisverteilung
  main.ts    Einstieg, Renderer, Licht, URL-Parameter
scripts/browser-check.mjs   echter Browserlauf (npm run test:browser)
```

**Verbindliche Regeln**
1. **Single writer:** Nur `engine` + `physics` ändern Körper- und Ballzustand; alle anderen lesen `MatchSnapshot` oder liefern Absichten (`PlayerIntent`, `TeamInstruction`). Schnittstellen: `src/engine/types.ts`.
2. **Ball ohne Abkürzung:** Im Spiel bewegt sich der Ball nur durch Rapier-Kontakte, Schwerkraft, Luftwiderstand, Magnus-Kraft und Rollwiderstand. Nur `MatchEngine.placeDeadBall` setzt den Ball, und nur aus Anstoß/Spielfortsetzung (Quelltext-Test `no-magnet.test.ts`).
3. **Absicht ≠ Ergebnis:** KI und Benutzer erzeugen dieselben `PlayerIntent`s; ausgeführt wird über Körper und Schuhkontakt.
4. **Entscheidung vor Handlung:** Der Director wird am Anfang eines Ticks befragt, bevor Spieler sich festlegen; läuft der Schwung schon, wird kein Moment mehr geöffnet.
5. **Fester Zeitschritt** 1/60 s, Teilschritte nur bei schnellen Schwüngen; Darstellung interpoliert, Kamera zeitbasiert.
6. **Reproduzierbar:** jede Zufallsentscheidung über `engine/rng.ts` (Seed); gleicher Seed → gleiche Partie (getestet).
7. **Keine erfundenen Ereignisse:** Kamera, Ton, Ticker und Kommentar reagieren nur auf `MatchEvent`s.

## 4. Features & Status

| Bereich | Status | Wesentliche Dateien |
| --- | --- | --- |
| Projektfundament, Verträge, IFAB-Geometrie, Seed-Zufall | Implementiert, getestet | `engine/types.ts`, `physics/pitch-geometry.ts`, `engine/rng.ts` |
| Physikwelt: Ball (Drag-Crisis, Magnus, Rollwiderstand), Tore, Netze, Banden, Tribünenfront, 22 Körper | Implementiert, getestet | `physics/*` |
| Physische Fußkontakte (Pass, Schuss, Dribbling, Klärung, Ballannahme), Luftlöcher | Implementiert, getestet | `physics/legs.ts`, `ai/execution.ts` |
| Torwart: Reaktionszeit, Reichweite, Hechtsprung, Fangen als Rapier-Gelenk, Abwurf, Fußspiel bei Rückpass | Implementiert, getestet | `physics/hands.ts`, `ai/keeper.ts` |
| Wahrnehmung (Blickfeld, Schulterblick, Rauschen, Latenz) | Implementiert, indirekt getestet | `ai/perception.ts` |
| Positionsspiel 4-3-3, Ballgewinner dezentral, Jockeying, Pressing, Deckung, Ausweichen, Bremsen vor Körpern | Implementiert, getestet (Zonen-Test) | `ai/shape.ts`, `ai/brain.ts` |
| Schiedsrichter: Tor, Aus, Abseits (Regel-11-Ausnahmen, Seitenwechsel), Fouls, Karten inkl. Notbremse und Gelb-Rot, Elfmeter, Vorteil, Handspiel, Rückpass, 9,15 m | Implementiert, getestet | `rules/referee.ts`, `engine/restarts.ts` |
| Vollständige autonome Partie (2 Halbzeiten) | Implementiert, getestet | `engine/match-engine.ts` |
| Decisive Moment Director: Abschluss/Ablage, Durchsetzen, Konter, Gegenpressing, Durchbruch des Gegners | Implementiert, getestet | `director/moment-director.ts` |
| Entscheidungs-UI mit Countdown, Tasten 1–4, Rückmeldung zum Ausgang | Implementiert, im Browser getestet | `ui/decision-panel.*`, `app.ts` |
| Stadion, Spielerfiguren mit IK an den Physikschuhen, TV-Regie, Ton, Ticker | Implementiert, im Browser geprüft | `render/*`, `audio/*`, `ui/*` |

## 5. Testing Status (tatsächlich ausgeführt)

| Datum | Befehl / Lauf | Ergebnis |
| --- | --- | --- |
| 16.10.2026 | `npm install` (exakte Versionen) | 0 Vulnerabilities, `npm ls` bestätigt Versionen |
| 17.10.2026 | `npm run check` | `tsc` ohne Fehler, **6 Testdateien / 45 Tests bestanden** (1 Datei übersprungen: Langsimulation, nur über `npm run sim`), `vite build` erfolgreich |
| 17.10.2026 | `npm run test:browser` (Chrome 1600 × 900, ANGLE/D3D11, Intel Iris Xe) | `ok: true`, keine Konsolenfehler/-warnungen, Uhr läuft, **50–55 FPS**, echter Entscheidungsmoment erschienen, Simulation währenddessen eingefroren, Klick als `user`-Entscheidung protokolliert, Teamanweisung angewendet |
| 17.10.2026 | `npm run sim` (2 × 45 min, Seed 2026) | siehe §6 |
| 17.10.2026 | Realismus-Kalibrierung: `npm run check` | `tsc` ohne Fehler, **6 Testdateien / 45 Tests bestanden**, `vite build` erfolgreich |
| 17.10.2026 | Realismus-Kalibrierung: `npm run test:browser` (gleiche Hardware) | `ok: true`, keine Konsolenfehler/-warnungen, Uhr läuft, **45 FPS** (gemessen, während parallel `npm run sim` lief), Entscheidungsmoment erschienen, eingefroren, Entscheidung protokolliert |
| 17.10.2026 | Realismus-Kalibrierung: `npm run sim -- --silent=false` (2 × 45 min, Seed 2026) und Mehr-Seed-Probe (6 Seeds × 2 × 10 min) | siehe §6 |
| 17.10.2026 | Ballverluste: `npm run check` | `tsc` ohne Fehler, **6 Testdateien / 46 Tests bestanden** (neu: Drallkorrektur beim seitlichen Antippen), `vite build` erfolgreich |
| 17.10.2026 | Ballverluste: `npm run test:browser` | `ok: true`, keine Konsolenfehler/-warnungen, Entscheidungsmoment erschienen, Entscheidung als `user` protokolliert |
| 17.10.2026 | Ballverluste: `npm run sim -- --silent=false` (2 × 45 min, Seed 2026) und Mehr-Seed-Probe (6 Seeds × 2 × 10 min) | siehe §6 |

**Testinhalte:** Feldmaße/Regel 9/10, Zufall reproduzierbar; Ballaufprall, Rollweg, keine Kraftakkumulation, Magnus-Richtung, Netz/Pfosten/Latte; Beschleunigungsgrenzen, 22 Körper stabil, bitgleiche Wiederholung; Fußkontakt (Nähe kickt nie, Richtung/Tempo, Spannstoß mit Lift, Richtungsabhängigkeit, Drallkorrektur beim seitlichen Antippen, Fehltreffer mit Drall, Luftloch, Reichweite, Ballannahme); Schiedsrichter (Abseits, Einwurf-Ausnahme, Seitenwechsel, Ecke/Abstoß/Einwurf/Tor/Eigentor, Foul von hinten, Zweikampf ≠ Foul, Notbremse = Rot + Elfmeter, taktisches Foul = Gelb, Gelb-Rot, Mitspieler-Kontakt, Handspiel außerhalb, Rückpass); vollständige Partie ohne ungültige Zustandsübergänge, gleicher Seed = gleiche Partie, kein kollektives Ballverfolgen, Torwart-Ergebnisse variieren, Ballfreigabe innerhalb von 6 s; Director (Moment friert ein, jede angebotene Option wird als echter Schwung ausgeführt, gleiche Lage + andere Entscheidung → anderer Verlauf, gleiche Entscheidung → unterschiedlicher Erfolg, Momente selten und mit Abstand); Quelltext „kein Magnetismus“.

## 6. Messwerte

**Fußkontakt:** Rapier-CCD überstreicht kinematische Körper nicht; ohne Teilschritte springt ein 18-m/s-Schuh in den Ball. Daher Teilschritte während Ausholen/Schlag (≤ 6 cm pro Teilschritt). Kinematischer Schuh ⇒ Ball ≈ (1 + e) × Schuhgeschwindigkeit mit e = 0,575 (Rapier mittelt Schuh 0,5 und Ball 0,65; real eher 1,2–1,35).

**Ball rollt erst ab 240 Hz korrekt (gemessen):** Bei 60 Hz nimmt eine Kugel über den Reibkontakt pro Schritt höchstens ≈ 0,74 rad Drall auf (≈ 44,6 rad/s). Ein flach gespielter Ball (ohne Drall) rutschte dadurch, bis er unter ≈ 5 m/s fiel (12,9 → 4,75 m/s nach 1 s). Reines Rapier bei 240 Hz liefert den Lehrbuchübergang ins Rollen bei 5/7 der Abspielgeschwindigkeit (12,9 → 9,19 m/s). Die Physik läuft daher immer mit ≥ 4 Teilschritten (Kosten: 2,97 statt 1,95 ms pro Tick im Node-Test). Der Rolltest erwartet jetzt 24–35 m statt 15–25 m aus 8 m/s: Ein rollender Ball nimmt seinen Drall durch den Kontakt mit und wird von den Mittelpunktskräften weniger gebremst (gemessen ≈ 29 m; die alte Spanne passte nur wegen der Drallgrenze).

**Schussmechanik (gemessen, isolierter Test ohne Motorrauschen):** Vor der Korrektur traf bei laufendem Spieler oft zuerst der eigene Körper den Ball (Abstand Körper–Ball 0,42 m bei 0,38 m Berührabstand) → 10–60° Richtungsfehler. Danach: alle ausführbaren Stöße ≤ 6,5° Richtung und ≤ 3 % Tempo bei 4 m/s Lauf. Im Spiel (inkl. Motorrauschen, Median): Pässe 25° → 6–11°, Schüsse 26–35° → 4–10°.

**Realismus-Kalibrierung – Mehr-Seed-Probe** (temporärer Ereignis-Probe-Test, 2 × 10 min je Seed, hochgerechnet auf 90 min):

| pro 90 min | vorher (Seeds 1–3) | nachher (Seeds 1–3) | nachher (Seeds 4–6) | realer Richtwert |
| --- | --- | --- | --- | --- |
| Tore | 13,5 | 12,0 | 6,0 | ~2,7 |
| Torschüsse / davon aufs Tor | 59 / 12 | 48 / 26 | 48 / 23 | ~25 / ~9 |
| Pässe / Passquote | 896 / 48 % | 527 / 67 % | 600 / 65 % | ~900 / 75–85 % |
| Einwürfe / Ecken / Abstöße | 170 / 30 / 56 | 84 / 18 / 27 | 107 / 38 / 41 | ~45 / ~10 / ~18 |
| Fouls | 39 | 38 | 33 | ~22 |
| Gefangene Bälle Torwart | 2 | 5 | 5 | mehrere |

Die Kurzspiel-Probe zählt höhere Foulraten als die volle Partie (auch vor der Kalibrierung: 39 vs. 26).

**Kalibrierung Spielgeschehen** (Mittel aus 3 Seeds, je 2 × 5 min, hochgerechnet auf 90 min):

| | vor Korrekturen | nach Korrekturen | realer Richtwert |
| --- | --- | --- | --- |
| Fouls | ≈ 100 | ≈ 42 | ~22 |
| Ausbälle (Einwurf/Ecke/Abstoß) | ≈ 250 | ≈ 230 | ~75 |
| Torschüsse | – | ≈ 90 | ~25 |
| Tore | ≈ 15 (inkl. Eigentore durch Fehler) | ≈ 9 | ~2,7 |

Behobene Ursachen: Torwart nahm Rückpässe nicht mit dem Fuß an (Eigentore), Torwart konnte einen gefangenen Ball nie loslassen (Armreichweite) und wurde dann minutenlang „angeschossen“, Spieler sprinteten ungebremst in Gegner, Torwartwahrnehmung wurde nicht aktualisiert, Hechtsprung wurde sofort abgebremst, Schuhe fuhren beim Start über den Anstoßpunkt.

**Volle Partie (`npm run sim`, 2 × 45 min, Seed 2026, 17.10.2026):** läuft fehlerfrei bis Abpfiff. Vitest 5 zeigt die Statistik nur mit `npm run sim -- --silent=false`.

| Messwert | vor Kalibrierung | nach Kalibrierung | realer Richtwert |
| --- | --- | --- | --- |
| Ergebnis | 1 : 8 | 8 : 1 | ~1,5 : 1,2 |
| Torschüsse | 59 / 26 | 21 / 11 | ~13 / 12 |
| Pässe / Passquote (nächster Kontakt durch Mitspieler) | 915 / 47 % | 368 / 67 % | ~900 / ~80 % |
| Ballbesitz | 48 % / 52 % | 51 % / 49 % | – |
| Ball im Spiel | 79 % | 51 % | ~60 % |
| Fouls / Gelb / Rot / Elfmeter | 26 / 2 / 0 / 1 | 18 / 3 / 0 / 4 | ~22 / ~4 / ~0,1 / ~0,3 |
| Abseits / Ecken / Einwürfe / Abstöße | 6 / 38 / 159 / 75 | 6 / 23 / 83 / 10 | ~4 / ~10 / ~45 / ~18 |
| Gefangene Bälle Torwart | 2 | 2 | mehrere |
| Rechenzeit | 632 s (1,95 ms/Tick) | 963 s (2,97 ms/Tick) | – |

Bewertung: Torschüsse, Einwürfe, Ecken, Abstöße und Passquote liegen deutlich näher am Richtwert; Tore (9 pro Partie) und Elfmeter (4) nicht, Fouls (18) leicht unter dem Zielbereich 20–30. Zu wenige Pässe (368), weil viel gedribbelt wird. Ursache des Rests (gemessen in der Probe): ≈ 1400 Ballbesitzwechsel pro 90 min (real ~250), vor allem Ballverluste zwischen Dribbelkontakten und nach gestoppter Ballannahme; daraus entstehen Chancen aus Nahdistanz (Tore fast nur aus 4–13 m).

**Behobene Ursachen (Realismus-Kalibrierung):** eigener Körper traf den Ball vor dem Schuh, Körper bremste mitten im Schwung; Beinplan hielt für Ball- und Körperbewegung nicht vor (Kontakt stößt nur entlang der Normalen), Spannstoß rechnete mit Schuhmitte statt Spitze; 60-Hz-Drallgrenze und Spieler-Ballmodell ohne Rutschphase; Entscheidungsrauschen (σ 0,015–0,03) war größer als die Wertunterschiede der Optionen (meist < 0,02) → Wahl fast zufällig; xG auf Distanz ≈ doppelt zu hoch; hohe Bälle zu optimistisch bewertet (gemessen ~50 % behalten); jeder zulaufende Ball wurde gestoppt, auch wenn ein sicherer Direktpass möglich war; Hechtsprung mit fester Schulterhöhe (flache Bälle neben dem Torwart unerreichbar) und Sprung in Zufallsrichtung bei Bällen auf den Körper; Torwart kommt jetzt auch bei knappen Wettläufen (bis 0,4 s Rückstand) zum losen Ball (6 Seeds: 14,3 → 9,0 Tore/90).

**Verworfen (gemessen schlechter):** enge Ballführung unter Druck (mehr Ballverluste), Dribbeln in alle Richtungen bzw. Raum ab dem ersten Schritt (27–36 Tore/90), schärfere Pässe mit 5,5 m/s Ankunft (20 Tore/90), Torwart bleibt eher auf der Linie (29 Tore/90).

**Ballverluste – Ursachenanalyse und Korrekturen (Mehr-Seed-Probe, 6 Seeds × 2 × 10 min, hochgerechnet auf 90 min, 17.10.2026):** Die Probe wurde um Verlustkontext (Abstand Ball–Ballführer, Zeit seit seiner letzten Berührung, Art des Ballgewinns), die Ballrichtung 0,15 s nach einer Berührung, Ablehnungsgründe der Schwungplanung und Spielerpositionen bei jedem Schuss erweitert (temporär, nicht eingecheckt). Gemessene Ursachen und Korrekturen:

- **Drall nicht berücksichtigt (Physik-Planung):** Ein rollender Ball behält beim seitlichen Antippen seinen Drall; die Rasenreibung zieht ihn danach in die alte Rollrichtung zurück (Endgeschwindigkeit = Abschuss − 2/7 · (Abschuss − Drall-Rollgeschwindigkeit), Vollkugel). Die Schwungplanung zielte auf die Abschussgeschwindigkeit; Dribbelberührungen wichen 15–40° ab (isolierter Test traf 0°, weil dort nur geradeaus gespielt wurde). Neu: `rolledLaunch()` in `legs.ts`. Gemessen (Seed 1, 5 min, Richtung 0,15 s nach der Berührung): Dribbelberührungen < 5° Abweichung 13 → 56 von ≈ 107, 15–40° 53 → 4; Pässe < 5°: 18 → 33. Test: `physics.test.ts` („rolling ball touched sideways …“).
- **Beinreichweite:** Hüfte 0,51·h, Bein 0,53·h ergaben in Ballhöhe nur ≈ 0,5 m Reichweite nach vorn, ≈ 10 cm jenseits des Körperabstands. Das Standbein beugt sich beim Schuss: `KICK_HIP_DROP` 0,1 m.
- **Gerichtete erste Ballmitnahme:** Der Empfänger bewertet seine nächste Aktion am Annahmepunkt und nimmt den Ball in diese Richtung mit (`first-touch.ts`), weg vom nächsten Gegner; er stellt sich dafür 0,5 m neben die Ballbahn (sonst lehnte die Körperabstandsprüfung fast jede Mitnahme ab). Passt die Mitnahme nicht mehr, stoppt er den Ball (Zeitkriterium 0,45 s). Torhüter stoppen immer (mit gerichteter Mitnahme für alle gemessen: 13,5 Eigentore/90, meist Torwart).
- **Torwart als Torquelle:** Bei den meisten Schüssen stand der Schütze 1–5 m neben dem gegnerischen Torwart, dessen Mannschaft in Ballbesitz-Formation (Stürmer an der Mittellinie): Torwart dribbelte nach dem Abrollen oder nahm Rückpässe unter Druck an. Neu: Torwart passt oder klärt nur; Passbewertung rechnet ein, dass ein bedrängter Empfänger den Ball an seiner Position wieder verliert, und dass Gegner während der Ballreise aufrücken (2 m/s). Verworfen: Torwart spielt unter Druck direkt (Eigentore 16,5/90).
- **Mannschaftsformation:** Die Formation wechselte bei jeder Berührung (Abwehr, Abpraller) sofort in Ballbesitz-Aufstellung, die Abwehr stand dann 20–50 m vor dem Tor. Neu: aufrücken erst, wenn ein Mitspieler dem Ball am nächsten ist.
- **Zweikampf:** Es gab keinen Tackling-Versuch; „Hineingehen“ hieß, einen kompletten Pass/Dribbling-Schuss aufzubauen – unmöglich mit dem Gegner am Ball (drei Verteidiger umringten einen Dribbler 7 s). Neu: Aktion `tackle` (Stochern mit der Innenseite, 4 m/s, zur Seite mit mehr Mitspielern, `challenge.ts`). Hineingehen nur, wenn der Ball > 0,6 m vom Führenden weg und mir mindestens so nah ist, oder < 26 m vor dem eigenen Tor. Das Begleittempo beim Stellen richtet sich nach dem Tempo des Ballführers (vorher fest 2,5 m/s + Abstand → Verteidiger fiel zurück).
- **Absichern:** Liegt der Ball < 24 m vor dem eigenen Tor, stellt sich der Feldspieler, der der Linie Ball–Tor am nächsten ist (außer dem ballnächsten), 3 m vor den Ball in diese Linie.
- **Abschirmen und Ballführung:** Unter Druck wird der Ball kürzer vorgelegt (Laufgeschwindigkeit + 0,4 m/s) und auf den gegnerabgewandten Fuß, der Körper bleibt dazwischen (zusammen gemessen: Wechsel 1607 → 1546, Tore 16,5 → 12,8/90; enge Ballführung allein war früher verworfen).
- **Durch den Ball laufen:** Wer auf die andere Seite des Balls musste, lief geradewegs hindurch und schob ihn mit dem Körper weiter (u. a. Eigentore durch Körperkontakte in Richtung eigenes Tor). Neu: Weg um den Ball herum.
- **Entscheidungsmodell kalibriert (gemessen):** Flache Pässe mit vorhergesagt 0,3–0,6 kamen zu 80 % an (Genauigkeits- und Raumterm angepasst, jetzt 0,5–1,0 → 0,83–0,96). Dribblings waren überschätzt (vorhergesagt 0,8–0,9 → 61 % nach 1,5 s noch im Besitz; jetzt 0,3/0,5/0,6 → 0,42/0,65/0,65). Verlustkosten enthalten jetzt auch die eigene Bedrohung, die mit dem Ball verloren geht.
- **Elfmeter (4 in der alten vollen Partie):** Probe mit Seed 2026, 2 × 45 min (identisch mit `npm run sim`): alle 4 Elfmeter durch Verteidiger (LB 2×, LCB, RCB) gegen ST/RW – „hineingehen“ ab 0,75 m Ballabstand mit Anlauf in Schussvorbereitungs-Tempo (Abstand/0,4 s) in den Angreifer. Mit Tackling-Annäherung (2 + 2 · Abstand m/s) und neuer Hineingeh-Regel: 0.
- **Regel 16:** Beim Abstoß stehen Gegner außerhalb des Strafraums.

| pro 90 min (6 Seeds) | vorher | nachher | realer Richtwert |
| --- | --- | --- | --- |
| Tore (davon Eigentore) | 9,0 (2,3) | 7,5 (0,8) | ~2,7 |
| Ballbesitzwechsel (Berührungsfolge) | 1330 | 1449 | ~250 |
| davon nach Dribbling / Ballannahme / Pass / Tackling | 651 / 422 / 199 / – | 476 / 370 / 347 / 167 | – |
| Torschüsse / aufs Tor | 48 / 24 | 17 / 8 | ~25 / ~9 |
| Pässe / Passquote | 563 / 66 % | 842 / 63 % | ~900 / 75–85 % |
| Dribbelberührungen / Tacklings | 1066 / – | 665 / 295 | – |
| Fouls / Elfmeter | 35 / 0,8 | 31 / 0 | ~22 / ~0,3 |
| Einwürfe / Ecken / Abstöße | 95 / 28 / 34 | 176 / 21 / 23 | ~45 / ~10 / ~18 |

Zwischenstände (gleiche Probe): nur gerichtete Mitnahme 33 Tore/90 (13,5 Eigentore), nur Drallkorrektur 18 Tore/90 und 1466 Wechsel – genauere Berührungen allein machten das Spiel ohne bessere Verteidigung torreicher.

**Volle Partie nach den Korrekturen (`npm run sim`, Seed 2026):** Spieldauer 2 × 45 min, `npm run sim -- --silent=false`.

| Messwert | vorher (17.10.2026, nach Realismus-Kalibrierung) | nachher | realer Richtwert |
| --- | --- | --- | --- |
| Ergebnis | 8 : 1 | 3 : 10 (davon 3 Eigentore) | ~1,5 : 1,2 |
| Torschüsse (Team A / B) | 21 / 11 | 9 / 13 | ~13 / 12 |
| Pässe / Passquote | 368 / 67 % | 785 / 64 % | ~900 / ~80 % |
| Ballbesitz | 51 % / 49 % | 48 % / 52 % | – |
| Ball im Spiel | 51 % | 79 % | ~60 % |
| Fouls / Gelb / Rot / Elfmeter | 18 / 3 / 0 / 4 | 26 / 2 / 0 / 0 | ~22 / ~4 / ~0,1 / ~0,3 |
| Abseits / Ecken / Einwürfe / Abstöße | 6 / 23 / 83 / 10 | 4 / 21 / 151 / 27 | ~4 / ~10 / ~45 / ~18 |
| Gefangene Bälle Torwart | 2 | 1 | mehrere |
| Rechenzeit | 963 s (2,97 ms/Tick) | 1083 s (3,34 ms/Tick) | – |

Die 13 Tore dieses Seeds (Ereignisfolgen aus der identischen Probe): 3 Eigentore durch Abpraller vom Körper (nach Parade, Flanke, Klärung), die übrigen fast alle Schüsse aus 7–15 m kurz nach einem Ballgewinn in Tornähe; Torhüter halten solche Schüsse selten.

Bewertung: Elfmeter (4 → 0), Torschüsse, Pässe und Fouls liegen näher am Ziel, Tore pro 90 in der Probe leicht niedriger, aber weiter deutlich über 2–4. Die Ballbesitzwechsel sind **nicht** gesunken (1330 → 1449): Verluste nach Dribbling und Annahme gingen zurück, dafür kamen Tacklings (vorher gab es keine) und mehr Pässe hinzu; ein gescheitertes Stochern zählt in der Berührungsfolge als zwei Wechsel. Passquote 63 % (Ziel 75–85 %): kurze Pässe bis 10 m kommen zu 80 % an, hohe Bälle nur zu ≈ 47 % – sie entstehen vor allem, wenn der Passgeber schon bedrängt ist, und bei Standards (Einwürfe werden mit dem Fuß gespielt; 176 Einwürfe/90, meist nach Abprallern vom Körper).

### Torwart und Rückpassregel (17.10.2026)

Messung: Probe 6 Seeds × 2 × 10 min (Seeds 1–6, pro 90 min hochgerechnet) und ein Schusslabor (240 gerade Schüsse aus 7–15 m auf zufällige Punkte im Tor, 20–28 m/s, Torwart auf seiner Grundposition; beides temporär, nicht im Repo). Tore sind verrauscht (±4/90), deshalb zusätzlich Schüsse, Paraden und Torwartposition beim Schuss.

- **Rückpassregel zu streng (Regel 12):** Jede Schuhberührung eines Mitspielers nahm dem Torwart die Hände – auch ein geblockter Schuss, ein Abfälschen oder ein verunglücktes Stochern. Danach konnte er den Ball nicht fangen oder abwehren. Regel 12 verbietet nur den *absichtlich* zugespielten Ball. Neu: `Touch.deliberate` – absichtlich ist eine Schuhberührung innerhalb von 0,7 s nach einem Pass-, Dribbel- oder Annahmeschwung; Block, Abpraller, Stochern und Klärung nicht. Gilt für die Hände des Torwarts (`isBackPass`) und den Schiedsrichter (indirekter Freistoß). Test: `referee.test.ts`.
- **Torwart weit vor dem Tor:** Bei 3 von 7 Schusstoren (Basis) stand der Torwart beim Schuss 6–14 m vor der Linie. Er lief auch dann zu einem freien Ball im Strafraum, wenn ein Gegner 0,4 s früher dort war, verlor das Laufduell und der Gegner schoss aufs leere Tor. Neu: Er verlässt die Linie nur für einen Ball, den er zuerst erreicht. Liegt er > 2 m neben seiner Position, sprintet er zurück (vorher fest 6 m/s; allein gemessen ohne Effekt, v2).

| pro 90 min (6 Seeds) | Basis | + Körperdämpfung + Rückpass (v1) | + Zurücksprinten (v2) | + nur als Erster raus, mit Körperdämpfung (v4a) | **übernommen: ohne Körperdämpfung (v4b)** | real |
| --- | --- | --- | --- | --- | --- | --- |
| Tore (davon Eigentore) | 7,5 (0,8) | 7,5 (2,3) | 7,5 (0,8) | 5,3 (1,5) | **3,0 (2,3)** | ~2,7 |
| Torschüsse / aufs Tor | 17 / 8 | 19 / 9 | 22 / 13 | 20 / 13 | **14 / 9** | ~25 / ~9 |
| Torwart berührt Schuss / Fänge | 2,3 / 3 | 5,3 / 5 | 6,8 / 5 | 9 / 7 | **8,3 / 5** | – |
| Torwart beim Schusstor > 5 m vor der Linie | 3 von 7 | 0 von 5 | 3 von 8 | 0 von 5 | 2 von 3 | – |
| Pässe / Passquote | 842 / 63 % | 882 / 63 % | 819 / 66 % | 883 / 63 % | **866 / 67 %** | ~900 / 75–85 % |
| Fouls | 31 | 28 | 25 | 23 | **20** | ~22 |

Verworfen (gemessen):
- **Körperdämpfung** (Ball–Körper-Stoßzahl 0,375 → 0,2, Kombinationsregel `Min`): Schusslabor 178 → 172 Paraden von 240; Eigentore durch Abpraller vom Körper wurden nicht weniger (Basis 0,8, v1 2,3, v4a 1,5 pro 90). Ein weicherer Körper lenkt Schüsse weniger weit ab, sie rutschen eher ins Tor. Der Körper hat außerdem Reibung 0 (nötig, damit die Kapsel nicht über den Rasen schleift), deshalb behält ein streifender Ball seine Tangentialgeschwindigkeit; das bleibt offen.
- **Hände vor dem Körper** (Fangpunkt 0,45 m vor der Körpermitte statt in der Körperebene): mehr Fänge (97 → 123), aber weniger Paraden (178 → 169 von 240), mehr Tore bei Schüssen auf den Torwart (17 → 23).

Schusslabor Basis: 74 % Paraden (Mitte 81 %, Seite 75 %, Ecke 63 %). Der Torwart hält also saubere Schüsse von seiner Grundposition aus; die Tore entstanden im Spiel vor allem durch seine Stellung.

Bewertung: Die Probe liegt mit 3,0 Toren/90 im Zielbereich 2–4, bei einem Rauschen von ±4/90 ist das aber **kein gesicherter Nachweis**. Zwei der drei verbliebenen „Eigentore“ sind Torwartberührungen nach einem Schuss (Hände/Körper, danach ins Tor). Auch in v4b stand der Torwart bei 2 von 3 Schusstoren noch 8–14 m vor der Linie: Die Stellung ist besser, aber nicht gelöst (vermutlich spielt er bei eigenem Ballbesitz im Strafraum als Feldspieler mit und wird überrascht – nicht gemessen). Die Ballbesitzwechsel und die Passquote wurden hier nicht bearbeitet.

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026, 2 × 45 min):** Ergebnis 3 : 10 → **5 : 2**; Torschüsse 9 / 13 → 13 / 8; Pässe 785 / 64 % → 837 / 65 %; Ball im Spiel 79 % → 84 %; Fouls 26 → 17, Gelb 2, Elfmeter 0; Abseits / Ecken / Einwürfe / Abstöße 4 / 24 / 159 / 26; gefangene Bälle Torwart 1 → 2; Rechenzeit 1157 s (3,57 ms/Tick). 7 Tore in einer Partie liegen weiter über dem Ziel 2–4.

## 7. Bekannte Grenzen / offene Punkte

- **Spielqualität noch nicht realistisch:** Tore nach Torwartkorrektur in der Probe 3,0/90 (Rauschen ±4), Ballbesitzwechsel (≈ 1450/90) deutlich zu hoch, Passquote 63–67 % zu niedrig, zu viele Einwürfe (siehe §6). Abpraller vom Körper und vom Torwart führen weiter zu Eigentoren; gescheiterte Tacklings und hohe Bälle unter Druck kosten den Ball.
- Der Körper ist eine aufrechte Kapsel (r = 0,27 m, Reibung 0); eine niedrigere Stoßzahl wurde gemessen und verworfen (§6). Ein streifender Ball behält seine Geschwindigkeit; der Torwart kippt beim Hechtsprung nicht mit dem ganzen Körper, nur die Hände reichen weiter.
- Physik läuft mit ≥ 240 Hz (Rapier-Drallgrenze bei 60 Hz); ≈ 50 % mehr Rechenzeit pro Tick.
- Kinematischer Schuh mit unbegrenzter Masse; Volleys über Hüfthöhe und Kopfbälle nicht modelliert.
- Einwurf wird mit dem Fuß ausgeführt; Abseits nutzt Körpermittelpunkte und nur „spielt den Ball“ als Beteiligung; beim Abseits werden absichtliches Spiel und Abpraller nicht unterschieden (bei der Rückpassregel schon).
- Fouls nur aus Körperkontakten; Schuh-gegen-Bein-Kontakte (Grätschen) gibt es nicht.
- Der laufende Spielrhythmus der Beine ist rein visuell (ruhende Schuh-Kollider bleiben unter der Hüfte); Kick-Beine folgen exakt der Physik.
- Ballparameter sind Literaturwerte, keine eigene Messreihe.
- Bei Kurzspielen zeigt die Uhr echte Simulationszeit (z. B. 2 × 5 min), nicht 90 Minuten.
- Ton ist vollständig synthetisiert (keine Fangesänge/Kommentarstimme).
- `window.__match` ist ein lesender Zugriff für das Browser-Prüfskript.
- Bundle: Physik-Chunk 4,6 MB (Rapier-WASM inline).
- `design_variables.css` wurde für das neue Projekt angelegt; weitere Änderungen daran nur nach Abstimmung.

## 8. Phasenprotokoll

1. **Fundament** – neues `package.json`/Lockfile, strikte TS-Konfiguration, Vite/Vitest, Verträge, IFAB-Geometrie, Seed-Zufall.
2. **Physikwelt** – Rapier-Welt mit Teilschritten, Ballmodell, Torgestänge/Netze/Banden, Körper mit begrenzter Motorik, kinematische Schuhe mit geplantem Schwung.
3. **Eigenständiger Fußball** – Match Engine, Wahrnehmung, Positionsspiel, Ballgewinner, Torwart (Hände als Gelenk), Schiedsrichter, `npm run sim`.
4. **Der zwölfte Mann** – Director vor der Spielerentscheidung, Optionen aus der Optionsbewertung des Spielers selbst, Bewegungs- und Teamanweisungen des Benutzers.
5. **Erlebnis** – Stadion mit Shader-Zuschauern, IK-Figuren, TV-Regie inkl. taktischer Entscheidungskamera, Ton, Startbildschirm, HUD, Entscheidungspanel, Zeitraffer, Browser-Prüfskript.
6. **Kalibrierung** – Bremsen vor Körpern, aktive Ballannahme, Passziele innerhalb des Feldes, Schussauswahl, Foul-Schwellen (gemessen über 3 Seeds).
7. **Realismus-Kalibrierung** – Schussmechanik (Freiraum Körper/Ball, Vorhalten, Schuhspitze, Stoßzahl), Ball rollt (240 Hz), Spieler-Ballmodell mit Rutschphase, Entscheidungsrauschen auf Werteskala, xG, Direktspiel, Hechtsprung mit kippendem Oberkörper (gemessen über 6 Seeds und volle Partie).
8. **Ballverluste** – Drallkorrektur der Schwungplanung, Standbeinbeugung, gerichtete erste Ballmitnahme, Abschirmen, Tackling, Begleittempo beim Stellen, Absichern vor dem Tor, Formation erst bei Ballkontrolle, Weg um den Ball, kalibrierte Pass-/Dribbelbewertung, Torwart verteilt nur, Regel 16 (gemessen über 6 Seeds und volle Partie).
9. **Torwart** – Rückpassregel nur bei absichtlichem Zuspiel, Torwart verlässt die Linie nur als Erster am Ball, sprintet zurück; Körperdämpfung und Hände vor dem Körper gemessen und verworfen (6 Seeds, Schusslabor).

## 9. Nächste Schritte

1. Spielqualität: Torergebnis über mehr Seeds absichern; Abpraller vom Körper (streifende Bälle, Torwart-Abpraller ins eigene Tor), Tackling-Erfolg und hohe Bälle unter Druck; Ziel ~250 Ballbesitzwechsel, ~900 Pässe bei 75–85 %, 2–4 Tore (Messung über `npm run sim` und Mehr-Seed-Probe).
2. Echte Einwürfe (Hände) und Grätschen als physische Schuh-Bein-Kontakte inkl. Foulbewertung.
3. Director: weitere Momente (Freistoß-/Elfmeterentscheidung, Wechsel/Taktik zur Halbzeit), Wiederholung (Replay) eines Moments aus den Ereignisdaten.
4. Präsentation: Fangesänge/Kommentar mit lizenzfreien Quellen, Replay-Kamera, hochwertigere Spielermodelle.
5. Optionale KI-Rollen (Match Analyst, Pub Host) über Adapter; Physik und Spiel bleiben offline lauffähig.
