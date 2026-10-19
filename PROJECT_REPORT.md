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
| Decisive Moment Director: Abschluss/Ablage, Durchsetzen, Konter, Gegenpressing, Durchbruch des Gegners, Gefahr vor dem eigenen Strafraum; „KI entscheiden lassen“ | Implementiert, getestet | `director/moment-director.ts` |
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

### PR #8 und Leistungskorrektur (17.10.2026)
- **PR #8 nicht gemergt:** Er stammt vom alten Prototyp-Branch (vor dem Neustart, inkl. altem PR #2) und importiert Module (`./match`, `./pitch`, `./kick-decision`), die es im neuen `main` nicht mehr gibt; GitHub meldet Konflikte. Ein Merge hätte den Build zerstört und Altcode zurückgebracht. Die zwei darin enthaltenen, im Neuaufbau noch fehlenden Funktionen wurden stattdessen in die neue Architektur übernommen:
  - Moment **„Gefahr vor dem eigenen Strafraum“** (`box-defence`): Zustellen (anlaufen und stochern), Schussbahn blocken (in die Linie Ball–Tor) oder Ordnung halten (torseitig verzögern) – als Bewegungsanweisung an den nächsten Verteidiger, körperlich ausgeführt.
  - **„KI entscheiden lassen“** (Button und Taste `0`): wählt die Option, die die Spieler ohnehin gewählt hätten, und wird als `delegated` protokolliert (neben `user` und `timeout`).
- **Leistungsfehler aus PR #5–#7 behoben:** Ein Physikschritt kostete 2,72 ms statt 1,49 ms; im Browser sank die Bildrate auf 36 FPS. Ursachen: (1) vier Physik-Teilschritte in *jedem* Tick, (2) die neue Rutsch-/Roll-Vorhersage des Balls wurde pro Optionsbewertung zehntausendfach neu integriert. Korrektur: vier Teilschritte nur, solange der Ball auf dem Rasen läuft (Flug/Ruhe: einer); Bodenball-Profile je Abschussgeschwindigkeit (0,05-m/s-Stufen) werden einmal berechnet und danach nur durchsucht. Gemessen: 2,02 ms pro Schritt, Optionswahl 0,65 → 0,02 ms pro Tick, **Browser 47 FPS** (Intel Iris Xe, 1600 × 900). Alle Tests unverändert grün.

### Ballbesitzwechsel – Messwerkzeug und Ursachenanalyse (17.10.2026)

**Neu im Repo:** `npm run probe` (`scripts/probe.mjs`) startet mehrere Seeds parallel (Standard 1–6, 2 × 10 min) und rechnet auf 90 min hoch; die Auswertung steckt in `engine/match-stats.ts` (getestet) und wird auch von `npm run sim` genutzt. Ballbesitzwechsel zählen entlang der Berührungsfolge (Unterbrechungen setzen zurück); zusätzlich: Art der letzten Berührung des Verlierers (Schwungart, Körper, Hände), „Ping-Pong“ (Rückgewinn < 1 s) und mittlere Besitzdauer. Die Mehr-Seed-Probe früherer Abschnitte war nicht eingecheckt; Werte daraus sind mit diesen nicht exakt vergleichbar.

**Ausgangswerte `main` (pro 90 min):**

| Messwert | Seeds 1–6 | Seeds 7–12 | real |
| --- | --- | --- | --- |
| Ballbesitzwechsel / davon Ping-Pong | 1603 / 479 | 1490 / 434 | ~250 Ballbesitzphasen (nicht dieselbe Zählweise) |
| Pässe / Passquote | 849 / 57 % | 842 / 59 % | ~900 / 75–85 % |
| Tore / Fouls / Einwürfe | 8,3 / 29 / 133 | 6,0 / 26 / 146 | ~2,7 / ~22 / ~45 |

**Ursachen (temporäre Einzelanalysen pro Schwung und pro Takt, 3 Seeds, nicht eingecheckt):**
- Fast jeder Verlust folgt auf einen *gewollten* Schwung des Verlierers (Abpraller ohne Schwung kaum). Nach einer eigenen Dribbelberührung gewinnt in 52–74 % der Fälle der Gegner den Ball (auch mit 3–5 m Abstand zum nächsten Gegner), nach einer Ballannahme in 35–50 %; der Dribbler berührt den Ball im Mittel nur alle 1,5 s.
- Mechanik: Nach dem Treffpunkt blieb der Körper bis zum Ende des ganzen Schwungs (bis ≈ 1 s bei weichen Berührungen) an das geplante Lauftempo gebunden; leichte Berührungen holten so weit aus wie Pässe (Schuh 0,5–1 m/s über 0,32 m).
- Entscheidung: Ist nach der eigenen Berührung ein Gegner dem Ball kurz näher, hält der Dribbler ihn für den Ballführer und geht ins Stellen über (bremst, überlässt ihm den Ball).
- Pässe: 49 % der Pässe kommen unter Druck (Gegner < 1,5 m), ≈ 45 % sind hohe Bälle (davon ≈ 50 % verloren); bei 64 % war die beste Passoption mit < 0,4 Erfolg bewertet. Es fehlen nahe, freie Anspielstationen.

**Gemessen und verworfen** (Seeds 1–6, gegengeprüft auf 7–12 gegen `main`):

| Variante | Wechsel | Passquote | Fouls | Bewertung |
| --- | --- | --- | --- | --- |
| Körper ab Treffpunkt frei steuerbar | 1490 → 1416 | 59 → 57 % | 26 → 40 | Verluste nach Annahme −28 %, aber deutlich mehr Fouls |
| + Stellen nur gegen den Gegner, der zuletzt am Ball war | 1466 | 50 % | 29 | Verluste wandern vom Dribbling zum Pass |
| + kurze Ausholbewegung bei weichen Berührungen | 1454 | 49 % | 33 | kein Effekt auf Wechsel |
| + Ballführer bremst erst kurz vor Körpern | 1260 (1–6) | 56 % | 45 | weniger Wechsel nur durch mehr Unterbrechungen |
| Engere Ballführung im freien Raum | 1502 (1–6) | 55 % | 26 | schlechter |
| Ballbesitzwert 0,015 in den Verlustkosten | 1426 (1–6) | 49 % | 29 | ohne Anpassung beim Klären: 512 Einwürfe/90 |

Bewertung: Keine Variante senkt die Wechsel außerhalb des Rauschens (≈ ±5 %) ohne an anderer Stelle (Passquote, Fouls) schlechter zu werden; deshalb ist keine davon übernommen. Die Mechanikbefunde bleiben richtig, wirken aber erst, wenn der Ballführer unter Druck eine sichere Alternative hat.

### Anspielstationen und erneute Messung der Mechanikkorrekturen (17.10.2026)

- **Anspielstationen** (`ai/support.ts`): Hat ein Mitspieler den Ball, laufen die zwei nächsten Feldspieler (ohne den Ballführer) in freie Passwege 9 oder 13 m vom Ball entfernt (12 Richtungen). Bewertet werden offener Passweg, Raum um den Punkt, etwas Raumgewinn, Nähe zur eigenen Formationsposition und Laufweg; nie im Abseits, nicht beide am selben Ort (≥ 7 m). Dezentral: jeder bestimmt aus seiner eigenen Wahrnehmung, ob er einer der beiden ist und welchen Punkt der andere nimmt. Tests: `support.test.ts`.
- **Körper ab dem Treffpunkt frei** (`Legs.committed()`): Der Körper hält das geplante Tempo nur bis der Schuh 0,1 m über den Treffpunkt hinaus ist; danach steuert der Spieler wieder (neuer Schwung erst nach dem Zurückholen des Beins). Test in `physics.test.ts`.
- **Ballführer-Reichweite für Verteidiger:** War der Gegner zuletzt am Ball, gilt er als Ballführer, solange der Ball ≤ 1,6 m (vorher 1,1 m) von ihm liegt: Der Verteidiger stellt ihn, statt in die Annahme hineinzusprinten (das verursachte die zusätzlichen Fouls der freien Steuerung). Für den eigenen Ballbesitz bleibt 1,1 m.

Gemessen auf 12 Seeds (1–12, 2 × 10 min, pro 90 min), jede Zeile kumulativ:

| Variante | Wechsel | Passquote | Pässe | Fouls | Einwürfe | Tore |
| --- | --- | --- | --- | --- | --- | --- |
| `main` | 1546 | 58 % | 846 | 28 | 139 | 7,2 |
| Anspielstationen (S) | 1494 | 61 % | 959 | 28 | 143 | 8,3 |
| S + Körper ab Treffpunkt frei (M1) | 1355 | 59 % | 1002 | 32 | 140 | 9,0 |
| S + M1 + Stellen nur gegen letzten Ballspieler, Reichweite 1,6 m (M2) | 1279 | 52 % | 1099 | 41 | 170 | 6,8 |
| **übernommen: S + M1 + Reichweite 1,6 m nur für Verteidiger** | **1301 (−16 %)** | **57 %** | 981 | **29** | 170 | 6,0 |
| … + kurze Ausholbewegung (M3) | 1345 | 60 % | 972 | 43 | 168 | 6,8 |
| … + Ballführer bremst erst bei 1,4 m (M4) | 1289 | 58 % | 1010 | 42 | 158 | 9,8 |

Verworfen bleiben M2 (Passquote −5 Punkte, Fouls +12), M3 und M4 (je +13 Fouls ohne gesicherten Gewinn). Übernommen sind nur Änderungen, die auf beiden Seed-Hälften in dieselbe Richtung zeigten.

Bewertung: Die Ballbesitzwechsel sinken erstmals messbar (−16 %), vor allem nach Ballannahmen (Verluste ≈ 186/90; main Seeds 7–12: 305) und Dribblings (344; main 7–12: 464); Passquote und Fouls bleiben auf dem Stand von `main`. Weiter offen: Einwürfe sind gestiegen (139 → 170, Ziel ~45), die Passquote liegt mit 57 % weit unter 75–85 %, und ≈ 400 der Wechsel sind Ping-Pong-Berührungen (< 1 s).

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026, 2 × 45 min):** Ergebnis 5 : 2 → **1 : 2** (davon 2 Eigentore); Torschüsse 13 / 8 → 10 / 3; Pässe 837 / 65 % → 1002 / 59 %; Ballbesitzwechsel 1331 (davon 407 Ping-Pong; vorher nicht gemessen); Fouls 17 → 30, Gelb 0, Elfmeter 1; Abseits / Ecken / Einwürfe / Abstöße 7 / 14 / 149 / 24; Ball im Spiel 86 %; Rechenzeit 361 s (1,11 ms/Tick, ohne parallele Last). Die einzelne Partie streut stark; maßgeblich ist die 12-Seed-Probe.

### Passquote und Einwürfe (17.10.2026)

Ursachen (temporäre Einzelanalyse, 6 Seeds × 2 × 10 min, nicht eingecheckt):
- **Einwürfe:** 40 % entstehen durch einen Pass direkt ins Aus, 23 % durch Klärungen, 23 % durch Abpraller vom Körper.
- **Pässe:** 41 % aller Pässe waren hohe Bälle; davon erreichten nur 47 % einen Mitspieler, 36 % den Gegner, 17 % gingen ins Aus. Flache Pässe kamen zu 78 % an. Der hohe Ball wurde gewählt, sobald seine Sicherheit die des flachen Passes auch nur knapp überstieg.
- 82 der 139 abgefangenen flachen Pässe prallten innerhalb von 3 m am Gegner ab: Die Passbewertung gab einem Gegner direkt in der Passlinie wegen der angenommenen Reaktionszeit (0,25 s) nur ≈ 20 % Abfangrisiko.

Neu: **Flacher Pass bevorzugt** (`LOFT_MARGIN` 0,3 in `options.ts`): Ein hoher Ball wird nur gespielt, wenn er um 0,3 sicherer aussieht als der flache Pass zum selben Mitspieler.

12 Seeds (1–12, 2 × 10 min, pro 90 min):

| Variante | Wechsel | Passquote | Fouls | Einwürfe | Tore |
| --- | --- | --- | --- | --- | --- |
| Ausgang (Stand nach #11) | 1301 | 57 % | 29 | 170 | 6,0 |
| A: hohe Bälle auf 85 % der Distanz (springen zum Mitspieler) | 1390 | 60 % | 42 | 127 | 7,5 |
| C: flach bevorzugt, Abstand 0,15 | 1298 | 59 % | 34 | 160 | 7,1 |
| A + C (0,15) | 1383 | 61 % | 36 | 134 | 4,1 |
| **übernommen: C, Abstand 0,3** | **1276** | **59 %** | **32** | **162** | **2,6** |
| C 0,3 + Körper in der Passlinie blockt (bis 85 %) | 1374 | 60 % | 36 | 162 | 8,6 |
| C, Abstand 0,45 | 1311 | 58 % | 35 | 175 | 3,8 |

Verworfen: A (weniger Einwürfe, aber mehr Wechsel und Fouls – umkämpfte Bälle am Landepunkt) und der Linienblock (die Spieler dribbeln statt zu passen; Dribbelverluste 372 → 439). Fouls schwanken zwischen sonst gleichwertigen Varianten um ±4/90.

Bewertung: Kleiner, aber in allen Messwerten gleichgerichteter Gewinn (Passquote +2 Punkte, Wechsel −2 %, Einwürfe −5 %); die Tore liegen in dieser Probe erstmals im Zielbereich, bei ±2–3 Rauschen aber nicht gesichert. Passquote (59 %) und Einwürfe (162) bleiben deutlich vom Ziel entfernt. Der nächste Hebel ist die Entscheidung unter Druck (49 % der Pässe werden mit einem Gegner < 1,5 m gespielt): Abschirmen/Ballhalten, bis eine Anspielstation frei ist.

### Ballhalten und Abschirmen unter Druck (17.10.2026)

- **Neue Option „Ball abschirmen“** (`shield` in `options.ts`): Bei starkem Druck (`pressureOn` ≥ 0,5, Gegner ≲ 2,4 m) eine kurze Berührung vom nächsten Gegner weg (geradeaus oder ±0,6 rad, je nach freiem Raum), 1,4–2,4 m/s. Die Ausführung legt den Ball auf den gegnerabgewandten Fuß (bestehende Abschirmlogik in `execution.ts`). Bewertet als Halten des Ballwerts an Ort und Stelle; jede Abschirmberührung kostet 0,003 xT (die Abwehr ordnet sich in der Zwischenzeit). Wird eine Anspielstation frei, ist der Pass mehr wert. Tests: `options.test.ts`.
- **Verteidiger stellt mit Abstand:** Näher als 1,5 m am Ballführer läuft er nur noch mit dessen Tempo + 0,5 m/s mit, statt weiter heranzurücken.
- **Kein Stochern durch den Gegner:** Steht der Ballführer zwischen Verteidiger und Ball, geht der Verteidiger nicht hinein. Gemessen: 41 von 49 Fouls kamen von hinten, meist von Verteidigern, die durch den Ballführer zum Ball wollten.

Kalibrierung (6 Seeds): Bei vorhergesagten 50–60 % blieb der Ball nach einer Abschirmberührung in 94 % der entschiedenen Fälle bei der Mannschaft. Ohne Zeitkosten wurde fast nur noch abgeschirmt (8 Schüsse/90).

12 Seeds (1–12, 2 × 10 min, pro 90 min):

| Variante | Wechsel | Passquote | Schüsse | Fouls | Einwürfe | Tore |
| --- | --- | --- | --- | --- | --- | --- |
| Ausgang (Stand nach #12) | 1276 | 59 % | 15 | 32 | 162 | 2,6 |
| Abschirmen ab Druck 0,3, ohne Zeitkosten | 821 | 65 % | 8 | 42 | 129 | 1,9 |
| Druck 0,5, Zeitkosten 0,003 (V1) | 1112 | 62 % | 14 | 42 | 158 | 2,6 |
| Druck 0,3, Zeitkosten 0,006 | 1289 | 59 % | 14 | 37 | 147 | 4,5 |
| Druck 0,5, Zeitkosten 0,0015 | 1041 | 63 % | 15 | 44 | 132 | 6,8 |
| V1 + Stellen mit Abstand (V4) | 1091 | 60 % | 16 | 39 | 156 | 4,1 |
| **übernommen: V4 + kein Stochern durch den Gegner** | **1031 (−19 %)** | **61 %** | **15** | **34** | 150 | 3,4 |
| … + Verteidiger läuft um den Ballführer herum | 1112 | 61 % | 5 | 29 | 155 | 2,3 |
| V4 + nur Herumlaufen | 1150 | 60 % | 12 | 32 | 143 | 5,3 |

Verworfen: Herumlaufen um den Ballführer. Zusammen mit der Stochern-Regel fielen die Schüsse auf 5/90, weil Torchancen bisher vor allem aus Ballgewinnen entstehen.

Bewertung: Ballbesitzwechsel −19 %, Passquote +2 Punkte, Einwürfe −7 %, Schüsse unverändert; Fouls leicht über dem Ausgang (34 statt 32, Rauschen ±4). Gegenüber `main` vor diesem Abschnitt (#9) jetzt 1546 → 1031 Wechsel und 58 → 61 % Passquote. Weiter offen: Passquote (Ziel 75–85 %), Einwürfe (150, Ziel ~45), Torschüsse (15, Ziel ~25). Chancen entstehen noch kaum aus aufgebautem Angriffsspiel (Läufe in die Tiefe, Flanken, Abschluss nach Kombination).

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026, 2 × 45 min):** Ergebnis 1 : 2 → **0 : 5** (1 Eigentor); Torschüsse 10 / 3 → 6 / 8; Pässe 1002 / 59 % → 974 / 61 %; Ballbesitzwechsel 1331 → 1097 (Ping-Pong 407 → 302, mittlere Besitzdauer 2,8 → 3,3 s); Fouls 30 → 41 (Gelb 3, Elfmeter 1); Abseits / Ecken / Einwürfe / Abstöße 9 / 13 / 143 / 18; Rechenzeit 427 s (1,32 ms/Tick). Die Fouls dieser einzelnen Partie liegen über der 12-Seed-Probe (34). 5 Tore aus 14 Schüssen sind Rauschen einer einzelnen Partie, aber ein Grund, die Abschluss- und Torwartbilanz weiter zu beobachten.

### Angriffsspiel im letzten Drittel – Analyse, keine Übernahme (18.10.2026)

**Neue Messgröße:** `shotsAfterBuildUp` in `match-stats.ts` (getestet) und `npm run probe`: Schüsse am Ende eines Angriffs mit mindestens drei angekommenen Pässen seit dem Ballgewinn.

**Befund (Stand nach #13, 12 Seeds, pro 90 min):** 15 Torschüsse, davon **0** nach einer Kombination; alle entstehen nach Ballgewinnen. Einzelanalyse (6 Seeds, temporär): Nur ≈ 117 Angriffe pro Partie (beide Teams) erreichen das letzte Drittel, 2 % davon enden mit einem Schuss. Fast alle gehen dort bei der ersten Aktion verloren (Median 0 Pässe im letzten Drittel), meist beim Dribbling oder der Annahme eines Stürmers mit einem Gegner auf 1,2 m. Pro Ballbesitz gibt es im Mittel ≈ 1 Pass (real ≈ 5).

Gemessen (12 Seeds, Ausgang: 1031 Wechsel, 61 %, 15 Schüsse, 34 Fouls, 3,4 Tore):

| Variante | Wechsel | Passquote | Schüsse (nach Kombination) | Fouls | Einwürfe | Tore |
| --- | --- | --- | --- | --- | --- | --- |
| Abseits am Standort des Empfängers beim Abspiel (Regel 11) | 1030 | 58 % | 15,8 (0) | 34 | 166 | 6,0 |
| + Läufe in die Tiefe, Strafraumbesetzung (Pfosten, Rückraum) | 1047 | 62 % | 12,8 (0,8) | 41 | 147 | 6,0 |
| + Pässe in den Lauf (Vorlauf = Ballreisezeit, max. 2,5 s) | 882 | 49 % | 22,1 (0) | 34 | 143 | 10,1 |
| Abseits + Läufe + Schuss ab xG 0,03 | 1030 | 61 % | 18 (0,8) | 50 | 158 | 5,3 |
| Abseits + Läufe + Schuss ab xG 0,04 | 1049 | 59 % | 18 (0,8) | 34 | 159 | 7,1 |
| Abseits + Schuss ab xG 0,04 (ohne Läufe) | 998 | 60 % | 18,4 (0,4) | 30 | 164 | 7,5 |

Nichts davon ist übernommen:
- **Läufe/Strafraumbesetzung** bringen nichts, solange der Angriff schon bei der ersten Aktion im letzten Drittel endet.
- **Abseitskorrektur** ist regelrichtig, aber das Passmodell ist für Steilpässe nicht kalibriert: Passquote −3 Punkte, mehr Einwürfe. Sie gehört zusammen mit einer Kalibrierung der Steilpässe umgesetzt.
- **Niedrigere Schussschwelle** bringt realistischere Schusszahlen (18), aber die Tore verdoppeln sich (3,4 → 7,5): Zusätzliche Schüsse mit xG ≈ 0,04 gehen viel zu oft ins Tor. Zuerst muss die Verwertung stimmen; schon im Ausgang treffen 23 % der Schüsse (real ≈ 10 %).
- Fouls streuen zwischen Varianten mit gleichem Defensivverhalten um bis zu ±8/90; Unterschiede darunter sind kein Befund.

Der Code der Versuche (`ai/attack.ts`, Abseitskorrektur, Vorlauf) ist nicht im Repo; Beschreibung und Messwerte stehen hier.

### Chancenverwertung und Torwart gegen Distanzschüsse (18.10.2026)

**Korrektur zum vorigen Abschnitt:** Die Aussage „23 % der Schüsse sind Tore“ war falsch, denn dort waren alle Tore durch die Zahl der Schüsse geteilt. Neue Messgröße `goalsFrom` (`match-stats.ts`, getestet; in `npm run probe`): wie jedes Tor fiel. Stand `main` (12 Seeds, pro 90 min): 3,4 Tore, davon 1,5 nach Schuss (10 % von 15 Schüssen, realistisch), **1,1 Eigentore** (real ≈ 0,1), 0,8 sonstige (Pass, Körper).

**Neues Werkzeug `npm run lab`** (`shot-lab.test.ts`): je 60 Schüsse aufs Tor aus 8/12/16/20/25 m mit 26 m/s gegen den Torwart allein, Ziel gleichverteilt über das Tor, ohne Schützenfehler.

| Torwart hält (Labor) | 8 m | 12 m | 16 m | 20 m | 25 m |
| --- | --- | --- | --- | --- | --- |
| vorher | 90 % | 83 % | 72 % | **13 %** | **13 %** |
| Hechtsprung dosiert | 92 % | 90 % | 80 % | 27 % | 28 % |
| **+ Ballhöhe richtig, Sprung nur außerhalb der Handreichweite** | 92 % | 92 % | 92 % | **85 %** | **92 %** |

Ursachen (Einzelverfolgung im Labor, temporär):
- **Hechtsprung zu früh und zu weit:** Er sprang, sobald der Ball < 0,7 s entfernt war, immer mit voller Kraft (4–5 m/s), und rutschte ungebremst weiter. Bei 20 m stand er beim Eintreffen einen Meter jenseits der Ballbahn; der Ball ging innen vorbei. Neu: Die Sprungkraft ist so dosiert, dass die Hände (nicht der Körper) genau beim Eintreffen auf der Ballbahn sind; innerhalb von 0,9 m neben dem Körper kein Sprung (`keeper.ts`, `KeeperHands.dive` mit Tempo).
- **Ballhöhe falsch geschätzt:** Die Wahrnehmung schrieb die Position eines fliegenden Balls mit Schwerkraft fort, seine senkrechte Geschwindigkeit aber nicht. Der Torwart hielt sinkende Bälle für bis zu 0,7 m höher, also für unerreichbar, und sprang (`perception.ts`).

Im Spiel (12 Seeds, pro 90 min):

| Variante | Schüsse | Tore nach Schuss (Quote) | Tore gesamt (Eigentore) | Passquote | Wechsel | Fouls |
| --- | --- | --- | --- | --- | --- | --- |
| `main` (Schuss ab xG 0,06) | 15 | 1,5 (10 %) | 3,4 (1,1) | 61 % | 1031 | 34 |
| Schuss ab xG 0,04, alter Torwart | 20,3 | 4,1 (**20 %**) | 6,0 (1,5) | 59 % | – | – |
| Torwart-Korrektur, xG 0,06 | 14,3 | 1,5 (10 %) | 3,8 (2,3) | 61 % | 1032 | 30 |
| **übernommen: Torwart-Korrektur + Schuss ab xG 0,04** | **19,9** | **2,3 (12 %)** | **4,1 (1,1)** | 59 % | 1116 | 35 |

Bewertung: Spieler schießen jetzt auch aus ≈ 20 m (19,9 statt 15 Schüsse/90, real ≈ 25); die Quote bleibt realistisch (12 %). Die überzähligen Tore sind Eigentore (1,1/90). Verfolgt: harte Rückpässe (> 20 m/s) zum Torwart, der den Ball nicht in die Hand nehmen darf (Rückpassregel), ihn nur abstoppt und auf das eigene Tor weiterrollen lässt. Im Labor sind Nahschüsse (8–12 m) mit 92 % zu oft gehalten (real ≈ 50–65 %); der Torwart sieht dort den Ball ohne Schussvorbereitung sofort. Im Spiel liegt die Quote aber im Zielbereich.

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026, 2 × 45 min):** 0 : 5 → **3 : 1**: 1 Tor nach Schuss, 1 nach Pass, 2 Eigentore. Torschüsse 4 / 6 (weniger als in der Probe), Pässe 942 / 60 %, Wechsel 1042, Fouls 47, Gelb 1, Einwürfe 140, Rechenzeit 486 s (1,5 ms/Tick). Auch hier stammen die überzähligen Tore aus Eigentoren. Die 47 Fouls dieser einzelnen Partie liegen deutlich über der Probe (35); Fouls schwanken pro Partie stark.

**Director-Tests angepasst, ein bestehender Fehler aufgedeckt:**
- „Gleiche Entscheidung, unterschiedlicher Ausgang“: Ein Schuss aus 19 m wurde in allen 6 Wiederholungen gefangen. Mit 12 Wiederholungen: 9 gefangen, 2 im Aus, 1 im Spiel, kein Tor (real ≈ 5–8 % aus dieser Entfernung). Der Test nutzt jetzt 12.
- „Gefahr vor dem eigenen Strafraum“: Der Test maß den Abstand Verteidiger–Gegner. Der Gegner schießt jetzt aus 21 m, statt auf den Verteidiger zuzudribbeln; deshalb misst der Test den Lauf des Verteidigers selbst. Dabei zeigte sich: **„Zustellen“ und „Ordnung halten“ bewirken in dieser Situation dasselbe**, auch auf `main` (je 1,12 m in 0,6 s), weil der nächste Verteidiger ohnehin mit voller Geschwindigkeit zum Ballführer läuft. Die Entscheidung ist hier wirkungslos. Festgehalten als `it.fails` in `moment-director.test.ts`; behoben im folgenden Abschnitt.

### Strafraum-Verteidigung: drei Optionen, drei Körperbewegungen (18.10.2026)

Ursache des wirkungslosen Moments: Der Verteidiger steht beim Moment still, der Gegner schießt nach ≈ 0,6 s. „Ordnung halten“ war „keine Vorgabe“, und die eigene KI läuft als Ballgewinner ohnehin mit voller Beschleunigung an; „Zustellen“ konnte nicht schneller sein. „Schussbahn blocken“ lief zu einem beim Moment festgelegten Punkt, der mit dem Ballführer veraltete.

Neu (`src/ai/box-orders.ts`, Bewegungsanweisungen `press`, `block-lane`, `jockey`; jede endet, sobald der Ball > 2,5 m vom Ballführer weg ist, danach liest der Spieler das Spiel wieder selbst):
- **Zustellen:** mit voller Geschwindigkeit zum Ball, in Reichweite Stochern (Tackling-Schwung), nie durch den Körper des Gegners hindurch (dann torseitig herum).
- **Schussbahn blocken:** Punkt 1,8 m vor dem Ball auf der Linie zur Tormitte, jeden Tick neu, volle Geschwindigkeit, Körper zum Ball, kein Zweikampf.
- **Ordnung halten:** torseitig 3,5 m vor dem Ballführer, Tempo nur dessen Tempo plus 0,6 × Abstand: verzögern statt angreifen.

Gemessen (Seed 9, Ballführer 21 m vor dem Tor, Verteidiger 4 m torseitig): Annäherung in 0,6 s Zustellen 1,14 m (aus dem Stand begrenzt die Beschleunigung, wie vorher), Blocken 1,14 m, Ordnung halten 0,74 m; der Schuss trifft beim Blocken (und hier auch beim Zustellen) den Körper des Verteidigers, beim Halten geht er zum Torwart. Beides sind jetzt normale Tests. Die autonome Partie nutzt keinen Director, die Probe ist daher unverändert: `npm run probe -- --seeds 1-12` ergibt wie in der Tabelle oben 19,9 Schüsse, 2,3 Tore nach Schuss, 4,1 Tore (1,1 Eigentore), 59 %, 1116 Wechsel, 35,3 Fouls pro 90 min.

### Eigentore nach Rückpässen (18.10.2026)

Verfolgt (12 Seeds, alle 3 Eigentore in 240 min):
- ein harter, hoch angesetzter Rückpass (21,6 m/s), der vom Torwart ins Tor sprang;
- ein Ball quer vor dem Tor, den der Torwart abstoppte und beim Nachlaufen mit dem Körper ins Tor schob;
- ein Rückpass auf einer Linie direkt aufs Tor, den der Torwart nur mit dem Körper traf.

**Übernommen** (auf Entscheidung des Auftraggebers): **Rückpass zum Torwart nie hoch** (`options.ts`; Test `options.test.ts`, der ohne die Regel fehlschlägt).

**Gebaut, gemessen, verworfen:**
- Rückpass nur auf einer Linie, die bei einem Fehler neben dem Tor endet (sonst neben den Torwart).
- Torwart schlägt einen Ball weg, der auf sein Tor rollt und den er nicht fangen darf.

Keine der drei Regeln senkt die Eigentore messbar: Sie sind zu selten (≈ 6 in 480 Spielminuten, Rauschen ±2–3). Ein Rückpass-Labor (200 nachgestellte Situationen) brachte nur 4–5 Rückpässe, also keine Aussage.

12 Seeds (pro 90 min):

| | `main` | Rückpass nie hoch |
| --- | --- | --- |
| Tore (nach Schuss / Eigentore) | 4,1 (2,3 / 1,1) | 2,6 (1,5 / 1,1) |
| Torschüsse | 19,9 | 19,5 |
| Passquote / Wechsel | 59 % / 1116 | 60 % / 1136 |
| Fouls / Einwürfe | 35 / 150 | 43 / 164 |

Die Regel betrifft nur wenige Pässe; die Unterschiede bei Fouls, Einwürfen und Toren liegen im bekannten Rauschen (Fouls ±8, Tore ±2–3). Sie ist eine Plausibilitätsregel, deren Wirkung nicht nachweisbar ist. Eigentore bleiben bei ≈ 1,1/90.

### Ballbehauptung im letzten Drittel und Bedrohungskurve (18.10.2026)

Analyse (temporär, 6 Seeds, alle Aktionen des angreifenden Teams im letzten Drittel):
- Abschirmen hielt den Ball (14 % verloren);
- Pässe gingen zu 25 % verloren, bei einem erwarteten Erfolg von im Mittel 0,40;
- Ballannahmen gingen zu 30 % verloren, auch mit mehr als 3 m Platz;
- Dribblings gingen zu 54 % verloren.

Taktweise Verfolgung verlorener Annahmen: Lag der Ball nach der weichen Annahme ruhig vor dem Fuß, konnte der Spieler erst nach 0,5–0,6 s wieder schießen oder passen. Der Schuh gab mit 0,6 m/s 25 cm nach und das Bein holte sich zurück; in dieser Zeit lief der Gegner von 5 m auf 1 m heran.

Übernommen:
- **Weiche Annahme kürzer** (`legs.ts`): Der Schuh gibt nur noch 8 cm nach, Nachschwingen und Zurückholen sind kürzer. Das Bein ist innerhalb von 0,5 s nach dem Kontakt wieder frei (vorher ≈ 0,8 s). Test in `physics.test.ts`.
- **Erste Berührung enger, je weniger Platz** (`first-touch.ts`): Tempo 0,9 m/s plus 0,45 m/s je Meter Raum, höchstens wie bisher; der Raum zum Gegner zählt bei der Richtungswahl stärker. Allein ohne messbare Wirkung, aber Teil der gemessenen Endkonfiguration.
- **Bedrohungskurve steiler** (`threatAt` in `options.ts`): 0,006 + 0,5·e^(−d/8) statt 0,006 + 0,32·e^(−d/13). Das ergibt ≈ 0,13 am Elfmeterpunkt, 0,06 an der Strafraumgrenze und 0,02 aus 30 m, wie veröffentlichte xT-Raster. Die alte Kurve bewertete Ballbesitz vor dem Strafraum fast doppelt so hoch; Abschirmen aus 18 m war dort mehr wert als ein Schuss. Test in `options.test.ts`.

12 Seeds (pro 90 min):

| Variante | Schüsse | Tore (nach Schuss / Eigentore) | Passquote | Wechsel | Fouls | Einwürfe |
| --- | --- | --- | --- | --- | --- | --- |
| `main` | 19,9 | 4,1 (2,3 / 1,1) | 59 % | 1116 | 35 | 150 |
| weiche Annahme kürzer + enge erste Berührung | 13,9 | 2,3 (1,5 / 0,8) | 63 % | 1123 | 36 | 145 |
| **+ Bedrohungskurve d/8 (übernommen)** | **22,1** | **3,4 (2,6 / 0,8)** | **62 %** | 1249 | 38 | **126** |
| + Bedrohungskurve d/10 | 22,5 | 3,0 (1,9 / 1,1) | 60 % | 1158 | 36 | 148 |

Mit den kürzeren Annahmen allein wurde das Spiel ruhiger: mehr Ballbesitz im letzten Drittel (716 statt 560 Aktionen in 6 Seeds) und Passquote 63 %. Dafür fielen die Schüsse auf 14, weil Chancen bisher aus Ballgewinnen in Tornähe entstanden. Die realistischere Bewertungskurve bringt die Schüsse auf 22 (real ≈ 25) bei 12 % Torquote; Tore 3,4/90 (real ≈ 2,7), Einwürfe 126 (vorher 150). Die Ballbesitzwechsel steigen auf 1249: Es wird mehr geschossen und riskanter nach vorne gespielt. Schüsse nach Kombination bleiben selten (0–0,8/90).

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026, 2 × 45 min):** **1 : 1** (1 Tor nach Schuss, 1 Eigentor). Torschüsse 11 / 16, davon 2 nach Kombination; Pässe 1070 / 58 %; Wechsel 1314; Fouls 39 (Gelb 4, Elfmeter 1); Einwürfe 129; Torwart fängt 8; Rechenzeit 374 s (1,15 ms/Tick).

### Passquote: Abfangmodell und Wert des Ballbesitzes (18.10.2026)

Analyse (temporär, 7 Seeds, jeder Pass mit Plan und Ausgang):
- Flache Pässe wurden massiv unterschätzt: erwartet < 20 % (Median 26 m) → 54 % angekommen, 40–60 % → 79 %, 60–80 % → 91 %. Deshalb wurden hohe Bälle gewählt (38 % aller Pässe, nur 36 % angekommen, 18–22 % ins Aus).
- Echte Luftlöcher sind selten: 9 % der Passschwünge treffen den Ball nicht, davon ist in 78 von 124 Fällen ein Mitspieler zuerst am Ball.

Übernommen (`options.ts`):
- **Abfangmodell mit Reaktion und Beschleunigung:** Ein Gegner startet nach 0,25 s und beschleunigt mit 6 m/s² auf sein Höchsttempo; vorher hatte er es ab dem ersten Schritt. Danach ergeben erwartete 60–80 % tatsächlich 83 %. Test in `options.test.ts`.
- **Wert des Ballbesitzes 0,02** (≈ xG pro Ballbesitz im Profifußball) in den Verlustkosten. Eine Klärung kostet 60 % davon. Gemessen mit 0,01 / 0,02 / 0,03 / 0,04.
- **Director** (`moment-director.ts`): Der Angriffsmoment nutzte feste Wertschwellen (Option > 0,004, beste ≥ 0,035, Abstand als Verhältnis), die mit dem Bewertungsmodell der KI wandern. Mit dem Ballbesitzwert fiel jeder riskante Pass darunter, und der Moment öffnete nicht mehr. Neu wählt der Director Pass und Dribbling nur, wenn sie mindestens 30 % Erfolg versprechen; ein Schuss wird immer angeboten. Die Stakes sind erfüllt, wenn das xT der Ballposition oder das xG des Schusses mindestens 0,035 beträgt. Eine echte Zwickmühle liegt vor, wenn Optionen höchstens 0,05 hinter der besten liegen.

12 Seeds (pro 90 min), Ausgang ist der Stand nach #19:

| Variante | Wechsel | Passquote | Pässe | Schüsse (nach Kombination) | Tore | Fouls | Einwürfe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stand nach #19 | 1249 | 62 % | 1062 | 22,1 (0) | 3,4 | 38 | 126 |
| Abfangmodell | 1274 | 59 % | 1434 | 21 (0,8) | 2,3 | 40 | 105 |
| + Ballbesitzwert 0,01 | 1178 | 59 % | 1409 | 22,5 (1,1) | 4,1 | 40 | 97 |
| **+ Ballbesitzwert 0,02 (übernommen)** | **1065** | **61 %** | 1392 | **22,5 (2,3)** | **3,4** | 40 | **96** |
| + Ballbesitzwert 0,03 | 1127 | 60 % | 1379 | 21 (1,9) | 2,6 | 33 | 89 |
| + Ballbesitzwert 0,04 | 1079 | 60 % | 1362 | 19,5 (1,5) | 3,4 | 50 | 80 |

Bewertung: Die Wechsel sinken um 15 %, die Einwürfe von 126 auf 96, und erstmals entstehen messbar Schüsse nach Kombinationen (2,3/90). Die **Passquote bleibt bei ≈ 60 %** und liegt damit weiter weit unter dem Ziel 75–85 %. Mit diesen Hebeln ist das Ziel nicht erreichbar. Es wird mehr gepasst als real (≈ 1400 statt ≈ 1000/90). Fouls schwanken zwischen gleichwertigen Varianten um bis zu ±8 und liegen weiter bei ≈ 40 (Ziel ≈ 22).

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026):** 1 : 2, alle 3 Tore nach Schüssen; Torschüsse 19 / 10 (2 nach Kombination); Pässe 1397 / 60 %; Wechsel 1134; Fouls 46; Einwürfe 90; Rechenzeit 552 s.

**Neuer Befund zum Director (auch auf `main`):** Mit den App-Einstellungen (Abklingzeit 75 s, höchstens 5 Momente pro Halbzeit) öffnete der Director in 4 Partien à 2 × 10 min 40 Momente: 30–33 Gegenpressing, 4–6 Strafraumverteidigung, 2 Konter, 1–2 Durchbruch. **Kein einziger Angriffsmoment („Abschluss oder Ablage?“).** Die Gegenpressing-Momente füllen das Limit pro Halbzeit, bevor ein Angriffsmoment entsteht. Behebung: nächster Schritt (§9).

### Director: Momente ausbalanciert (18.10.2026)

Messung mit den App-Einstellungen (Abklingzeit 75 s, höchstens 5 pro Halbzeit), 4 Partien à 2 × 10 min, Nutzerteam 0:

| | vorher | nachher |
| --- | --- | --- |
| Momente gesamt | 40 | 31 |
| Angriff („Abschluss oder Ablage?“, „Durchsetzen oder abspielen?“) | **0** | **14** |
| Gegenpressing / Konter | 30–33 / 2 | 6 / 1 |
| Strafraumverteidigung / Durchbruch | 4–6 / 1–2 | 8 / 2 |

Ursachen und Korrekturen (`moment-director.ts`):
- **Gegenpressing bei jeder gegnerischen Berührung:** Auch ein kurzer Abpraller in unserer Angriffshälfte reichte; ohne Limits waren es ≈ 39 pro 20 min. Jetzt nur nach einem echten Ballverlust: Wir hatten den Ball mindestens 4 s, und der Gegner hat ihn jetzt am Fuß.
- **Ein gemeinsames Limit für alle Momentarten:** Die häufigste Art füllte jede Halbzeit. Jetzt hat jede Gruppe ein eigenes Kontingent pro Halbzeit (innerhalb des Gesamtlimits): Angriff 3, Umschalten 1, Abwehr 2.
- **Angriffsmoment verpasst:** Zwischen Ballannahme und nächstem Schwung bleibt dem Ballführer wenig Zeit, und alle 0,25 s geprüft lag der Ballführer meist schon im Schwung. Jetzt wird alle 0,1 s geprüft. Die Stakes-Schwelle liegt bei xT oder xG 0,02 (≈ 27 m zentral) statt 0,035.

Test: `moment-director.test.ts` prüft zusätzlich, dass pro Halbzeit höchstens ein Umschaltmoment kommt.

### Fouls: Aufholen an der Schulter (18.10.2026)

Analyse (temporär, 12 Seeds, 107 Fouls = 40/90): 80 begingen Verteidiger beim Stellen oder Ansetzen zum Stochern, 85 von hinten, meist mit 3–5 m/s Annäherung. Ein Verteidiger auf der falschen Seite lief zu seinem Punkt zwischen Ballführer und Tor und dabei durch dessen Rücken.

Übernommen (`brain.ts`): Steht der Ballführer zwischen dem Verteidiger und diesem Punkt, holt der Verteidiger 1,1 m seitlich an der Schulter auf (Tempo des Ballführers + 1,5 m/s), statt durch ihn hindurchzulaufen. Test in `keeper.test.ts`: Mit dem alten Code blieb der Verteidiger in 6 von 6 Szenen genau hinter dem Angreifer (seitlicher Versatz ≈ 0), mit dem neuen zieht er seitlich vorbei (≈ 0,9 m).

12 Seeds (pro 90 min), Ausgang ist der Stand nach #20:

| | nach #20 | Schulter |
| --- | --- | --- |
| Fouls | 40 | **31** |
| Elfmeter | – | 1,1 |
| Schüsse (nach Kombination) | 22,5 (2,3) | 23,6 (1,1) |
| Tore | 3,4 | 3,4 |
| Passquote / Wechsel | 61 % / 1065 | 59 % / 1150 |
| Einwürfe | 96 | 93 |

Verbleibend (82 Fouls): 48 weiterhin von hinten beim Stellen, oft gegen einen Spieler, der gerade gepasst hat (35 der 82). Der Verteidiger kommt mit Schwung an und kann nicht mehr bremsen. Elfmeter mit 1,1/90 zu häufig (real ≈ 0,3). Die Schwellen des Schiedsrichters (von hinten 2,8 m/s, von vorn 4,0 m/s) sind bewusst unverändert: Sie wurden für die Bewertung kalibriert, nicht für die Foulzahl.

### Einwürfe – Analyse, keine Übernahme (18.10.2026)

Stand nach #22: 93 Einwürfe/90 (am Anfang dieser Serie 150, real ≈ 45). Ursachen (temporär, 12 Seeds, 248 Einwürfe):
- 52 % durch Pässe, fast alle hohe Bälle (52 von 58 in einer Stichprobe), Abschuss ≈ 22 m/s aus zentraler Position ohne Gegnerdruck. Ziel 15–50 m entfernt, 18–26 m neben der Mitte.
- 29 % durch Abpraller vom Körper.
- jeweils < 8 % durch Dribbling, Annahme und Klärung.

Physik geprüft: Hohe Bälle kommen nahe am Zielpunkt auf (Abweichung 0–6 m auf 15–50 m), rollen danach aber 25–30 m weiter, wenn der Empfänger sie nicht kontrolliert. Gelingt die Annahme nicht (etwa jeder zweite hohe Ball), geht der Ball meist ins Aus.

Gemessen (12 Seeds, pro 90 min) und **verworfen**:

| Variante | Einwürfe | Schüsse | Fouls | Wechsel |
| --- | --- | --- | --- | --- |
| Stand nach #22 | 93 | 23,6 | 31 | 1150 |
| kein hoher Ball auf Ziele < 8 m von der Seitenlinie | 88 | 23,6 | 29 | 1136 |
| hoher Ball landet bei 85 % der Distanz | **66** | **10,9** | 26 | 1237 |

Der kürzer gespielte hohe Ball senkt die Einwürfe deutlich, halbiert aber die Torschüsse: Lange Bälle erreichen die Angreifer nicht mehr. Der nächste Ansatz wäre ein besseres Annehmen herunterfallender Bälle (zum Landepunkt laufen, nach dem Aufsprung kontrollieren), statt seltener lang zu spielen.

### Annahme hoher Bälle: zum Landepunkt laufen (18.10.2026)

Analyse (temporär, 12 Seeds, 993 hohe Pässe): Nur 10 % endeten mit einer Fußberührung des Empfängers, 51 % beim Gegner, 14 % im Aus. Beim Aufkommen stand der Empfänger in 421 von 601 Fällen mehr als 5 m vom Landepunkt entfernt, nur in 66 näher als 2 m. Die Spieler berechneten den Treffpunkt, als würde der Ball rollen, und liefen entlang seines Schattens auf dem Rasen.

Übernommen: **Flugbahn-Vorhersage** (`ai/aerial.ts`): Schwerkraft, Luftwiderstand, Aufsprung (mittlere Stoßzahl Ball/Rasen, Reibung) und Ausrollen. Der Spieler läuft zum ersten Punkt, an dem der Ball wieder höchstens 0,5 m hoch ist und den er rechtzeitig erreicht. Das gilt für alle (Empfänger, Gegner, Torwart, die Entscheidung, wer zum Ball geht). Test `aerial.test.ts`: Die Vorhersage trifft die Rapier-Flugbahn auf < 1,5 m und < 0,15 s.

Danach in derselben Stichprobe: Empfänger < 2 m vom Landepunkt 145 statt 66; ins Aus 8 % statt 14 %; Fußberührung des Empfängers 13 %. Der Gegner kam aber öfter an den Ball (59 %): Meist prallt der Ball in der Luft von einem Körper ab, weil Kopfball und Brustannahme fehlen.

24 Seeds (pro 90 min):

| Variante | Einwürfe | Passquote | Schüsse | Tore (nach Schuss / Eigentore) | Fouls | Wechsel |
| --- | --- | --- | --- | --- | --- | --- |
| `main` (nach #23) | 94 | 59 % | 23,5 | 3,2 (2,5 / 0,6) | 28 | 1137 |
| **Landepunkt (übernommen)** | **70** | **61 %** | 21,8 | 1,9 (1,2 / 0,8) | 30 | 1220 |
| + Brustannahme (Körper federt ab) | 66 | 60 % | 22,5 | 2,8 (1,3 / 1,5) | 28 | 1209 |

Verworfen: **Brustannahme**. Ein Empfänger, der einen hohen Ball erwartet, machte seinen Körper weich (Stoßzahl 0). Das brachte in der Einzelanalyse mehr Fußberührungen (16 %), in der Probe aber keinen gesicherten Gewinn. Außerdem setzte der Torwart-Code den Zustand nicht zurück.

Erste Probe: Mit der Landepunkt-Vorhersage fiel die Torquote je Schuss auf 1,2 von 21,8 (≈ 5 %, vorher ≈ 10 %, real ≈ 10 %). Die Seed-Hälften streuen stark (1–12: 0,8 Tore; 13–24: 3,0 wie `main`). Mehr gefangene Bälle des Torwarts (8,3 statt 5,3 auf 13–24) passen dazu, dass er hohe Bälle jetzt richtig anläuft.

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026):** **4 : 6**: 7 Tore aus 28 Schüssen, 3 Eigentore. Pässe 1452 / 62 %; Fouls 21; Einwürfe 57; Ball im Spiel 92 %; Rechenzeit 752 s (2,3 ms/Tick). Die Partie widerspricht der niedrigen Torquote der Probe (25 % statt 5 %). Tore streuen pro Partie und pro Seed-Gruppe so stark, dass erst mehr Seeds (z. B. 48) eine Aussage über die Torquote erlauben.

**Torquote abgesichert (48 Seeds, 18.10.2026):** Seeds 1–48 je 2 × 10 min, Stand vor #24 (`9ff4b50`) gegen #24. Die Seeds 25–48 zählen doppelt, weil es 24 statt 12 sind.

| pro 90 min | vor #24 | mit #24 | real |
| --- | --- | --- | --- |
| Torschüsse | 24,0 | 20,7 | ≈ 25 |
| Tore nach Schuss (Quote) | 2,73 (11,4 %) | 1,73 (8,3 %) | ≈ 10 % |
| Tore gesamt (Eigentore) | 3,75 (0,95) | 3,0 (1,1) | ≈ 2,7 |

Bewertung: Der Unterschied bei den Toren nach Schuss (≈ 29 gegen ≈ 18 Tore in 960 Spielminuten) liegt bei etwa 1,5 Standardabweichungen und ist **nicht gesichert**. Die Torquote mit #24 liegt im realistischen Bereich, die Gesamttore kommen näher an den realen Wert. Die 5 % der ersten Probe waren Zufall der Seeds 1–12. Am Spiel wird deshalb nichts korrigiert. Die Torschüsse liegen etwas niedriger (−14 %, ebenfalls ≈ 1,6 Standardabweichungen).

### Kopfball (19.10.2026)

Bisher prallte ein hoher Ball, den niemand mit dem Fuß erreichte, zufällig vom Rumpf ab. Das war die häufigste erste Berührung eines hohen Balls (§6, hohe Bälle).

Neu:
- **`physics/head.ts`:** Eine Kopfkugel (r = 0,11 m), die nur während eines Kopfballs aktiv ist. Sie bewegt sich mit konstanter Geschwindigkeit entlang der Stoßnormalen durch den Ball; Rapier löst den Kontakt. Die Normale zeigt von der Ankunfts- zur gewünschten Abfluggeschwindigkeit (reibungsfreier Stoß), das Kopftempo folgt aus der Stoßzahl. Gibt der Kopf nach, ist es negativ. Reichweite: 0,15–0,6 m vor der Körperachse, bis 0,35 m Sprung. Der Ball darf dabei den Rumpf nicht streifen. Höchsttempo 7 m/s, nachgeben bis 3 m/s. Bis kurz vor dem Kontakt wird der Kopfball jeden Takt mit dem aktuellen Ballzustand neu geplant, wie ein Spieler, der den Ball mit den Augen verfolgt. Die Physik teilt den Takt in Unterschritte wie bei einem Schuss.
- **`ai/heading.ts`:**
  - **Klären** (Ball vom Gegner in unserer Hälfte, hoch und weg vom Tor);
  - **Kopfball aufs Tor** (< 14 m, Ecke weg vom Torwart, ≈ 0,5 m Höhe an der Linie);
  - **Ablegen** auf einen freien Mitspieler in 5–18 m;
  - sonst **vor die eigenen Füße**.
  
  Geköpft wird, wenn der Gegner den Ball gespielt hat, wenn er umkämpft ist (Gegner < 3 m) oder vor dem gegnerischen Tor. Sonst lässt der Spieler den eigenen Pass herunterfallen.
- **Gemeinsame Luftkräfte:** `airAcceleration()` in `physics/ball.ts` (Luftwiderstand mit Drag-Krise, Magnus-Auftrieb) wird von der Physik, der Kopfball-Planung und der Flugbahn-Vorhersage gleichermaßen genutzt. Spieler nehmen den Drall des Balls wahr. Vorher fehlte der Auftrieb: Ein hoher Ball war beim geplanten Kontakt 0,6 m höher als vorhergesagt.
- Neue Kontaktart `head` und Aktion `header`. Ein Kopfball zum eigenen Torwart ist kein Rückpass (Regel 12 gilt nur für den Fuß).

Einzelanalyse (6 Seeds):

| | erste Version | mit Drall, Luftwiderstand und Nachplanen |
| --- | --- | --- |
| Kopfballversuche / Kopfberührungen | 164 / 41 (25 %) | 183 / **119 (65 %)** |
| Körpertreffer in der Luft (über 1,3 m) | 154 (45) | 117 (19) |

24 Seeds (pro 90 min):

| | nach #24 | mit Kopfball |
| --- | --- | --- |
| Einwürfe | 70 | **61** |
| Torschüsse | 21,8 | **22,9** |
| Tore (nach Schuss / Eigentore) | 1,9 (1,2 / 0,8) | **3,0 (2,1 / 0,9)** |
| Passquote | 61 % | 60 % |
| Wechsel / Fouls | 1220 / 30 | 1252 / 33 |

Tests: `head.test.ts` (Ballrichtung ±0,25 rad, Tempo ±30 % für drei Ziele, darunter ein nachgebender Kopfball; keine Reichweite für zu hohe oder seitliche Bälle), `heading.test.ts` (Wahl Klären / Torschuss / Ablegen / vor die Füße), `aerial.test.ts`.

**Volle Partie (`npm run sim -- --silent=false`, Seed 2026):** **3 : 2** (4 Tore nach Schuss, 1 Eigentor). Torschüsse 7 / 6; Pässe 1489 / 61 %; Wechsel 1281; Fouls 27; Einwürfe 81; Rechenzeit 477 s (1,5 ms/Tick).

Offen: In 24 Seeds fiel kein Kopfballtor (real ≈ 15 % der Tore). Die Spielerfigur springt und nickt in der Darstellung nicht sichtbar mit; das Rendern zeigt nur den Ball.

### Fouls – Analyse, keine Übernahme (19.10.2026)

Stand mit Kopfball (24 Seeds): ≈ 33 Fouls/90 (real ≈ 22). Einzelanalyse (12 Seeds, 84 Fouls):
- 54 begehen Verteidiger beim Stellen oder Stochern, fast alle von hinten;
- 67 mit 2,8–4,5 m/s Annäherung, nur 17 schneller;
- in 45 Fällen hat das Opfer den Ball noch am Fuß, in 36 hat es ihn gerade gespielt oder angenommen.

Gemessen (24 Seeds) und **verworfen**:

| Variante | Fouls | Einwürfe | Schüsse (nach Kombination) |
| --- | --- | --- | --- |
| Stand mit Kopfball | 33,4 | 61 | 22,9 (2,1) |
| Verteidiger nähert sich nur so schnell, dass er 1,2 m vor dem Ballführer stoppen kann | 32,1 | 63 | 23,6 (1,5) |
| + Hineingehen zum Stochern nur mit Tempo des Ballführers + 1,5 m/s | 30,9 | 72 | 24,2 (0,4) |

Keine Variante senkt die Fouls über das Rauschen (≈ ±2,5/90 bei 24 Seeds) hinaus, die zweite verschlechtert Einwürfe und Kombinationsschüsse. Die verbleibenden Fouls sind echte Körperkontakte von hinten knapp über der Schwelle des Schiedsrichters (2,8 m/s von hinten, 4 m/s von vorn, 5,6 m/s im Zweikampf um einen freien Ball). Wie viel Kontakt ein Schiedsrichter laufen lässt, ist eine Gestaltungsentscheidung. Eine Anpassung der Schwellen würde die Zahl direkt senken, bewusst nicht ohne Abstimmung.

### Schiedsrichter: leichte Kontakte von hinten laufen lassen (19.10.2026)

Auf Entscheidung des Auftraggebers wurde die Foulschwelle für Kontakte von hinten angehoben (`FOUL_FROM_BEHIND` in `referee.ts`). Von vorn (4 m/s) und im Zweikampf um einen freien Ball (5,6 m/s) bleibt sie gleich. Gemessen (24 Seeds, pro 90 min):

| Schwelle von hinten | Fouls | Elfmeter | Tore | Schüsse | Einwürfe | Passquote |
| --- | --- | --- | --- | --- | --- | --- |
| 2,8 m/s (vorher) | 33,4 | – | 3,0 | 22,9 | 61 | 60 % |
| 3,5 m/s (angefragt) | 15,8 | 0,2 | 2,6 | 21,4 | 68 | 60 % |
| **3,2 m/s (übernommen)** | **23,1** | **0,4** | 2,8 | 22,5 | 64 | 60 % |
| real | ≈ 22 | ≈ 0,3 | ≈ 2,7 | ≈ 25 | ≈ 45 | 75–85 % |

Angefragt waren 3,5 m/s; damit pfeift der Schiedsrichter nur noch 16 Fouls, deutlich unter dem realen Wert. 3,2 m/s trifft Fouls und Elfmeter fast genau und ist deshalb übernommen. Tests in `referee.test.ts`: Ein Kontakt von hinten mit 4 m/s ist ein Foul, ein leichter mit 3 m/s läuft weiter.

### Passquote: Zählung korrigiert, längere flache Pässe härter (19.10.2026)

Eine Diagnose jedes Passes (8 Seeds, 1316 Pässe: Ziel, Ausführung, wer den Ball als Nächster berührt) ergab, dass die bisher gemeldeten ≈ 60 % zur Hälfte ein Zählfehler waren:

- **Direktpässe zählten als Fehlpass.** Ein Mitspieler, der den Ball direkt weiterspielt, holt aus, bevor er ihn berührt. Die Statistik ersetzte den offenen Pass schon beim Ausholen, sodass der angekommene Pass verloren ging (176 von 1316). Auch Luftschläge (Ausholen ohne Schuhkontakt) zählten als Pass.
- **Korrektur in `match-stats.ts`:** Ein Pass zählt erst, wenn der Schuh den Ball innerhalb von 0,7 s nach dem Ausholen trifft. Die Berührung des Mitspielers schließt zuerst den angekommenen Pass ab. Am Spiel ändert sich nichts; dieselben Partien ergeben **74 % statt 60 %** und 3,9 statt 2,3 Schüsse nach Kombination. Test: Direktpass und Luftschlag in `match-stats.test.ts` (schlägt auf dem alten Stand fehl).

Echte Schwäche: Pässe ab 15 m wurden fast alle hoch gespielt (15–30 m: 198 von 238) und kamen nur zu 50–62 % an. Grund: Jeder flache Pass war auf 3,5 m/s Ankunftstempo bemessen, ein 25-m-Pass rollte also langsam und galt in der Bewertung als leicht abzufangen. **Neu:** Ab 10 m steigt das Ankunftstempo um 0,15 m/s pro Meter, höchstens 7 m/s (`PASS_ARRIVAL_PER_M`, `PASS_ARRIVAL_MAX` in `options.ts`). Diagnose danach: 15–20 m 62 → 72 %, 20–30 m 50 → 66 %, hohe Bälle in diesem Bereich 198 → 125.

| 48 Seeds (1–24 und 25–48), pro 90 min | Ausgang (korrigiert) | längere Pässe härter |
| --- | --- | --- |
| Passquote | 74 % | 76 % |
| Pässe | 1334 | 1362 |
| Schüsse (nach Kombination) | 20,7 (2,4) | 22,4 (3,2) |
| Ballbesitzwechsel | 1226 | 1181 |
| Tore (Eigentore) | 3,2 (0,9) | 3,7 (1,2) |
| Einwürfe | 64 | 62 |

Die Tore stiegen auf den Seeds 1–24 von 2,8 auf 3,8, auf 25–48 blieben sie gleich (3,6/3,6), also Rauschen. Gemessen und verworfen: Ein Gegner, dessen Beine in der Passlinie stehen, blockt ohne Reaktionszeit (bisher kostete er einen Pass nur ≈ 20 %, 50 von 96 verlorenen kurzen Pässen wurden in den ersten Metern geblockt). Kurze Pässe kamen in der Diagnose häufiger an (82 → 87 %), über 24 Seeds aber 75 statt 76 % und mehr Ballbesitzwechsel (1239 statt 1163).

Bewertung: Die Passquote liegt mit 76 % im realen Bereich (75–85 %). Offen bleiben lange Bälle über 30 m (≈ 46 %, real ≈ 50–60 %) und mehr Pässe als real (≈ 1360 statt ≈ 1000/90).

### Lange Bälle: Schussphysik für hohe Bälle – Analyse, noch keine Übernahme (19.10.2026)

Diagnose (8 Seeds, alle Pässe ab 25 m): Hohe Bälle kamen zu ≈ 47 % an und landeten im Median 10–15 m neben dem Ziel. Ursache ist der Schuss, nicht die Flugberechnung: Nur ≈ 40 % starteten innerhalb ±0,05 rad des geplanten Winkels (0,42 rad), 17 % mit weniger als 60 % des geplanten Tempos.

Zwei Fehler in `legs.ts`, beide im Startlabor (`lofted-strike.test.ts`, fünf Lagen ohne Fehler) belegt:

1. **Waagerechter Schuh.** Die Planung nimmt an, dass sich der Schuh entlang der Kontaktnormale bewegt. Er schwang aber waagerecht, glitt bei hohen Bällen über den Ball und Reibung drückte ihn flach. **Gebaut:** Ab 0,3 rad kommt der Schuh flach heran und steigt auf den letzten 8 cm entlang der Normale durch den Ball.
2. **Schuh hinkt dem Körper nach.** Er wurde relativ zur Körperposition *vor* dem Teilschritt gesetzt und lag bei einem laufenden Spieler einen Teilschritt zurück (2 cm bei 5 m/s). **Gebaut:** Er wird auf die Körperposition am Ende des Teilschritts gesetzt.

Labor: vorher 0,36–0,50 rad und bis zu 20 statt 25 m/s, mit beiden Korrekturen 25 m/s bei 0,414–0,445 rad in allen fünf Lagen. Im Spiel bleibt die Streuung aus dem zufälligen Ausführungsfehler (≈ 0,05 rad je cm Kontakthöhe): hohe Bälle ab 30 m 45 → 48 %.

| pro 90 min | main | nur steigender Schuh (48 Seeds) | nur Nachlauf-Korrektur (Seeds 1–24) | beide (48 Seeds) |
| --- | --- | --- | --- | --- |
| Schüsse | 22,4 | 21,3 | 17,3 | 18,3 |
| Tore (aus Schüssen) | 3,7 (2,4) | 5,6 (3,8) | 4,3 (2,8) | 4,0 (2,6) |
| Eigentore | 1,2 | 1,6 | 1,5 | 1,7 |
| Einwürfe | 62 | 54 | 56 | 56 |

Die Schüsse fehlen nicht durch Luftschläge (45 von 48 bzw. 27 von 30 Schusschwüngen treffen den Ball). Mit der Nachlauf-Korrektur wird öfter gedribbelt (Dribbelschwünge +19 %, mehr Fehltritte) und seltener geschossen. Der steigende Schuh macht hohe Bälle und Flanken präzise, die Tore steigen auf 5,6/90.

Bewertung: Beide Korrekturen sind physikalisch richtig, aber Dribbeln, Schussauswahl und Torwart sind auf den fehlerhaften Schuss kalibriert. Übernahme erst zusammen mit dieser Nachkalibrierung (Branch `claude/12th-man-long-balls`).

**Nachkalibrierung.** Diagnose (8 Seeds) mit beiden Korrekturen:
- Die Schussauswahl selbst ist unverändert, xG und Entscheidungen nahe am Tor sind gleich.
- Der Angriff kommt seltener in Schussnähe: Ballentscheidungen 0–25 m vor dem Tor −31 %, dafür mehr Dribblings und Pässe bei 25–35 m.

Der nachhängende Schuh hatte wie ein zusätzlicher Schussfehler proportional zum Lauftempo gewirkt (2 cm bei 5 m/s), in jedem Schuss, Pass, Tackling und Dribbling. Ohne ihn treffen Verteidiger beim Stochern und Angreifer beim Abschluss genauer. **Neu:** Das eigene Lauftempo ist ein bewusster Teil des Ausführungsfehlers (`PACE_NOISE` in `execution.ts`: 8 m/s zählen wie der Grundfehler). Mit 4 m/s fiel die Torquote auf 2,6 %.

| pro 90 min (48 Seeds) | main | beide Korrekturen | + Tempoanteil |
| --- | --- | --- | --- |
| Schüsse | 22,4 | 18,3 | 21,4 |
| Tore aus Schüssen (Quote) | 2,4 (10,7 %) | 2,6 (14 %) | 2,7 (12,6 %) |
| Eigentore | 1,2 | 1,7 | 1,65 (0,9 / 2,4 je Seed-Hälfte) |
| Einwürfe | 62 | 56 | 55 |
| Fouls | 22,8 | – | 19,5 (16,7 / 22,3) |
| Passquote | 76 % | 76,5 % | 76,5 % |

Bewertung: Schüsse und Torquote sind wieder nahe an `main` und am realen Wert, Einwürfe besser. Offen und Hindernis für die Übernahme: Eigentore (1,65/90, real ≈ 0,1 pro Partie) schwanken stark zwischen den Seed-Hälften und treiben die Tore auf 4,4/90. Sie lagen schon auf `main` zu hoch.

**Eigentore.** Protokoll aller Eigentore (24 Seeds, je die letzten sechs Berührungen):
- **Drei von fünf** waren Rückpässe aus 15–20 m mit 10–15 m/s auf einer Linie direkt ins Tor. Der Torwart lenkte sie mit dem Körper ins Netz oder erreichte sie nicht. Echte Verteidiger spielen zum Torwart seitlich am Pfosten vorbei, ein Fehler gibt dann Ecke statt Tor.
- **Eines** war ein Schuss, den der Torwart mit dem Körper ins Tor lenkte. Der Schiedsrichter wertete jede letzte Berührung der Verteidiger als Eigentor; statistisch ist das ein Tor des Schützen.
- **Eines** war ein Abpraller eines Blocks mit 33 m/s, nicht behoben.

**Neu:**
- `rollsIntoOwnGoal` in `options.ts`: Ein Pass zum eigenen Torwart, der bei einem Fehler noch zwischen den Pfosten (± 1,5 m) über die Linie rollen würde, ist keine Option mehr.
  - Für alle Pässe Richtung eigenes Tor angewandt, nahm die Regel auch sichere Rückpässe im Mittelfeld weg: Schüsse 17/90.
- **Schiedsrichter:** Lenkt die verteidigende Mannschaft den Ball nur mit Körper oder Händen ins Tor, innerhalb von 1,5 s nach einer Berührung der Angreifer, zählt das als deren Tor (`DEFLECTION_WINDOW`).
- Tests: `options.test.ts` (Rückpass auf das Tor, Rückpass seitlich) und `referee.test.ts` schlagen auf dem alten Stand fehl.

| pro 90 min (48 Seeds) | main | + Tempoanteil | + Eigentor-Korrekturen (Regel nur zum Torwart) |
| --- | --- | --- | --- |
| Eigentore | 1,2 | 1,65 | **0,4** |
| Tore (aus Schüssen) | 3,7 (2,4) | 4,4 (2,7) | **3,1** (2,55) |
| Schüsse | 22,4 | 21,4 | 19,3 (21,0 / 17,6) |
| Torquote | 10,7 % | 12,6 % | 13 % |
| Einwürfe | 62 | 55 | 55 |
| Fouls | 22,8 | 19,5 | 20,4 |
| Passquote | 76 % | 76,5 % | 75,5 % |

Bewertung: Tore (3,1) und Eigentore (0,4) sind erstmals nahe am realen Wert (≈ 2,7 bzw. ≈ 0,1). Weiter offen: Schüsse 19/90 (real ≈ 25) bei leicht hoher Torquote.

## 7. Bekannte Grenzen / offene Punkte

- **Spielqualität** (48 Seeds, Stand 19.10.2026): Im Zielbereich sind Passquote ≈ 76 %, Fouls ≈ 23/90, Elfmeter ≈ 0,4/90 und Torschüsse ≈ 22/90. Leicht darüber liegen die Tore (≈ 3,5/90, real ≈ 2,7). Noch nicht realistisch: Pässe ≈ 1360/90 (real ≈ 1000), Einwürfe ≈ 62/90 (real ≈ 45), Eigentore ≈ 1/90, Schüsse nach Kombination ≈ 3/90, lange Bälle über 30 m ≈ 46 %, keine Kopfballtore (siehe §6).
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
10. **Ballbesitz** – Messwerkzeug `npm run probe`, Ursachenanalyse der Ballverluste, Anspielstationen, Körper ab dem Treffpunkt frei, Ballführer-Reichweite für Verteidiger, flacher Pass bevorzugt, Ballhalten/Abschirmen unter Druck, Verteidiger stellt mit Abstand und stochert nicht durch den Gegner, Torwart gegen Distanzschüsse, Schuss ab xG 0,04 (gemessen über 12 Seeds und Schusslabor).

## 9. Nächste Schritte

1. Spielqualität (Messung mit `npm run probe -- --seeds 1-12`): (a) **Kopfballtore und Brustannahme** – Kopfbälle aufs Tor treffen noch nicht; ohne Brustannahme prallen hohe Bälle unterhalb der Kopfhöhe weiter vom Rumpf ab; Kopfball in der Darstellung zeigen. (b) **Fouls** ≈ 23/90 nach angepasster Schiedsrichterschwelle (§6) – im Zielbereich. (c) **Passquote** ≈ 76 % (§6) – im Zielbereich; offen sind lange Bälle über 30 m und die Passzahl (≈ 1360 statt ≈ 1000/90). (d) Eigentore (≈ 1/90) und Torwart bei Nahschüssen im Labor zu stark (92 %).
2. Echte Einwürfe (Hände) und Grätschen als physische Schuh-Bein-Kontakte inkl. Foulbewertung.
3. Director: weitere Momente (Freistoß-/Elfmeterentscheidung, Wechsel/Taktik zur Halbzeit), Wiederholung (Replay) eines Moments aus den Ereignisdaten.
4. Präsentation: Fangesänge/Kommentar mit lizenzfreien Quellen, Replay-Kamera, hochwertigere Spielermodelle.
5. Optionale KI-Rollen (Match Analyst, Pub Host) über Adapter; Physik und Spiel bleiben offline lauffähig.