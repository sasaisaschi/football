# THE 12TH MAN – Technical Report & Development Guide

**Stand:** 22.10.2026 · Phase B (#33) auf `main` gemergt; **Phase-B-Restarbeiten auf Branch `claude/phase-b-arbeitsauftrag-8042ea` (Folge-PR, Abnahme offen)** – Ergebnisse, Messwerte und Nicht-Erreichtes in §10.10. Frühere Messwerte bleiben historisch datiert.
**Rolle:** verbindliche Source of Truth für Architektur, tatsächlichen Stand, Versionen, Tests, Messwerte und nächste Schritte.
**Kennzeichnung:** **Implementiert** = Code vorhanden · **Getestet** = durch tatsächlich ausgeführte Tests belegt · **Gemessen** = Zahl aus einem tatsächlichen Lauf · **Geplant** = nicht vorhanden · **Nicht geprüft** = vorhanden, ohne Nachweis.

## 1. Produktauftrag (README.md)

Elf gegen elf spielen eigenständig Fußball. Ein **Decisive Moment Director** erkennt seltene Situationen, in denen eine Entscheidung des Benutzers den Verlauf spürbar beeinflussen kann, und bietet nur ausführbare Optionen an. Die Entscheidung ändert Handlungsmöglichkeiten, nicht das Ergebnis: Körper, Fußkontakt, Ballphysik, Gegner und Schiedsrichter bestimmen, was passiert. Keine geskripteten Szenen, keine Teleports, keine garantierten Erfolge. Leerlauf darf verdichtet (schneller abgespielt), aber nicht erfunden werden.

**Verbindliche Präzisierung (20.10.2026):** Das Endprodukt ist **kein klassisch steuerbares Fußballspiel und keine passive Vollspiel-Übertragung mit gelegentlichen Dialogen**, sondern eine **interaktive, agentenbasierte Fußball-Entscheidungssimulation**. Die 11v11-Engine ist die kausale Grundlage; im Vordergrund stehen die vom **Orchestrator** präsentierten 3D-Entscheidungssituationen, die Wahl des Menschen und die tatsächlich daraus entstehenden Folgen. Vollständige Spezifikation und Abnahme: **§10**. `MomentDirector` bezeichnet bis zur kontrollierten Umstellung noch die vorhandene Implementierung; der Produktbegriff lautet ab jetzt **Orchestrator**.

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
  orchestrator/ E  Orchestrator: Ablaufsteuerung + Lageerkenner (open-play, set-pieces, coach)
  sim/       E' Chronologischer SimRunner, Web Worker, Frame-Übertragung, Präsentationsregie (Playback)
  ui/        F  Start, HUD/Verlauf, Entscheidungs-Seitenleiste, Konsequenzkarte, Ergebnis (CSS neben TS)
  render/    G  Stadion, Rasen, Spielerfiguren, Ball, TV-Regie, Entscheidungs-Framing, Taktik-Overlays
  audio/     G  synthetisierter Stadionton aus echten Ereignissen
  app.ts     Browser-Sitzung: Worker-Client, Regie, Interpolation, Ereignisverteilung in Bildreihenfolge
  main.ts    Einstieg, Renderer, Licht, URL-Parameter
scripts/browser-check.mjs   echter Browserlauf (npm run test:browser; CHECK_FULL=1: ganze Partie)
scripts/probe.mjs           Mehr-Seed-Statistik (npm run probe; --orchestrator: Momentverteilung)
```

**Verbindliche Regeln**
1. **Single writer:** Nur `engine` + `physics` ändern Körper- und Ballzustand; alle anderen lesen `MatchSnapshot` oder liefern Absichten (`PlayerIntent`, `TeamInstruction`). Schnittstellen: `src/engine/types.ts`.
2. **Ball ohne Abkürzung:** Im Spiel bewegt sich der Ball nur durch Rapier-Kontakte, Schwerkraft, Luftwiderstand, Magnus-Kraft und Rollwiderstand. Nur `MatchEngine.placeDeadBall` setzt den Ball, und nur aus Anstoß/Spielfortsetzung (Quelltext-Test `no-magnet.test.ts`).
3. **Absicht ≠ Ergebnis:** KI und Benutzer erzeugen dieselben `PlayerIntent`s; ausgeführt wird über Körper und Schuhkontakt.
4. **Entscheidung vor Handlung:** Der Director wird am Anfang eines Ticks befragt, bevor Spieler sich festlegen; läuft der Schwung schon, wird kein Moment mehr geöffnet.
5. **Fester Zeitschritt** 1/60 s, Teilschritte nur bei schnellen Schwüngen; Darstellung interpoliert, Kamera zeitbasiert.
6. **Reproduzierbar:** jede Zufallsentscheidung über `engine/rng.ts` (Seed); gleicher Seed → gleiche Partie (getestet).
7. **Keine erfundenen Ereignisse:** Kamera, Ton, Ticker und Kommentar reagieren nur auf `MatchEvent`s.
8. **Chronologisch, nie vorbei am Moment (Phase B):** Die Engine läuft im Browser in einem Web Worker Tick für Tick; der Worker hält an jedem offenen Moment und rechnet erst nach der Entscheidung weiter. Das Bild läuft der Simulation hinterher (höchstens 90 s) und zeigt nur Berechnetes – schneller oder langsamer, nie erfunden.

## 4. Features & Status

| Bereich | Status | Wesentliche Dateien |
| --- | --- | --- |
| Projektfundament, Verträge, IFAB-Geometrie, Seed-Zufall | Implementiert, getestet | `engine/types.ts`, `physics/pitch-geometry.ts`, `engine/rng.ts` |
| Physikwelt: Ball (Drag-Crisis, Magnus, Rollwiderstand), Tore, Netze, Banden, Tribünenfront, 22 Körper | Implementiert, getestet | `physics/*` |
| Physische Fußkontakte (Pass, Schuss, Dribbling, Klärung, Ballannahme), Luftlöcher | Implementiert, getestet | `physics/legs.ts`, `ai/execution.ts` |
| Torwart: Reaktionszeit, Reichweite, Hechtsprung, Fangen als Rapier-Gelenk, Abwurf, Fußspiel bei Rückpass | Implementiert, getestet | `physics/hands.ts`, `ai/keeper.ts` |
| Kopfball mit echtem Sprung (Körper hebt ab), sichtbar in der Figur; Kopfballtore | Implementiert, getestet | `physics/head.ts`, `ai/heading.ts`, `render/player-view.ts` |
| Brustannahme (Brust gibt nach, Ball fällt vor die Füße) | Implementiert, getestet | `physics/head.ts` (`CHEST_PART`), `ai/brain.ts` |
| Einwurf mit beiden Händen von hinten über den Kopf (Regel 15) | Implementiert, getestet | `physics/throw-hands.ts`, `ai/throw-in.ts`, `rules/referee.ts` |
| Grätsche: liegende Körperkapsel, gestrecktes Bein trifft den Ball, eigene Foulbewertung | Implementiert, getestet | `physics/body.ts`, `physics/legs.ts`, `ai/slide.ts`, `rules/referee.ts` |
| Wahrnehmung (Blickfeld, Schulterblick, Rauschen, Latenz) | Implementiert, indirekt getestet | `ai/perception.ts` |
| Positionsspiel 4-3-3, Ballgewinner dezentral, Jockeying, Pressing, Deckung, Ausweichen, Bremsen vor Körpern | Implementiert, getestet (Zonen-Test) | `ai/shape.ts`, `ai/brain.ts` |
| Schiedsrichter: Tor, Aus, Abseits (Regel-11-Ausnahmen, Seitenwechsel), Fouls, Karten inkl. Notbremse und Gelb-Rot, Elfmeter, Vorteil, Handspiel, Rückpass, 9,15 m | Implementiert, getestet | `rules/referee.ts`, `engine/restarts.ts` |
| Vollständige autonome Partie (2 Halbzeiten) | Implementiert, getestet | `engine/match-engine.ts` |
| Orchestrator: offenes Spiel (Abschluss/Ablage, Durchsetzen, Konter, Gegenpressing, Durchbruch, Strafraumgefahr), Standards vor der Ausführung (Einwurf, Ecke, Freistoß, Elfmeter), Halbzeitansprache; Kontingente, Reservierung, Verteilung über die Halbzeit | Implementiert, getestet (Phase B) | `orchestrator/*` |
| Eckball-Laufwege (Strafraumbesetzung), Einwurf auf gewählten Empfänger, direkter/indirekter Freistoß, Elfmeter wird geschossen | Implementiert, getestet (Phase B) | `ai/corner-routine.ts`, `ai/throw-in.ts`, `engine/restarts.ts`, `ai/brain.ts` |
| Agenten: Traits und Form aus echten Ereignissen | Implementiert, getestet (Phase B) | `ai/mind.ts` |
| Chronologische Simulation im Web Worker, Präsentationsregie (live / verdichtet / angehalten) | Implementiert, getestet, im Browser gemessen (Phase B) | `sim/*`, `app.ts` |
| Entscheidungs-Seitenleiste (Tastatur/Maus, Spielerform), Konsequenzkarte, Verlaufsleiste, Start/Ergebnis mit Chronik | Implementiert, im Browser getestet (Phase B) | `ui/*` |
| Prozedurale Spielerfigur, Entscheidungs-Framing, taktische 3D-Overlays, Übersichtskamera | Implementiert, getestet, im Browser geprüft (Phase B) | `render/*` |

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
| 19.10.2026 | Fußballmechaniken: `npm run check` | `tsc` ohne Fehler, **19 Testdateien / 99 Tests bestanden** (2 übersprungen: Langsimulation und Schusslabor, nur über eigene Befehle), `vite build` erfolgreich. Neu: Kopfballsprung, Kopfballtor, Einwurf, Brustannahme, Grätsche (Physik, Entscheidung, Schiedsrichter). Kein Browsertest (folgt als nächster Schritt) |
| 19.10.2026 | Browsertest nach #30: `npm run test:browser` (Chrome, Intel Iris Xe, D3D11) | `ok: true`, keine Konsolenfehler/-warnungen, Uhr läuft, Entscheidungsmoment erschienen, eingefroren, als `user` protokolliert. **55,7 FPS** vor, **59,3 FPS** nach den Korrekturen |
| 19.10.2026 | Browser-Aufnahme der neuen Mechaniken (Seeds 11, 23; je 2 × 6 min; Vollbild und Nahaufnahme bei jedem Ereignis) | Kopfballsprünge, Brustannahmen, Einwürfe und Grätschen im laufenden Spiel aufgenommen, keine Laufzeitfehler. Gefunden und behoben: Einwurf-Endlosschleife, zerfallende Figur bei Rumpfneigung (§6) |
| 19.10.2026 | Phase A: `npm run check` | `tsc` ohne Fehler, **20 Testdateien / 103 Tests bestanden**, `vite build` erfolgreich. Neu: `render/presentation.test.ts` (Kamera zeigt Einwürfe an beiden Seitenlinien, Zeitraffer nur in ruhigen Phasen) |
| 19.10.2026 | Phase A: Abschluss-Browsertest (`npm run test:browser` und Prüfskript für die vier Befunde, Seed 23, 2 × 5 min) | `ok: true`, keine Fehler/Warnungen, **53 FPS**. Einwürfe nahe und ferne Seitenlinie im Fernsehbild, keiner im Zeitraffer; Zeitraffer in 4 von 1284 Stichproben, nie bei ruhendem Ball oder hohem Ball; 9 Statusmeldungen, längste 9,3 s |
| 20.10.2026 | Phase B: `npm run check` | `tsc` ohne Fehler, **24 Testdateien / 129 Tests bestanden** (2 übersprungen: Langsimulation, Schusslabor), `vite build` erfolgreich (Simulation als eigener Worker-Chunk) |
| 20.10.2026 | Phase B: `npm run test:browser` (Desktop, schmal, Vollpartie) und `npm run probe` (Momentverteilung, Statistik, Ablation) | siehe §10.9 B6 |
| 22.10.2026 | Restarbeiten: `npm run check` | `tsc` fehlerfrei, **26 Testdateien / 142 Tests bestanden** (3 übersprungen), Build erfolgreich |
| 22.10.2026 | Restarbeiten: Browser Desktop/schmal/Produktions-Vollpartie, Schusslabor, 48-Seed-Probe | siehe §10.10 R7 |

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

Offen: In 24 Seeds fiel kein Kopfballtor (real ≈ 15 % der Tore). Die Spielerfigur springt und nickt in der Darstellung nicht sichtbar mit; das Rendern zeigt nur den Ball. *(Beides behoben, siehe „Fehlende Fußballmechaniken“.)*

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

### Fehlende Fußballmechaniken: Kopfball, Einwurf, Brustannahme, Grätsche (19.10.2026)

Auftrag: die vier fehlenden Grundmechaniken vor dem Browsertest umsetzen, mit der vorhandenen Rapier-Physik und KI, ohne geskriptete Ergebnisse. Gezielte Tests, keine Kalibrierungsserien.

**Kopfball** (`physics/head.ts`, `ai/heading.ts`, `render/player-view.ts`)
- **Echter Sprung:** Liegt der Kontakt über der Stehhöhe, hebt die Körperkapsel mit v₀ = √(2·g·h) so ab, dass der höchste Punkt mit dem Kontakt zusammenfällt. Schuhe und Figur gehen mit hoch, der Rumpf neigt sich zur Stirn. Test: `head.test.ts` (Körper verlässt den Boden, trifft den Ball oben, landet wieder).
- **Kopfballtore:** Ein Kopfball aufs Tor wurde von der Ballposition zum Zeitpunkt der Entscheidung aus gezielt; die Flanke war dann noch auf dem Flügel, der Kopfball ging 50° neben das Tor. Jetzt wird vom geplanten Treffpunkt aus entschieden und 1,2 m innerhalb des Pfostens gezielt.
- Test: `header-goal.test.ts`, Flanke von rechts zum Stürmer am Elfmeterpunkt. Das Tor fällt per Kopf und wird in der Statistik als Kopfballtor gezählt (`goalsFrom.head`).

**Einwurf** (`physics/throw-hands.ts`, `ai/throw-in.ts`, `rules/referee.ts`)
- Der Einwurf wurde mit dem Fuß ausgeführt.
- **Ablauf jetzt:** Der Ausführende steht mit dem Körper hinter der Seitenlinie, Blick ins Feld. Kinematische Hände greifen den Ball mit einem echten Gelenk und heben ihn vor dem Körper an, dann über den Kopf nach hinten. Zum Wurf bewegen sie sich entlang der Wurfrichtung über den Kopf nach vorn. Beim Lösen des Gelenks hat der Ball das Tempo der Hände; seine Geschwindigkeit wird nie gesetzt.
- **Schiedsrichter:** Erst das Loslassen gibt den Ball frei. Fuß- oder Körperkontakte vorher zählen nicht, der Wurf ist kein Handspiel. Der Einwurfpunkt liegt auf der Seitenlinie.
- **Zwei Fehler im ersten Entwurf**, beide behoben:
  - Der Ausführende lief von innen über den Ball, und der Schiedsrichter wertete diese Berührung als Einwurf.
  - Der Ball wurde vom Boden direkt hinter den Kopf gehoben, klemmte zwischen Händen und Rumpf und löste sich aus dem Gelenk.
- Test: `throw-in.test.ts` (über dem Kopf gehalten, erste Berührung mit den Händen, Körper hinter der Linie, Ball fliegt ins Feld).

**Brustannahme** (`physics/head.ts` mit `CHEST_PART`, `ai/brain.ts`)
- Dieselbe Kontaktklasse wie der Kopf, mit eigenen Werten: r = 0,15 m, vor dem Rumpf, gibt bis 7 m/s nach, Stoßzahl 0,3.
- Eigener, ungestörter Ball in Brusthöhe: Brustannahme statt Abprall. Im Zweikampf, wenn der Kopf nicht hinkommt, ebenfalls.
- Test: `chest.test.ts` (Ball mit 12 m/s, landet mit < 2,5 m/s waagerecht 0,2–1,5 m vor den Füßen; ohne Brust prallt er vom Rumpf ab).

**Grätsche** (`physics/body.ts`, `physics/legs.ts`, `ai/slide.ts`, `rules/referee.ts`)
- **Körper:** Ausfallschritt entlang des Laufs. Die Rumpfkapsel liegt dabei als niedrige Kapsel (Beine und Hüfte) längs der Grätsche am Boden, bremst auf dem Rasen (5 m/s²), bleibt kurz liegen und richtet sich auf.
- **Bein:** Der vordere Schuh liegt 0,95 m voraus auf dem Rasen und trifft den Ball mit dem Tempo des Körpers. Der Gegner trifft auf die liegende Kapsel.
- **Schiedsrichter:**
  - Ball zuerst gespielt, von vorn oder der Seite: fair.
  - Gegner ohne Ball getroffen: Foul, ab 5 m/s Gelb („rücksichtslose Grätsche“).
  - Von hinten mit übermäßiger Härte (ab 7 m/s): Rot.
- **Wann:** nur gegen einen Ballführer, der auf gleicher Höhe oder vorbei ist und aufs Tor zieht; nie von hinten, nie im eigenen Strafraum.
  - Im ersten Entwurf (jeder Ballführer, der vorbeikam) grätschten die Verteidiger 120–250-mal pro 90 Minuten.
  - Jetzt in zwei kurzen Partien ≈ 9/90 (real ≈ 10–15).
- Tests: `slide.test.ts` (Physik: Bein trifft den Ball, Kapsel liegt am Boden, aufrecht danach; Körperkontakt mit dem Tempo der Grätsche), `ai/slide.test.ts` (wann), `referee.test.ts` (fair, Gelb, Rot).

**Nutzung im Spiel** (eine Partie, 2 × 4 min): 9 Brustannahmen, 11 Kopfballkontakte mit Sprüngen, 3 Einwürfe, alle mit den Händen.

Nicht gemessen: Auswirkungen auf Tore, Schüsse, Fouls und Einwürfe über viele Seeds. Das folgt nach dem Browsertest.

### Browsertest und Spielerlebnis nach den neuen Mechaniken (19.10.2026)

**Automatischer Browsertest** (`npm run test:browser`):
- Keine Fehler, Uhr läuft, Entscheidungsmoment friert ein, Klick wird ausgeführt.
- 55,7 FPS, nach den Korrekturen 59,3 FPS.

**Aufnahme der Mechaniken:** Ein Hilfsskript (nicht eingecheckt) beobachtet das laufende Spiel in Chrome. Bei Kopfballsprung, Brustannahme, Einwurf und Grätsche hält es die Simulation kurz an und nimmt das Fernsehbild sowie zwei Nahaufnahmen auf.

**Zwei Fehler gefunden und behoben:**
1. **Einwurf-Endlosschleife.**
   - Fehler: Ein Einwurf entlang der Linie verließ die Hände knapp außerhalb der Seitenlinie (|z| ≈ 34,1–34,2 m). Der Schiedsrichter gab sofort wieder Einwurf, die Mannschaften warfen sich den Ball minutenlang hin und her (Seed 23 ab Sekunde 24).
   - Jetzt nach Regel 15: Der Ball ist erst im Spiel, wenn er das Feld betritt. Landet er draußen, ohne hineinzukommen, wird der Einwurf von derselben Mannschaft wiederholt.
   - Danach 9–11 Einwürfe je 2 × 6 min (3 Seeds). Test in `referee.test.ts`.
2. **Figur zerfiel bei Rumpfneigung.**
   - Fehler: Bei Kopfball und Brustannahme kippte der Rumpf um den Bodenpunkt. Hüfte und Rumpf rutschten von den Beinen, die Arme hingen an den Schultern der aufrechten Haltung.
   - Jetzt kippt der Rumpf um die Hüfte, Schultern und Arme gehen mit.
   - Bei der Brustannahme lehnt der Spieler leicht zurück statt sich vorzubeugen. Der Kopfball neigt den Rumpf höchstens 0,45 rad; bis 0,8 sahen Kopfballduelle aus wie ein Gedränge.

**Bewertung des Spielerlebnisses:**
- **Grätsche:** gut erkennbar. Der Spieler liegt auf dem Rasen, das Bein ist zum Ball gestreckt.
- **Einwurf:** in der Nahaufnahme glaubwürdig (Ball mit beiden Händen über dem Kopf, Füße auf der Linie, Blick ins Feld). Im Fernsehbild aber **nicht zu sehen**: Die Kamera zeigt die nahe Seitenlinie nicht (alle Werfer unterhalb des Bildrands), und ruhende Bälle laufen im Zeitraffer ×3.
- **Kopfball:** Duelle sind sichtbar. Sprünge von 13–16 cm sind aus der Fernsehperspektive kaum zu erkennen.
- **Brustannahme:** physikalisch vorhanden, im Fernsehbild kaum wahrnehmbar.
- **Allgemein:**
  - Die meiste Zeit läuft Zeitraffer ×3, auch bei Zweikämpfen im Mittelfeld.
  - Eine Statusmeldung („Nach ‚Ordnung halten': Der Gegner ist am Ball.“) bleibt minutenlang stehen.
  - In drei Partien zu 2 × 6 min fiel kein Tor.
  - Nach einem Einwurf prallt der Ball meist vom Körper des Empfängers ab (13 von 24); die Brustannahme greift dabei selten.

Diese Punkte sind nicht verändert worden. Sie sind Kandidaten für die Nachkalibrierung und die Darstellung (§9). *(Kamera an der nahen Seitenlinie, Zeitraffer, Statusmeldung und Ballannahme nach Einwürfen sind behoben, siehe „Phase A“.)*

### Phase A: Spielerlebnis korrigiert (19.10.2026)

Auftrag: die vier offenen Befunde des Browsertests beheben, Ursachen gezielt, ohne Kalibrierungsserien.

**1. Ballannahme nach Einwürfen** (`ai/chest.ts`, `ai/brain.ts`)
- **Ursache:** Der Empfänger lief nur dorthin, wo ein hoher Ball auf den Rasen kommt. Wenn der Ball in Brusthöhe ankam, stand er falsch, kein Brustannahme-Plan passte (z. B. 0 von 121 Versuchen), und der aufspringende Ball prallte von seinen Beinen ab.
- **Neu:** Bei einem eigenen, ungestörten hohen Ball stellt sich der Empfänger in die Ballbahn, wo der Ball Brusthöhe hat (wie beim Kopfball). Geht das nicht, nimmt er den Ball wie bisher mit dem Fuß.
- Die Brustannahme-Logik ist aus `brain.ts` in `ai/chest.ts` ausgelagert (500-Zeilen-Grenze).

| 6 Seeds × 2 × 6 min | vorher | nachher |
| --- | --- | --- |
| Erste Berührung = Abprall vom Körper des Empfängers | 25 von 54 (46 %) | 6 von 36 (17 %) |
| Brustannahme als erste Berührung | ≈ 0 | 13 von 36 |
| Einwerfende Mannschaft nach 3 s am Ball | 65 % | 69 % |

Insgesamt verdoppeln sich die Brustannahmen (31 → 65), und es gibt weniger Einwürfe (54 → 36), weil weniger Bälle vom Körper ins Aus springen.

**2. Kameraführung** (`render/camera-director.ts`)
- **Ursache:** Die Hauptkamera steht hinter der nahen Seitenlinie (z = 45,5 m, 21 m hoch, 36° Bildwinkel) und folgte dem Ball quer mit Faktor 0,55. An der nahen Linie lagen Werfer 24° unter der Bildmitte, außerhalb der halben 18°.
- **Neu:** Zur nahen Linie hin folgt der Blickpunkt stärker (bis 0,85, `nearSideFollow`). Die Linie liegt dann etwa 10° unter der Mitte, frei von der Statuszeile.
- **Test:** Werfer an beiden Linien, projiziert durch die echte Kamera. Mit dem alten Faktor lag der nahe Werfer bei −1,36, also unterhalb des Bildes.

**3. Zeitraffer** (`render/time-lapse.ts`, `app.ts`)
- **Ursache:** Zeitraffer lief überall in der mittleren Zone, auch bei Zweikämpfen und nach 2 s auch bei jedem ruhenden Ball.
- **Neu: normales Tempo, wenn**
  - der Ball in einer Strafraumhälfte ist (|x| > 22 m);
  - der Ball ruht (Standardsituationen);
  - der Ball höher als 1 m ist;
  - Spieler beider Mannschaften innerhalb von 2,5 m am Ball sind (Zweikampf);
  - in den 3 s nach Foul, Abseits, Aus, Wiederanpfiff, Tor, Fang, Vorteil, Schuss, Kopfball, Tackling oder Einwurf.
- Zeitraffer gibt es nur nach 3 s ohne all das.

**4. Statusmeldungen** (`ui/hud.ts`, `app.ts`)
- **Ursache:** Eine Meldung blieb stehen, bis eine neue kam, teils minutenlang.
- **Neu:**
  - Jede Meldung hat eine Laufzeit: 6 s; die Meldung zur eben getroffenen Entscheidung höchstens 12 s, bis ihr Ausgang sie ersetzt.
  - Ein neuer Entscheidungsmoment leert die Zeile.

**Abschluss-Browsertest:** Werte in §5. In den Aufnahmen steht der Werfer an der nahen Linie mit dem Ball über dem Kopf mitten im Bild. An der fernen Linie ist er klein am oberen Bildrand zu sehen, wie bisher.

## 7. Bekannte Grenzen / offene Punkte

- **Spielqualität** (48 Seeds, Stand nach #29): Im Zielbereich sind Passquote ≈ 76 %, Fouls ≈ 20/90, Elfmeter ≈ 0,4/90, Tore ≈ 3,1/90 (real ≈ 2,7) und Eigentore ≈ 0,4/90. Noch nicht realistisch: Schüsse ≈ 19/90 (real ≈ 25) bei leicht hoher Torquote (13 %), Pässe ≈ 1360/90 (real ≈ 1000), Einwürfe ≈ 55/90 (real ≈ 45), lange Bälle über 30 m ≈ 46 % (siehe §6). Diese Werte stammen von vor Kopfballsprung, Brustannahme, Einwurf und Grätsche; deren Wirkung auf die Statistik ist noch nicht über viele Seeds gemessen.
- Der Körper ist eine aufrechte Kapsel (r = 0,27 m, Reibung 0), in der Grätsche eine liegende; eine niedrigere Stoßzahl wurde gemessen und verworfen (§6). Ein streifender Ball behält seine Geschwindigkeit; der Torwart kippt beim Hechtsprung nicht mit dem ganzen Körper, nur die Hände reichen weiter.
- Physik läuft mit ≥ 240 Hz (Rapier-Drallgrenze bei 60 Hz); ≈ 50 % mehr Rechenzeit pro Tick.
- Kinematischer Schuh mit unbegrenzter Masse; Volleys über Hüfthöhe nicht modelliert.
- Kopf und Brust sind je eine Kontaktkugel; die Hände eines Feldspielers sind beim Einwurf ein gemeinsamer Körper mit einem Gelenk, sonst nur Darstellung.
- Abseits nutzt Körpermittelpunkte und nur „spielt den Ball“ als Beteiligung; beim Abseits werden absichtliches Spiel und Abpraller nicht unterschieden (bei der Rückpassregel schon).
- Fouls aus Körperkontakten. Bei der Grätsche trifft der Gegner auf die liegende Kapsel (Beine und Hüfte); Schuhe berühren weiterhin nur den Ball, Tritte auf den Fuß gibt es nicht.
- Der laufende Spielrhythmus der Beine ist rein visuell (ruhende Schuh-Kollider bleiben unter der Hüfte); Kick-Beine folgen exakt der Physik.
- Ballparameter sind Literaturwerte, keine eigene Messreihe.
- Bei Kurzspielen zeigt die Uhr echte Simulationszeit (z. B. 2 × 5 min), nicht 90 Minuten.
- Eine 90-Minuten-Partie braucht im Browser ≈ 11,7 min Rechenzeit unter Dauerlast (2,16 ms je Tick, Iris Xe; Phase B: 4,2 ms); die Nutzerzeit (14:04 min) kann nicht unter die Rechenzeit fallen (§10.10 R1).
- Spieler fern vom Ball planen mit 30/20 Hz neu (Körper weiter mit 60 Hz); bei sauber rollendem Ball unter 10 m/s rechnet die Physik mit 2 statt 4 Teilschritten (gleichwertig gemessen, §10.10 R1).
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
11. **Fußballmechaniken** – Kopfball mit echtem Sprung und Kopfballtore, Einwurf mit beiden Händen, Brustannahme, Grätsche mit liegender Kapsel und Foulbewertung (gezielte Tests, noch keine Mehr-Seed-Messung).
12. **Phase A** – Ballannahme nach Einwürfen, Kamera an der nahen Seitenlinie, Zeitraffer nur in ruhigen Phasen, Statusmeldungen mit Laufzeit.
13. **Phase B** – Orchestrator mit Stopp vor Standards, Agenten-Traits und Form, chronologische Simulation im Web Worker mit Präsentationsregie, neue Figuren, Entscheidungskamera, Taktik-Overlays, neue Oberfläche (§10.9).
14. **Phase-B-Restarbeiten** – Simulation −54 % je Tick, Agenten nachkalibriert, Ersatzbank und Wechsel, Elfmeter-Torwart, Freistoßmauer, Eckenverteidigung, Beziehungen und Gedächtnis über Partien, Figur und Animation, Figuren-Labor (§10.10).

## 9. Nächste Schritte

1. **Restarbeiten abnehmen** (Folge-PR, §10.10). Offen: 10 min Nutzerzeit für 2 × 45 min (gemessen 14:04 min, Engpass Rechenzeit), Tore 3,6/90 und weniger Fänge des Torwarts (nächste Kalibrierung), Szenariomodus.
2. **Simulationstempo:** Wahrnehmung, Freilaufsuche und Abfangprüfung algorithmisch weiter verbilligen; Messung auf weiterer Hardware.
3. Nachkalibrierung (Messung mit `npm run probe`, 48 Seeds): Schüsse (≈ 19/90, real ≈ 25), Tore (in drei kurzen Browserpartien keines), Häufigkeit von Kopfballtoren, Grätschen und Fouls, Passzahl (≈ 1360 statt ≈ 1000/90), lange Bälle über 30 m.
4. Orchestrator: Wechsel (nach Ersatzbank-Logik), Torwart beim gegnerischen Elfmeter, defensive Eckenvarianten, Wiederholung (Replay) eines Moments aus den Ereignisdaten.
5. Präsentation: Fangesänge/Kommentar mit lizenzfreien Quellen, Replay-Kamera, hochwertigere Spielermodelle.
6. Optionale KI-Rollen (Match Analyst, Pub Host) über Adapter; Physik und Spiel bleiben offline lauffähig.


## 10. Phase B – verbindliche Produktvision und Gesamt-Entwicklungsauftrag (beschlossen 20.10.2026)

**Status:** **VERBINDLICH; IMPLEMENTIERT AUF DEM PHASE-B-BRANCH, ABNAHME OFFEN (Ergebnis §10.9).** Festlegung des Auftraggebers nach Review der sechs echten Browser-Screenshots (Start, Anstoß, TV-Spiel, Entscheidungsfenster, nach der Entscheidung, Ergebnis) und Prüfung des Stands auf `main` inklusive PR #32. Dieser Abschnitt hat bei Produktfragen Vorrang vor früheren, nur technisch formulierten UX-Annahmen. Vorhandene Mechaniken, Messungen und Architekturregeln aus §§1–9 bleiben erhalten, soweit unten nicht explizit präzisiert. **Kein Neubau der Physik.**

### 10.1 Produktidentität – Was der Mensch tatsächlich spielt

**THE 12TH MAN ist eine interaktive, agentenbasierte Fußball-Entscheidungssimulation.** Kein FIFA-/EA-FC-Ersatz, kein manuelles Steuern der 22 Spieler, keine bloße TV-Übertragung mit seltenen Popup-Fragen. Die autonome, zusammenhängende 11v11-Simulation ist die **Welt unter der Oberfläche**; das **Hauptprodukt** ist das Erleben von Entscheidungen, ihren Risiken, Überraschungen und kausalen Konsequenzen.

- Der Benutzer ist der **zwölfte Mann**: Er trifft situationsbezogene taktische oder spielerische Entscheidungen, aber er kontrolliert keine Schüsse als Arcade-Eingabe und bestimmt niemals direkt Tore oder Resultate.
- Der **Orchestrator** (neuer verbindlicher Produktbegriff; derzeitige Codeklasse `MomentDirector`) führt durch das Erlebnis: Er beobachtet den jeweils **aktuellen** Spielzustand, erkennt oder eröffnet **plausible Wahlgelegenheiten**, friert am richtigen Zeitpunkt ein, liefert verständliche, ausführbare Optionen und setzt den Lauf nach der Auswahl fort.
- **Jede Entscheidung verändert potenziell den weiteren Verlauf**: Spielerabsichten, Räume, Ballkontakte, Gegnerreaktionen und spätere Entscheidungen entstehen **erst im Anschluss**. Auch eine vermeintlich banale Ecke oder ein Einwurf kann sich erst rückblickend als spielentscheidend erweisen. Umgekehrt darf eine als gefährlich inszenierte Chance scheitern.
- **Entscheidung ≠ Ergebnis.** Füße, Hände, Körper, Ballphysik, individuelle Fähigkeiten, Gegner, Zufall innerhalb des Seed-Systems und Schiedsrichter entscheiden über die tatsächliche Ausführung. Keine Ball-Teleports, keine garantierten Erfolge, keine erfundenen Tore, keine heimlichen Zustandsüberschreibungen, um das gewünschte Dramaturgie-Ergebnis zu erzwingen.
- **Produktprinzip:** „Autonome Simulation → Orchestrator → verständliche interaktive 3D-Situation → menschliche Entscheidung → reale Umsetzung und Konsequenz → fortgesetzte Simulation → nächste Situation“.

### 10.2 Zeit- und Zustandsmodell: keine vorab durchsimulierte Partie

**Explizit ausgeschlossen:** erst eine komplette Partie berechnen und danach Highlights zur Auswahl anbieten. Das würde die Kausalität nach einer Benutzerentscheidung brechen.

**Verbindliches Laufzeitmodell:**
1. Eine **einzige autoritative** Match Engine simuliert die Partie **chronologisch** mit der vorhandenen Seed-/Physik-/Schiedsrichterlogik. Die Spielwelt ist zwischen Szenen konsistent: Spielstand, Zeit, Ball, 22 Spieler, Karten und Ballbesitz werden fortgeschrieben.
2. Der Orchestrator bewertet den aktuellen Zustand und Ereignisse laufend, **ohne die Zukunft zu kennen**. Er muss vor dem betreffenden ausführbaren Aktionszeitpunkt eingreifen können; nicht erst danach.
3. Bei einem ausgewählten Moment wird die Engine angehalten. Die Kamera zeigt die **tatsächlichen aktuellen** Akteure und Räume; nur jetzt werden die gültigen Optionen präsentiert. Benutzerwahl, Delegation oder Timeout schließen den Moment genau einmal ab.
4. Die gewählte Option wird als begrenzte **Absicht/Anweisung** an die betroffenen Agenten übergeben; Ball und Ergebnis bleiben im Besitz von Engine/Physik/Schiedsrichter.
5. Die Engine berechnet den folgenden Verlauf **erst danach**, bis zur nächsten relevanten Situation. Nachwirkungen können über mehrere Ereignisse sichtbar werden, ohne einen künstlichen Erfolg zu behaupten.
6. Uninteressante Abschnitte dürfen **im Hintergrund schneller chronologisch durchgerechnet** oder stark beschleunigt dargestellt werden. Dazu sind Performance-/Batch-Budgets und gegebenenfalls eine Übergangsanimation zulässig, **aber keine ausgelassenen Physikticks, erfundenen Spielereignisse oder Positionssprünge**. Der Batch muss vor einer möglichen Entscheidung sofort anhalten und darf niemals am Orchestrator vorbeirechnen.
7. Zielgröße für das **Erlebnis**, nicht für die simulierten Fußballregeln: Eine dramaturgisch passende Sitzung soll nach Möglichkeit **etwa 5–10 Minuten Nutzerzeit** beanspruchen, bei einer vollständigen simulierten Partie. Diese Zielgröße muss **gemessen** und auf der Zielhardware überprüft werden; die tatsächliche 90-Minuten-Rechenzeit, Zahl der Entscheidungspausen und Performance sind technische Randbedingungen. Weder simulierte Spielminuten mit realen Minuten verwechseln noch eine ungemessene 5–10-Minuten-Garantie behaupten.

**Zwei strikt getrennte Modi, damit Szenen und Kausalität vereinbar bleiben:**
- **Fortlaufendes Match (Pflicht):** Entscheidungen entstehen ausschließlich aus dem echten bisherigen Matchzustand; **keine** künstliche Erzeugung neuer Eckbälle, Tore oder Spielerpositionen mitten in einer Partie.
- **Szenario-/Trainingsmodus (später/optional, klar getrennt):** Gezielte Ausgangslagen (z. B. Einwurf in Minute 87, 0:1) dürfen vor dem Start eines eigenständigen Szenarios konsistent initialisiert werden. Ab Start gelten dieselben Physik- und Konsequenzregeln; Szenariostart niemals als historisches Matchereignis ausgeben. **Nicht** als Abkürzung verwenden, um die Vielfalt des fortlaufenden Matchs vorzutäuschen.

### 10.3 Der Orchestrator: Vielfalt statt nur xG-Highlights

Die frühere Auswahl anhand ausschließlich gefährlicher Angriffslagen ist für das Endprodukt zu eng. **Entscheidungswürdig ist eine Lage, in der mehrere für Menschen verständliche, im aktuellen Zustand tatsächlich ausführbare Handlungsabsichten bestehen** – auch wenn sie zunächst unspektakulär ist. Nicht jeder Einwurf muss einen Dialog auslösen; Vielfalt, Relevanz, dramaturgische Häufigkeit und Zumutbarkeit der Pausen werden berücksichtigt.

**Mindestens zu unterstützen und durch echte Zustände prüfbar zu machen:**
- **Angriff:** Abschluss vs. Pass vs. Dribbling; unterstützt die bereits implementierten Aktionen.
- **Verteidigung/Umschalten:** zustellen, Pass-/Schusslinie blockieren, absichern, fallen lassen, Gegenpressing, Konter; keine drei unterschiedlich benannten Optionen mit identischem tatsächlichem Verhalten.
- **Einwurf:** plausible kurze/lange/unterstützende Varianten bei korrektem Aufstellungs- und Einwurfzustand; Einwurf bleibt nach IFAB legal und physikalisch mit den Händen ausgeführt.
- **Ecke:** kurze Ausführung, erster/zweiter Pfosten oder Rückraum **nur wenn** Empfänger, Positionen, Reichweite und vorhandene Mechanik die Variante real ermöglichen. Wenn dafür eine neue legitime Ausführungs-/Laufwegabsicht nötig ist, kontrolliert implementieren und testen; kein unsichtbares Verschieben.
- **Freistoß/Elfmeter:** situationsgerechte, wirklich ausführbare Wahl; für Elfmeter keine fiktive Erfolgsgarantie. Wo keine echte Alternative möglich ist, **keinen** Schein-Dialog erzwingen.
- **Trainer-/Halbzeitsituation:** taktische Ansage / Risiko / Pressing als vorhandener `TeamInstruction`-Mechanismus; Wechsel nur, wenn tatsächliche Ersatzspieler-, Regel- und Zustandslogik implementiert sind – sonst als **offene Erweiterung** deklarieren statt einen wirkungslosen Button anzubieten.

**Engine-Anbindung:** Der bestehende `MatchEngine.consultDirector()` läuft nur bei `in-play`, während Standards als `stopped`/`restart` behandelt werden. Für Standards braucht es eine **regelkonforme Entscheidungsvorstufe vor Ausführung** (z. B. `stopped → decision → stopped/restart → in-play`), bei der weder versehentlich die Wiederanstoßlogik gelöscht noch ein Spielzug doppelt ausgelöst wird. `resolveMoment()` darf nicht pauschal `in-play` setzen, wenn ein Standard noch gar nicht durchgeführt wurde. Das Datenmodell `MomentKind`, `DecisionOption`, `DecisionSource`, `MatchSnapshot` und die Regeln müssen dafür sauber erweitert werden. Eine konkrete Zustandsmaschine samt Unit-/Integrationstests ist Pflicht.

**Optionen ehrlich darstellen:** Risiko-/Erfolgsaussagen dürfen aus aktueller Bewertung stammen, aber keine Scheingenauigkeit oder falschen Versprechen vortäuschen. Default/Delegation muss der tatsächlichen plausiblen AI-Entscheidung entsprechen. Eine Option wird nur angezeigt, wenn sie nach aktuellem Zustand und Regeln ausführbar ist.

**Situationsdramaturgie:** nicht nur „seltene xG-Chancen“, sondern verständliche Mischung aus Alltag, Spannung, Gefahr, gegnerischem Druck, Standards und langfristig interessanten Folgeentscheidungen. Häufigkeitslimits verhindern endlose Dialogketten; feste Kontingente dürfen Standards oder Angriff nicht vollständig verdrängen. Verteilung über unterschiedliche Seeds und beide Halbzeiten testen und dokumentieren.

### 10.4 Grafik und UI: Pflichtbestandteil, nicht kosmetische Spätphase

**Aktueller visueller Stand ist als Endprodukt nicht akzeptiert.** Die sechs echten Screenshots zeigen eine funktionsfähige 3D-Prototypoberfläche, aber primitive Spielerfiguren, eine dominante Tribünenfläche, ungünstige Perspektiven und ein großflächiges Entscheidungspanel, das relevante Akteure verdeckt. **Phase B ist ohne substanzielle grafische Überarbeitung nicht abgeschlossen.**

**Verbindliches visuelles Ziel:** moderne, kohärente, hochwertige **3D-Szenen** mit eigenen visuellen Qualitätsansprüchen (nicht ein EA-FC-Klon). Die Entscheidungssituation muss in **einem Blick** verständlich sein. Die bestehende Three.js-Engine, die 3D-Fußballwelt und die CI-Variablen bleiben Ausgangspunkt; keine ungebetene Komplettmigration, kein Tailwind. `design_variables.css` nur nach erforderlicher begründeter Abstimmung verändern.

**Umsetzungsschwerpunkte:**
1. **Spieler und Bewegung:** Die zylindrisch-kugelförmigen Platzhalter zu erkennbaren, angemessen proportionierten, hochwertiger beleuchteten und glaubwürdig animierten Fußballfiguren weiterentwickeln bzw. durch performant integrierbare, rechtlich verwendbare Modelle ersetzen. Echte Physikkontakte und die bestehende Körper-/Schuh-/Kopf-/Brust-/Grätschenlogik müssen zur sichtbaren Animation passen. Modell-/Asset-Herkunft und Lizenz dokumentieren; keine ungeklärten Premier-League-/Spieler-Likenesses voraussetzen.
2. **Kamera und Inszenierung:** Dynamische, zustandsabhängige Einstellungswahl; im Entscheidungsmoment vollständige Sicht auf den Ball, den handelnden Spieler, relevante Anspielstationen, Gegner, Abstände und freien Raum. Schärfere Framing-/Clipping-/Occlusion-Prüfungen, insbesondere an Seitenlinie, Ecke und Strafraum. Die Kamera darf die Szene nicht hinter Zuschauerrängen verstecken.
3. **Taktische Overlays auf dem 3D-Feld:** aktive Spieler klar markieren; auswählbare Pass-/Laufwege, Zielzonen und mögliche taktische Risiken **aus aktuellem Zustand** hervorheben. Die grafische Markierung muss zur tatsächlich angebotenen Option gehören und mit Auswahl/Fokus wechseln. Unzulässige, verdeckte oder veraltete Marker vermeiden.
4. **Interaktionsdesign:** Situationsdaten und 2–4 Optionen in einer platzsparenden, responsiven **Seiten-/Unterkanten-UI** statt eines großen mittigen Blocks, der die Spielsituation überdeckt. Tastatur **und** Maus, klarer Fokus, Countdown, Delegation und lesbare Rückmeldungen. Keine horizontale Gesamtseiten-Scrollleiste; auf 1600×900 und kleineren Viewports funktionsfähig.
5. **Konsequenz-Inszenierung:** Nach der Entscheidung kurze nachvollziehbare Ansicht von Spielerreaktion, Pass/Abschluss/Zweikampf, Ball-/Regelereignis und dem Resultat; Statusanzeige nennt **beobachtete** Ereignisse, keine ausgedachten Kausalbehauptungen. Bei längeren indirekten Folgen darf sie neutral bleiben („danach entwickelte sich …“) statt fälschlich ein Tor genau einer Entscheidung zuzuschreiben.
6. **Look & Feel:** Start, Matchansicht, Entscheidung und Ergebnis bilden ein zusammenhängendes Premium-Erlebnis; bessere Licht-/Material-/Stadiongewichtung und Bildkomposition. Bestehende CI aus Dunkelblau, Orange, Weiß behutsam einsetzen; kein großflächiges dunkles Rechteck als einziges UX-Konzept.
7. **Leistung:** Qualität und Framerate **gemeinsam** optimieren (LOD/Instancing, Geometrie-/Materialbudgets, Assets, CPU/GPU, Browsermessung). Vergleich mit Phase A (53 FPS bei dokumentierter Testumgebung) transparent führen. Keine ungemessene pauschale 60-FPS-Zusage.

### 10.5 Agenten: individuelle Spieler, keine zentrale Ergebnislenkung

Die Engine besitzt bereits 22 individuelle Fähigkeitsprofile und dezentrale `PlayerBrain`-/`Perception`-Entscheidungen. Das sind **noch keine lernenden Persönlichkeiten**. Phase B soll eine **erste echte, testbare Grundlage** für Charaktere und Entwicklung enthalten; keine Behauptung vollautonomer selbstlernender LLM-Agenten ohne Implementierung.

- Abgrenzbare **stabile Traits** (z. B. Risikofreude, Disziplin, Selbstvertrauen, Teamorientierung), jeweils mit begrenztem und dokumentiertem Einfluss auf reale Entscheidungen.
- Eine **veränderliche, deterministisch aktualisierbare Erfahrungsebene** (z. B. jüngste gelungene/gescheiterte Ausführung, Reaktion auf Anweisungen), aus tatsächlichen Ereignissen. Das Speichermodell soll für spätere Persistenz/Spielerbeziehungen offen sein, ohne Remote-Service-Zwang.
- Unterschiedliche Agenten dürfen dieselbe Anweisung verschieden gut bzw. situationsabhängig umsetzen; Erfolg darf niemals per „Charakterentscheidung“ außerhalb der Physik festgelegt werden. Keine erfundenen Emotionen als Tatsache ausgeben.
- Grenzen zwischen Agentengedächtnis, Spielerabsicht, Orchestrator, Regeln und autoritativem physikalischem Zustand wahren. Reproduzierbarkeit bei identischem Seed und identischer Eingabefolge erhalten.
- Gegenseitige dynamische Beziehungen / dauerhaftes Lernen **als erweiterbares Ziel** spezifizieren; in Phase B mindestens einen kleinen **sichtbar und testbar wirksamen** individuellen Unterschied mit Erfahrungseinfluss nachweisen, statt nur leere Datenfelder anzulegen.

### 10.6 Konkrete Anschlussstellen an den Stand von PR #32

| Ist im Code (20.10.) | Phase-B-Arbeit |
| --- | --- |
| `src/director/moment-director.ts`: sechs `MomentKind`s, `in-play`-Bewertung, Gruppenlimits | Zum **Orchestrator** als Produktfunktion ausbauen; Standards, Diversität, Ausführbarkeit, moderne Entscheidungsregie |
| `src/engine/match-engine.ts`: `consultDirector()` nur `in-play`; `resolveMoment()` führt immer zu `in-play` | Regelkonformen Stopp/Fortsetzungs-Ablauf auch **vor Standards** einbauen; keine Neustart-Doppelung |
| `src/engine/restarts.ts`, `src/ai/throw-in.ts`, `src/physics/throw-hands.ts` | Legal ausführbare, wählbare Standards auf vorhandener Mechanik |
| `src/app.ts`, `src/render/time-lapse.ts`: normal / ×3, Fokus auf laufendes TV-Bild | **Chronologische Hintergrund-Verdichtung** mit Orchestrator-Stopps; echte Nutzerzeit und Simulationszeit getrennt messen |
| `src/render/camera-director.ts`, `player-view.ts`, `stadium-view.ts` | **Substanziell** bessere Figuren, Kamera, Materialsprache, Hervorhebungen und situatives Framing |
| `src/ui/decision-panel.ts/.css`, `hud.ts`, `start-screen.ts` | Situationsorientiertes, platzsparendes, hochwertiges UI; echte Grafikwahl und Konsequenzfeedback |
| `src/ai/brain.ts`, `perception.ts`, `engine/rosters.ts` | Charakter-/Erfahrungsgrundlage, die Entscheidungen **tatsächlich** beeinflusst |
| `scripts/browser-check.mjs`, `src/director/moment-director.test.ts` | E2E-Kette einschließlich Ecke/Einwurf, Kamerasicht, Option, realer Fortsetzung, Restart- und Performancekontrolle |

**Unveränderliche Schutzplanken:** §§2–3 und Phase-A-Korrekturen aus §6 bleiben. Testbar: Single Writer, keine Ball-Teleports, IFAB-Regeln, keine geskripteten Tore, identische Seed- und Eingabefolge ⇒ identischer Verlauf, keine Regression der Körperannahme, nahen/fernen Seitenlinienkamera, Statusmeldungen oder der Zeitrafferguards. Kein ungefragter Austausch der Architektur oder Übernahme des Altprototyps.

### 10.7 Ein kompletter Phase-B-Auftrag (nicht drei isolierte Mini-Phasen)

**Arbeitsmodus für Opus/Astra:** **Ein kohärenter, längerer Entwicklungsdurchlauf mit einem Phase-B-Branch und einem abschließenden PR**, statt die gesamte Vision in drei unverbundene Aufträge zu zerlegen. Interne überprüfbare Commits/Meilensteine sind erwünscht, aber **Abnahme als Ganzes**. Zuerst `PROJECT_REPORT.md` vollständig lesen und gegen `main` prüfen. Nach jedem großen Architektur-/UI-Schritt Tests und Browseraufnahme; weiterarbeiten, bis **alle** B-Kriterien umgesetzt, getestet und dokumentiert sind. Nicht in lange Planungsantworten ausweichen. Keine ungefragten Änderungen außerhalb Phase B.

**Implementationsfolge innerhalb dieses einen Auftrags:**
1. **Orchestrator-/Zustandsverträge und Tests:** Erweiterung `MomentKind`/`MatchPhase`/Restart-Handling; valide Optionsdaten einschließlich räumlicher Ziele für Overlays. Stopp vor Standards, richtige Rückkehr zu Restart und danach `in-play`.
2. **Chronologische Verdichtung:** Simulationsfortschritt bis zur nächsten Entscheidung, ohne Zukunftsberechnung oder Tick-Skipping; messbare Performance und kontrollierbare Abbruchbedingungen.
3. **Grafische Komplettintegration:** bessere Spielerfiguren/Animationen, Kamera, taktische 3D-Hilfen, neue platzsparende Entscheidungs-UI, Starterlebnis/Match/Outcome konsistent; nicht bloß ein neues CSS für das alte Dialogfenster.
4. **Optionen & Konsequenzen:** Angriff, Abwehr, Einwurf, Ecke und mindestens eine weitere rechtlich/physikalisch korrekte Standardsituation; Rückmeldungen aus `MatchEvent`; differente physische Weiterverläufe.
5. **Agentenfundament:** Traits und erste erfahrungsabhängige Auswirkungen mit Tests; strikte Trennung von Personalisierung und Physik.
6. **End-to-End, Kalibrierung, Dokumentation:** Typcheck, Unit/Integration, Build, automatische **echte Browserläufe** mit Screenshots verschiedener Situationstypen; Mehr-Seed-Statistik ohne Überkalibrieren; `PROJECT_REPORT.md` mit tatsächlich gemessenen Fakten, Nicht-Erreichtem und PR-Übergabe aktualisieren.

**Fertig erst, wenn mindestens die folgenden Nachweise vorliegen:**
- [ ] Eine fortlaufende Partie eröffnet mit unterschiedlichen Seeds **Angriffs-/Abwehr- und Standardsituationen**, ohne sie in ein laufendes Match hineinzuerfinden; dokumentierte Häufigkeit. Wenn die Seed-Stichprobe einen Typ nicht erreicht, gezielter **echter** Zustandstest zusätzlich.
- [ ] **Einwurf und Ecke**: vor der Ausführung pausiert, mindestens zwei legale und physikalisch unterscheidbare Optionen; keine illegalen Wiederanpfiffe, keine doppelten Berührungen oder endlosen Neustartschleifen.
- [ ] Verschiedene Benutzerentscheidungen aus derselben initialen Situation bewirken **messbar verschiedene, plausible Folgeereignisse/Spielzustände**; gleiche Option kann je nach Spielausführung unterschiedlich enden; gleicher Seed + gleiche Entscheidungen deterministisch.
- [ ] Eine volle chronologisch berechnete Partie ist trotz Verdichtung regelkonform und erreicht den Abpfiff; **Nutzerzeit/CPU-Zeit/simulierte Zeit** werden getrennt gemessen. 5–10 Minuten sind das UX-Ziel, Abweichungen werden offen dokumentiert.
- [ ] Im echten Browser sind Ball, relevante Spieler, Pass-/Laufwege und alle Optionen **gleichzeitig klar erkennbar**; keine Szenen verdeckende mittige Texttafel, keine abgeschnittenen Einwürfe/Ecken, keine horizontale Gesamtseiten-Scrollleiste. Screenshots **vor Entscheidung, bei Auswahl und nach Konsequenz**.
- [ ] Spielerfiguren und Szenen sind **deutlich hochwertiger** als die sechs Ausgangs-Screenshots; Animationen folgen dem Physikzustand; verwendete Assets/Lizenzen dokumentiert, FPS auf Zielhardware gemessen und mit Phase A verglichen.
- [ ] Das Agenten-/Erfahrungsmodell beeinflusst mindestens **eine real ausgeführte, beobachtbare Aktion** unterschiedlich und reproduzierbar; keine Resultatsteuerung außerhalb der Engine.
- [ ] Alle vorhandenen Tests bleiben grün; neue gezielte Tests und Browserchecks decken Stopp/Fortsetzung, Standards, UI, konsekutive Entscheidungen, Agenteneinfluss und Regressionen ab. Abschlussbericht nennt **Implementiert / Getestet / Gemessen / Geplant** getrennt.
- [ ] **Ein Phase-B-PR** mit Screenshots, Testergebnissen, Architekturänderungen, bewusst nicht umgesetzten Wünschen und aktualisierter Source of Truth. **Kein Merge ohne Abnahme**.

**Wichtige Klarstellung:** Phase B ist eine **Produkt- und Grafikphase** ebenso wie eine Orchestratorphase. Ein technisch vollständiger Matchsimulator mit kosmetisch überarbeitetem Popup ist **nicht** das beauftragte Ergebnis.

### 10.8 Arbeitsplan Phase B (Opus, 20.10.2026)

Ein Branch (`claude/phase-b-arbeitsauftrag-8042ea`), ein PR, interne Meilenstein-Commits. Nach jedem Meilenstein `npm run check`; ab B3 zusätzlich echter Browserlauf. Status der Punkte wird am Ende in §10.9 mit **Implementiert / Getestet / Gemessen / Offen** berichtet.

**B1 – Orchestrator und Zustandsmaschine** (`src/orchestrator/*`, `engine/match-engine.ts`, `engine/types.ts`)
- `MomentDirector` wird kontrolliert zum `Orchestrator`: Ablaufsteuerung (Prüftakt, Abklingzeit, Kontingente je Kategorie und Halbzeit, Vielfalt) getrennt von den Lageerkennern (`open-play.ts`: Angriff, Umschalten, Abwehr; `set-pieces.ts`: Einwurf, Ecke, Freistoß, Elfmeter; `coach.ts`: Halbzeitansprache).
- Engine: `consultOrchestrator()` auch bei ruhendem Ball, **genau einmal pro platziertem Standard**, bevor der Ausführende den Ball spielt. `resolveMoment()` kehrt in die Phase vor dem Moment zurück (`stopped` mit unverändertem `restart` bzw. `in-play`) – kein doppelter Wiederanstoß, kein vorzeitiges `in-play`.
- `DecisionOption.visual` (Akteur, Ballweg, Laufwege, Zielzone) und `DecisionMoment.category/participants` als Datengrundlage für Overlays und Kamera.
- Standardoptionen nur aus vorhandener Mechanik: Einwurf (kurz / nach vorn / sichern – Wurf mit beiden Händen auf einen gewählten Mitspieler, Tempo erst beim Abwurf berechnet), Ecke (kurz / erster Pfosten / zweiter Pfosten / Rückraum, nur wenn ein Mitspieler die Zone real erreicht; neue legitime Laufwegabsicht für Strafraumbesetzung bei Ecken), Freistoß (direkt nur mit realer Abschlusschance, Pass, hoher Ball), Elfmeter (Schussziel links / Mitte / rechts, Torwart reagiert unverändert), Halbzeit (Teamanweisung für den Rest der Partie). Wechsel: **nicht** implementiert (keine Ersatzbank-Logik) → als offen deklariert.
- Tests: Zustandsmaschine (Stopp vor Standard, Rückkehr zu Restart, genau ein `in-play`, kein Moment im Schwung), jede angebotene Standardoption wird physisch ausgeführt, verschiedene Optionen → verschiedene Folgezustände, Determinismus.

**B2 – Agentenfundament** (`src/ai/mind.ts`)
- Stabile Traits je Spieler aus dem Roster-Seed: Risikofreude, Disziplin, Teamorientierung, Grund-Selbstvertrauen.
- Erfahrungsebene: Form/Selbstvertrauen, deterministisch aus echten Ereignissen (Pass angekommen/verloren, Dribbling behauptet/verloren, Schuss aufs Tor) fortgeschrieben; serialisierbar für spätere Persistenz.
- Begrenzter, dokumentierter Einfluss nur auf die **Wahl** (Bewertungsbonus), nie auf Ausführung oder Ergebnis. Tests: gleiche Lage, andere Erfahrung → andere real ausgeführte Aktion; Reproduzierbarkeit.

**B3 – Chronologische Verdichtung** (`src/sim/*`, `app.ts`)
- Engine läuft in einem **Web Worker** chronologisch Tick für Tick (kein Tick-Skipping), hält an jedem offenen Moment an und rechnet nie daran vorbei. Hauptthread rendert aus einem Frame-Puffer (nur Vergangenheit der Simulation).
- Präsentationsregie: ruhige Phasen im Zeitraffer (Taktikkamera), Aufbau der letzten Sekunden vor einem Moment, Tore/Schüsse und die Konsequenzphase nach einer Entscheidung in Echtzeit.
- Messung getrennt: Nutzerzeit (Wanduhr), Rechenzeit des Workers, simulierte Zeit. Test des Runners in Node (hält an Momenten, Puffergrenze, gleiche Ticks wie direkte Engine).

**B4 – Grafik** (`src/render/*`)
- Neue prozedurale Spielerfigur (Rotationskörper-Torso, verjüngte Gliedmaßen, Trikot mit Ärmeln, Hose, Stutzen, geformte Schuhe, Haar, Rückennummer), weiterhin IK an Physikschuhen/-händen; keine fremden Assets (Lizenzfrage entfällt).
- Licht/Material: Umgebungslicht (PMREM), besserer Rasen, gedämpfte Tribüne, Kameraführung, die das Feld statt der Ränge zeigt.
- Entscheidungskamera mit Framing-Löser: Ball, Akteur, Ziele und nahe Gegner im freien Bildbereich (ohne Panel), Kamera im Stadioninneren; Test mit echter Projektion.
- Taktische 3D-Overlays aus `DecisionOption.visual`: Akteur-/Zielringe, Pass-/Schuss-/Laufwege, Zonen, nummeriert passend zu den Tasten; Fokus wechselt mit Hover/Tastatur.

**B5 – Oberfläche** (`src/ui/*`)
- Entscheidungs-UI als schmale Seitenleiste (Desktop) bzw. Unterkante (schmal), Tastatur (1–4, Pfeile, Enter, 0) und Maus, Countdown, Delegation, Spielerform des Akteurs.
- Konsequenzkarte aus beobachteten `MatchEvent`s, Verlaufsleiste mit Momenten/Toren, überarbeiteter Start- und Ergebnisbildschirm mit Entscheidungschronik.

**B6 – Abnahme**
- `scripts/browser-check.mjs` neu: mehrere Momenttypen mit Screenshots vor Entscheidung / bei Auswahl / nach Konsequenz, Prüfung horizontaler Scrollleiste und Panel-Überdeckung, FPS. Vollpartie-Lauf mit Delegation zur Zeitmessung.
- Mehr-Seed-Probe (Regression der Spielstatistik durch Ecken-Laufwege und Agenten), Momentverteilung über Seeds und Halbzeiten, Bericht und PR.

### 10.9 Ergebnis Phase B (20.10.2026) – Implementiert / Getestet / Gemessen / Offen

Ein Branch, interne Meilenstein-Commits, ein PR. Alle Zahlen stammen aus tatsächlich ausgeführten Läufen auf der Testmaschine (Chrome, Intel Iris Xe, ANGLE/D3D11, 1600 × 900).

#### B1 Orchestrator und Zustandsmaschine – implementiert, getestet
- `src/director/` → `src/orchestrator/`: `orchestrator.ts` steuert den Ablauf (Prüftakt 0,1 s, Abklingzeit, Höchstzahl je Halbzeit, Verteilung über die Halbzeit: höchstens 1 + Anteil × Höchstzahl). Kontingente je Kategorie: Angriff 3, Umschalten 1, Abwehr 2, Standard 2, Trainer 1; Einwurf und Freistoß je 1. Bis 75 % der Halbzeit bleibt Platz für noch nicht gesehene Kategorien (Angriff, Standard, Abwehr) reserviert. Lageerkenner: `open-play.ts`, `set-pieces.ts`, `coach.ts`.
- **Zustandsmaschine:** Die Engine fragt den Orchestrator im Spiel jeden Tick und **genau einmal je platziertem Standard**, bevor der Ausführende spielen kann (`RestartState.consulted`). Ablauf `stopped → decision → stopped → in-play`. `resolveMoment()` kehrt in die Phase vor dem Moment zurück (`momentResume`); der Standard bleibt mit demselben Ausführenden und Punkt bestehen. Kein doppelter Wiederanstoß, kein vorzeitiges `in-play`.
- **Datenmodell:** `MomentKind` + `throw-in | corner | free-kick | penalty | team-talk`, `MomentCategory`, `DecisionMoment.participants`, `DecisionOption.visual` (Akteur, Ballweg, Läufe, Zone, Linienverschiebung), Effekt `players` (mehrere Absichten, z. B. Ecke: Schütze + Läufer), `BallAction.throw.receiver`, `RestartState.direct`.
- **Standards nur aus realer Mechanik:**
  - **Einwurf** (gegnerische Hälfte): kurz / nach vorn / zurück, nur auf Mitspieler, die die Arme erreichen. Das Wurftempo wird erst beim Abwurf aus der dann aktuellen Position berechnet (`throwToMate`); geworfen wird wie bisher mit beiden Händen.
  - **Ecke:** kurz / erster Pfosten / zweiter Pfosten / Rückraum – nur besetzte Zonen (Läufer ≤ 30 m entfernt). Neue Laufwegabsicht **Eckball-Routine** (`ai/corner-routine.ts`, für beide Teams): Die drei Größten aus ST/RCB/LCB gehen an den zweiten Pfosten, zum Elfmeterpunkt und an den ersten Pfosten, ein zentraler Mittelfeldspieler in den Rückraum, der Flügelspieler der Eckenseite bietet sich kurz an. Vorher besetzte bei Ecken fast niemand den Strafraum.
  - **Freistoß** (gegnerische Hälfte): direkter Schuss nur nach Foul/Handspiel (`direct`), ≤ 30 m und xG ≥ 0,03; sonst Pass oder hoher Ball in den Strafraum.
  - **Elfmeter:** links unten / rechts unten / halbhoch Mitte; der Torwart reagiert unverändert. **Fehler behoben:** Elfmeter wurden bisher als Pass oder Klärung ausgeführt (Restart-Filter), jetzt werden sie geschossen.
  - **Halbzeitansprache** vor dem Anstoß der 2. Halbzeit: Teamanweisung für den Rest der Partie (`seconds = 0`), Vorgabe „Weiter so“. **Wechsel: nicht implementiert** (keine Ersatzbank) – deshalb kein wirkungsloser Button.
- Ein Standard darf einem anderen Moment schon nach einem Drittel der Abklingzeit folgen. Mit voller Abklingzeit bot keine von 8 Partien eine Ecke an (gemessen). Die Diagnose zeigte gültige Eckoptionen, die nur an der Abklingzeit scheiterten.
- **Tests** (`orchestrator/set-pieces.test.ts`, `orchestrator.test.ts`):
  - Einwurf stoppt vor dem Wurf und kehrt zum selben Restart zurück.
  - Jede Einwurfoption wird mit beiden Händen zum Empfänger geworfen, genau ein `in-play`, kein neuer `restart`.
  - Verschiedene Einwurfoptionen → verschiedene Berührungsfolgen und Ballpositionen (> 2 m); gleiche Option → identischer Verlauf.
  - Ecke: jede Variante ist ein echter Schuss des Schützen, Landepunkte > 5 m auseinander.
  - Der Orchestrator wird je Restart genau einmal gefragt.
  - Direkter Freistoß bietet einen Schuss an, indirekter nicht.
  - Elfmeter: die KI schießt; die gewählte Seite wirkt im Mittel über 6 Schützen (ein Einzelschuss kann streuen).
  - Die Halbzeitansprache gilt die ganze 2. Halbzeit.
  - Einwurf und Ecke entstehen aus einem echten Ball über die Linie. Freistoß und Elfmeter werden mit einer eingespeisten Schiedsrichterentscheidung gestartet, weil sich ein Foul aus Körpern nicht reproduzierbar inszenieren lässt.

#### B2 Agentenfundament – implementiert, getestet
- `PlayerProfile.traits` (Risikofreude, Disziplin, Teamorientierung, Grund-Selbstvertrauen) aus einem **eigenen** Zufallsstrom des Rosters: Die Fähigkeiten aller Kader bleiben exakt wie vorher.
- `ai/mind.ts`: `PlayerMind` (Form = Selbstvertrauen + letzte 6 bewertete Aktionen) und `ExperienceTracker`. Der Tracker urteilt aus dem Ereignisstrom: Pass gelungen, wenn ein Mitspieler als Nächster den Ball berührt; Dribbling, wenn der Spieler selbst wieder an den Ball kommt; Schuss, wenn er aufs Tor geht (Tor, Torwart). Deterministisch, serialisierbar (`view()`), ohne Remote-Dienst.
- **Einfluss nur auf die Wahl:** Bonus auf den Optionswert ≤ ≈ 0,015 xT (Schuss/Dribbling: Risiko, Selbstvertrauen, minus Teamorientierung; Pass: Teamorientierung). Disziplin skaliert, wie viel der Risiko-Vorgabe des Trainers ein Spieler übernimmt (0,5–1,5). Ausführung, Ballphysik und Schiedsrichter bleiben unverändert.
- **Sichtbar:** Die Entscheidungsleiste zeigt Selbstvertrauen, die letzten Aktionen (gelungen/misslungen) und deutliche Traits des Akteurs – nur aus tatsächlichen Ereignissen, keine erfundenen Emotionen.
- **Tests** (`ai/mind.test.ts`):
  - Urteil aus Ereignissen, deterministisch.
  - Eine abgelaufene offene Aktion wird verworfen. **Absturz gefunden und behoben** (aufgedeckt durch die Mehr-Seed-Probe; er hätte auch den Browser-Worker getroffen).
  - Traits streuen, Disziplin ändert die Übernahme der Vorgabe.
  - **Gleiche Lage, andere Erfahrung → real ausgeführter Pass bzw. Dribbling** (Linksaußen, Seed 4), reproduzierbar.
  - In einer autonomen Partie bewegen echte Aktionen die Form, identisch bei Wiederholung.
- Offen (bewusst): Beziehungen zwischen Spielern, Lernen über Partien hinweg, Persistenz.

#### B3 Chronologische Verdichtung – implementiert, getestet, gemessen
- `sim/runner.ts`: eine autoritative Engine, Tick für Tick; hält bei offenem Moment und rechnet nie daran vorbei. `sim/sim-worker.ts`: Web Worker, Vorlauf höchstens 90 s, Stapel à 30 Ticks. `sim/frame-codec.ts`: ≈ 2,3 kB je Tick als Float32. Dazu `sim/sim-client.ts` und `sim/playback.ts`.
- **Präsentationsregie:** Echtzeit für die letzten 5 s vor einem Moment, 8 s nach jeder Entscheidung, um Schüsse (−1,5/+3,5 s) und Tore (−3/+6 s). Sonst verdichtet ×4–×24 mit Übersichtskamera und Anzeige „VERDICHTET ×n“. Beim Verdichten bleibt das Bild ≥ 6 s hinter der Simulation, damit der Aufbau eines folgenden Moments in Echtzeit gezeigt werden kann. Das geht, weil die Simulation dem Bild vorausläuft – eine Entscheidung kennt sie dabei nie im Voraus.
- **Phase-A-Schutzplanken:** Die Zeitraffer-Regeln aus `time-lapse.ts` (Strafraum, ruhender Ball, hoher Ball, Zweikampf → normales Tempo) gelten unverändert im Modus „Alles live“ (Schalter auf dem Startbildschirm, Taste `L`, `?condense=0`). Im Standardmodus ersetzt die Verdichtung nach §10.2.6 auch Phasen, die Phase A in Echtzeit zeigte. Das ist eine bewusste, im Bild gekennzeichnete Abweichung.
- **Tests** (`sim/runner.test.ts`): Frame-Kodierung verlustarm; der Runner hält am Moment, erzeugt währenddessen keinen Tick und setzt danach am nächsten Tick fort; Runner und direkt gesteppte Engine ergeben dieselbe Partie (gleiche Ballposition, gleiche Ereignisfolge); die Regie verdichtet ohne die Simulation zu überholen, zeigt den Aufbau ≥ 4,5 s in Echtzeit und hält am Moment; ohne Verdichtung klassisches Tempo.

**Gemessen – Vollpartie im Browser** (`CHECK_FULL=1 npm run test:browser`, Seed 7, 2 × 45 min, jede Entscheidung nach 2 s delegiert):

| Messgröße | Wert |
| --- | --- |
| Abpfiff erreicht, regelkonform | ja (116 Wiederanstöße, 11 Momente, 0 Fehler/Warnungen) |
| Simulierte Zeit | 90:06 min |
| **Nutzerzeit (Wanduhr)** | **24:25 min** |
| Rechenzeit des Workers | 22:47 min (≈ 4,2 ms je Tick) |
| FPS live / verdichtet | 60,3 / 55 |

**Das UX-Ziel 5–10 min für 90 Minuten wird auf dieser Hardware nicht erreicht.** Die Nutzerzeit liegt nur 7 % über der reinen Rechenzeit: Begrenzend ist die Simulation selbst, nicht die Regie. In Node (ein Kern) kostet ein Tick 2,97 ms, davon 55 % Rapier-Physik (≥ 240 Hz bei rollendem Ball) und 45 % Wahrnehmung/Entscheidung; im Browser-Worker ≈ 4,2 ms. Ausgelassene Ticks sind ausgeschlossen (§10.2.6). Hochgerechnet: 2 × 15 min ≈ 8 min Nutzerzeit (im Ziel), 2 × 5 min ≈ 3 min. Nächste Hebel (nicht umgesetzt, jeweils mit Messung der Spielstatistik): KI-Kosten je Tick senken (Wahrnehmung/Optionsbewertung seltener oder zwischengespeichert), Physik-Teilschritte weiter auf das Nötige beschränken.

#### B4 Grafik – implementiert, im Browser geprüft
- **Spielerfigur** (`render/figure-geometry.ts`, `player-view.ts`), prozedural:
  - Rotationskörper-Torso mit Kragen und Seitenstreifen, Schulterkappen, Hose, verjüngte Kapsel-Gliedmaßen, kurze Ärmel (Torwart: lange Ärmel, Handschuhe), Stutzen, geformte Schuhe mit farbiger Sohle, Kopf mit Haar und Nase, Rücken- und Brustnummer.
  - Alle Teile mit Vertexfarben und **einem** gemeinsamen Material (≈ 12 Draw Calls je Figur).
  - Keine externen Assets → keine Lizenzfrage, keine Likenesses.
  - IK an Physikschuhen und -händen sowie Rumpfneigung bei Kopfball, Brustannahme und Grätsche wie bisher.
- **Stadion/Licht:** Zuschauer im Halbdunkel (Farben ×0,3–0,42, kleinere Figuren), dunklerer Rasen mit Mähstreifen, Startkamera innerhalb des Stadions (vorher hinter der Rückwand). Eine Umgebungs-Lichtkarte wurde getestet und verworfen: Sie erzeugte D3D-Shader-Warnungen in der Konsole.
- **Kamera:**
  - TV-Kamera etwas näher (18 statt 21 m Höhe); die Phase-A-Kameratests bleiben grün.
  - Übersichtskamera beim Verdichten.
  - **Entscheidungs-Framing** (`render/framing.ts`): sucht über 16 Richtungen × 3 Höhenwinkel die engste Ansicht, in der Ball, Akteur, alle Beteiligten (Kopf und Füße), Ziele und Zonen im freien Bildbereich neben der Leiste liegen. Die Kamera steht dabei über den Rängen, unter den Dächern und innerhalb der Rückwände.
  - **Fehler gefunden und behoben:** Im ersten Browserlauf stand die Kamera bei einem Durchbruch hinter der Tribünen-Rückwand (graues Bild). Test `framing.test.ts` deckt jetzt 7 Lagen ab.
- **Taktische Overlays** (`render/tactical-overlay.ts`): Akteur-Ring (pulsierend), Ringe für Mitspieler und Gegner, Ballmarkierung; je Option Ballweg (flach, hoch als Bogen, Schuss, Einwurf, Dribbling), Läufe, Zonen, Linienverschiebung bei Teamanweisungen, Nummer passend zur Taste. Der Fokus folgt Maus und Pfeiltasten, die anderen Optionen treten zurück.

#### B5 Oberfläche – implementiert, im Browser geprüft
- **Entscheidungs-Seitenleiste** rechts (≤ 380 px; unter 820 px Breite an der Unterkante, höchstens 48 vh): Kategorie, Countdown, Lage, Akteur mit Form, Optionen mit ehrlicher Einschätzung, Markierung „Tendenz der Spieler“ an der Vorgabe, „Den Spielern überlassen“ (`0`), Tasten `1–4`, `↑/↓` + `Enter`, Maus.
- **HUD:** Spielstand, Modus (LIVE / VERDICHTET ×n / ENTSCHEIDUNG), Verlaufsleiste mit Toren und Momenten, Ticker (während der Entscheidung ausgeblendet).
- **Konsequenzkarte:** nennt nur beobachtete Ereignisse nach der Entscheidung (wer spielte, wer bekam den Ball, Parade/Block, Aus, Foul, Tor). Ohne klares Ergebnis nach 12 s neutral: „Danach ging es ohne klares Ergebnis weiter.“ Bei Abwehrmomenten endet sie mit dem eigenen Ballkontakt, bei der Halbzeitansprache sofort.
- **Start- und Ergebnisbildschirm:** drei Schritte, Spieldauer, Schalter Verdichtung; am Ende Messwerte der Sitzung und Chronik aller Entscheidungen mit Ausgang.

#### B6 Abnahme – Messungen

**Momentverteilung in fortlaufenden Partien** (`npm run probe -- --seeds 1-8 --minutes 15 --parallel 8 --orchestrator`; App-Einstellungen für 2 × 15 min: Abklingzeit 25 s, höchstens 5 je Halbzeit; jeder Moment nach Ablauf mit der Vorgabe entschieden):

| | 8 Partien × 2 × 15 min |
| --- | --- |
| Momente gesamt / je Partie | 79 / 9,9 |
| 1. / 2. Halbzeit | 35 / 44 (inkl. 8 Halbzeitansprachen) |
| Angriff (Abschluss/Ablage 2, Durchsetzen 12) | 14 |
| Abwehr (Strafraum 20, Durchbruch 9) | 29 |
| Umschalten (Gegenpressing 12, Konter 4) | 16 |
| Standard (Einwurf 10, Ecke 2) | 12 |
| Trainer (Halbzeitansprache) | 8 |

Jede Partie hatte Angriffs-, Abwehr- und mindestens eine Standard- oder Trainersituation. **Freistoß und Elfmeter kamen in dieser Stichprobe nicht vor:** Freistöße für das Nutzerteam lagen in der Diagnose (6 Seeds × 2 × 8 min) alle unterhalb der Schwelle (13 von 14 in der eigenen Hälfte; dort bewusst kein Moment), Elfmeter sind selten (≈ 0,2/90). Beide sind durch gezielte Zustandstests abgedeckt; im Browserlauf (Seed 7, 2 × 15 min) kam ein **echter Elfmeter-Moment** in der fortlaufenden Partie vor. Mit voller Abklingzeit für Standards waren es 0 Ecken in 8 Partien – deshalb gilt für Standards ein Drittel davon (vorher 10 Standards, nachher 12).

**Spielstatistik ohne Orchestrator** (`npm run probe -- --seeds 1-24 --minutes 10 --parallel 8`, pro 90 min; `main` = `bd9c9d1`):

| | `main` | Phase B ohne Agenten-Bias (Ablation) | **Phase B** | real |
| --- | --- | --- | --- | --- |
| Tore (Eigentore) | 2,4 (0,4) | 2,3 (0) | **3,0 (0,4)** | ≈ 2,7 |
| Torschüsse (nach Kombination) | 14,4 (2,3) | 14,6 (1,9) | **19,3 (1,1)** | ≈ 25 |
| Pässe / Passquote | 1354 / 76 % | 1337 / 76 % | **1264 / 78 %** | ≈ 1000 / 75–85 % |
| Ballbesitzwechsel | 1213 | 1212 | **1315** | – |
| Fouls / Elfmeter | 29,8 / 0,2 | 32,1 / 0,2 | **25,3 / 0** | ≈ 22 / 0,3 |
| Ecken / Einwürfe | 9,8 / 57 | 8,4 / 63,6 | **7,7 / 66,9** | ≈ 10 / 45 |

Bewertung: Die Ablation trennt die Ursachen. Eckball-Routine und die übrigen Standardänderungen allein ändern die Statistik kaum (Einwürfe +6,6 im Rauschbereich ±5). Die Agenten (Risikofreude, Form) machen das Spiel mutiger: mehr Schüsse (näher am realen Wert), weniger Pässe (näher an ≈ 1000), weniger Fouls, aber mehr Ballbesitzwechsel und etwas mehr Einwürfe. Bewusst **nicht nachkalibriert** (60-Minuten-Budget je Mess- und Kalibrieraufgabe, Gefahr des Überkalibrierens); Kandidat für die nächste Kalibrierung.

**Browserläufe** (`npm run test:browser`, Chrome headless, Intel Iris Xe, ANGLE/D3D11):

| Lauf | Ergebnis |
| --- | --- |
| Desktop 1600 × 900, Seed 7, 2 × 15 min (Endstand des Codes) | `ok`, 0 Fehler, 0 Warnungen; 11 Momente in 7 Arten (Durchbruch, Gegenpressing, Durchsetzen, Strafraumgefahr, **Elfmeter**, **Halbzeitansprache**, **Einwurf**); jedes Mal Simulation eingefroren, Entscheidung per Taste als `user` protokolliert, **kein Beteiligter vom Panel verdeckt oder außerhalb des Bildes**, keine horizontale Scrollleiste; FPS live 60,3 / verdichtet 56,7; Worker-Rechenzeit 444,6 s |
| Desktop, früherer Lauf Seed 7, 2 × 15 min (vor den letzten Korrekturen) | zusätzlich eine **Ecke** in der fortlaufenden Partie (in der Vollpartie unten ebenfalls) |
| Schmal 800 × 900, Seed 7, 2 × 5 min | `ok`, Leiste an der Unterkante, 0 verdeckte Beteiligte (vor der Korrektur 2 verdeckte Füße und ein Bild über die Tribüne), keine Scrollleiste, 60 FPS |
| Produktions-Build (`npm run build`, `CHECK_PREVIEW=1`), Seed 7, 2 × 5 min | `ok`, Simulation als Worker-Chunk lauffähig, 2 Momente als `user` entschieden, 0 Fehler/Warnungen, 51 FPS live |
| Vollpartie 2 × 45 min, Seed 7, Delegation nach 2 s | Abpfiff, 0 Fehler/Warnungen, 11 Momente (u. a. Ecke, Halbzeitansprache), Nutzerzeit 24:25 min, Worker 22:47 min, simuliert 90:06 min, FPS 60,3 / 55 |

Beobachtet: Bei 2 von 11 Desktop-Momenten (Durchsetzen → Pass gewählt) kam der Pass nicht mehr zustande, weil der Gegner den Ball vor dem Schwung eroberte; die Konsequenzkarte meldet das korrekt („Der Gegner hat den Ball.“).

Screenshots (je vor der Entscheidung, mit fokussierter Option, nach der Konsequenz): `docs/phase-b/`.

#### Abnahmekriterien §10.7

- [x] Fortlaufende Partien eröffnen Angriffs-, Abwehr-, Umschalt-, Standard- (Einwurf, Ecke, im Browser auch Elfmeter) und Trainersituationen aus dem echten Zustand; Häufigkeit dokumentiert (oben). Freistoß zusätzlich per gezieltem Zustandstest.
- [x] Einwurf und Ecke: vor der Ausführung pausiert, ≥ 2 legale, physikalisch unterscheidbare Optionen, genau ein `in-play`, keine Neustartschleife (Tests).
- [x] Verschiedene Entscheidungen aus derselben Lage → messbar verschiedene Folgen (Einwurf, Ecke, offenes Spiel); gleiche Option kann je nach Ausführung anders enden (Schuss aus 19 m über 12 Seeds, Elfmeter über 6 Schützen); gleicher Seed + gleiche Entscheidungen deterministisch (Runner = direkte Engine; Einwurf-Wiederholung identisch).
- [~] Volle Partie chronologisch, regelkonform bis Abpfiff; Nutzer-, Rechen- und simulierte Zeit getrennt gemessen. **Das 5–10-min-Ziel wird für 2 × 45 min nicht erreicht (24:25 min)**, Ursache gemessen (Rechenzeit je Tick); für 2 × 15 min hochgerechnet ≈ 8 min.
- [x] Im Browser sind Ball, relevante Spieler, Wege und Optionen gleichzeitig sichtbar: keine mittige Tafel, automatische Prüfung „Panel verdeckt keinen Beteiligten“ auf 1600 × 900 und 800 × 900, keine horizontale Scrollleiste; Screenshots vor Entscheidung, bei Auswahl, nach Konsequenz.
- [x] Figuren und Szene deutlich hochwertiger (prozedurale Figur, Licht, Kamera, Overlays); keine fremden Assets; FPS gemessen: 60 live / 55–59 verdichtet (Phase A: 53).
- [x] Agentenmodell beeinflusst eine real ausgeführte Aktion unterschiedlich und reproduzierbar (Pass vs. Dribbling); keine Ergebnissteuerung.
- [x] Alle vorhandenen Tests grün; neue Tests für Stopp/Fortsetzung, Standards, Framing, Regie, Agenten, Determinismus (129 Tests, 24 Dateien).
- [x] Ein PR mit Screenshots, Messwerten und bewusst nicht Umgesetztem; **kein Merge ohne Abnahme**.

#### Bewusst nicht umgesetzt / offen
- **Spielzeit 5–10 min für 2 × 45 min** (siehe B3): erfordert eine schnellere Simulation; keine Abkürzung durch ausgelassene Ticks.
- **Wechsel**, Ersatzbank, Torwart-Elfmeterwahl (Torwart reagiert nur), Mauer bei Freistößen, defensive Eckenvarianten.
- **Szenario-/Trainingsmodus** (§10.2, optional): nicht gebaut; die Zustandstests nutzen `stageScenario` nur in Tests.
- **Agenten:** Beziehungen, partienübergreifendes Lernen, Persistenz.
- **Grafik:** keine Gesichter/Animationen aus Motion-Capture; Laufzyklus der Beine weiter dekorativ (Physikschuhe ruhen unter der Hüfte, §7).
- **Statistik:** Ballbesitzwechsel und Einwürfe durch die Agenten erhöht (oben), nicht nachkalibriert.
- Der Konsequenztext urteilt nur über die ersten 12 s; spätere Folgen werden bewusst nicht einer Entscheidung zugeschrieben.

### 10.10 Phase-B-Restarbeiten und finale Abnahme (22.10.2026)

**Ausgangslage:** PR #33 ist am 22.10.2026 gemergt worden. Ein gemergter PR lässt sich nicht mehr aktualisieren; die Restarbeiten laufen deshalb auf demselben Branch (auf den Merge-Stand von `main` vorgespult) weiter und gehen als **ein Folge-PR** mit Verweis auf #33 zur Abnahme. Kein Merge ohne Freigabe.

**Unterarbeitsplan** (Abhängigkeiten: R1 vor R2, weil jede Verhaltensmessung auf dem schnellen Stand laufen muss; R3/R4 vor R5, weil die Vergleichsbilder auch die neuen Mechaniken zeigen sollen):
- **R1 (P0) Simulationsleistung:** Profiling-Werkzeug (`scripts/perf/profile.mjs`, `bench.mjs`), Hotspots nach Selbst- und Inklusivzeit; zuerst bit-identische Optimierungen (Nachweis: Ereignisfolge und Ballposition gleich), dann Rechenintervalle mit 24-Seed-Regression; Vollpartie im Browser messen.
- **R2 (P1) Agenten nachkalibrieren:** Ablation der drei Trait-Anteile (Risiko, Selbstvertrauen, Teamorientierung), 24 Seeds je Variante (48 bei unsicherem Befund), gemeinsame Bewertung von Schüssen, Toren, Passquote, Fouls, Einwürfen und Ballbesitzwechseln; Charaktertest muss grün bleiben.
- **R3 (P1) Mechaniken:** Ersatzbank und Auswechslungen (Regel 3: höchstens 5 Wechsel, 3 Gelegenheiten plus Halbzeit, nur bei ruhendem Ball, Eintritt an der Mittellinie, keine Rückkehr); Torwart beim gegnerischen Elfmeter (abwarten / früh links / früh rechts, auf der Torlinie nach Regel 14); Freistoßmauer (2 / 4 Spieler, 9,15 m, oder keine Mauer) samt direktem Freistoß der KI; defensive Ecken (Mann-, Raum-, gemischte Deckung mit Konterspielern).
- **R4 (P2) Agentensystem:** Beziehungen (gelungene Zuspiele stärken das Vertrauen zwischen zwei Mitspielern und beeinflussen die Passwahl), partienübergreifende Erfahrung, versionierte lokale Persistenz (JSON, `localStorage` im Browser), reproduzierbar.
- **R5 (P2) Grafik:** Prüfung aller Screenshots, Verbesserungen an Figur und Animation (Laufen, Drehen, Schuss, Zweikampf), Kamera und Markierungen; Vergleichsbilder aus identischen Situationen (gleicher Seed, gleicher Tick) und FPS-Messung.
- **R6 (optional) Szenariomodus:** nur wenn R1–R5 abgeschlossen sind; sonst als eigener Folgepunkt dokumentiert.
- **R7 Abschluss:** `npm run check` nach jedem Schritt, Browser- und Produktions-Build-Prüfung, Mehr-Seed-Regression gegen den Phase-B-Stand, Bericht und Folge-PR.

#### R1 (P0) Simulationsleistung – implementiert, gemessen; Ziel 10 min **nicht erreicht**

**Werkzeuge:**
- `scripts/perf/profile.mjs`: CPU-Profil mit Selbst- und Inklusivzeit je Funktion.
- `scripts/perf/bench.mjs`: ms pro Tick über vier Seeds à 120 s; ein einzelner Seed misst nur einen Spielabschnitt und streut um ±10 %.
- `scripts/perf/browser-bench.mjs` mit `perf/`: die Simulation allein im Browser-Worker, ohne Grafik.
- Nachweis für alle bit-identischen Schritte: Ereignisfolge und Ballposition nach 60 s Spielzeit sind gleich dem Ausgangscode.

**Ausgangsprofil (`main`, Node):** 3,27 ms pro Tick. Davon ≈ 55 % Rapier-Physik inklusive JS↔WASM-Übergängen, ≈ 33 % Spieler-KI (davon 12,5 % „bin ich am schnellsten am Ball?“), ≈ 2 % Snapshot und Kodierung.

| Schritt | Art | ms/Tick (Node, 4 Seeds) |
| --- | --- | --- |
| Ausgang `main` (3dcfd79) | – | 3,27 |
| Stiefel-Collider nur in Ballnähe in der Broadphase (Stiefel kollidieren nur mit dem Ball), Ballbahn je Ballzustand einmal, Suche bei der eigenen Ankunftszeit beendet, Körperposition und -geschwindigkeit je Physikschritt gepuffert, ruhende Stiefel nur zum Tick-Ende gesetzt | **bit-identisch** | 2,43 |
| + Mechaniken, Kalibrierung, Ersatzbank (Spielinhalt ändert sich) | Verhalten | 2,76 |
| + Neuplanung 20 Hz für Spieler > 22 m vom Ball | Verhalten (24 Seeds geprüft) | 2,58 |
| + 2 statt 4 Physik-Teilschritte bei sauber rollendem Ball < 10 m/s | Physik gleichwertig (max. 3,3 cm Abweichung nach 5 s, 4–32 m/s, Drall, Aufsetzer; Schusslabor identisch) | 2,00 |
| + Neuplanung 30 Hz für Spieler ohne Ball zwischen 5 und 22 m | Verhalten (48 Seeds geprüft) | 1,69 |
| + Frames direkt aus der Engine kodiert | bit-identisch | **1,50 (−54 %)** |

**Gemessen und verworfen:**
- Rapiers interne Solver-Teilschritte statt äußerer Teilschritte: Rollverhalten falsch (nach 1 s 4,75 statt 7,17 m/s, Rollweg 18,7 statt 29,5 m).
- 2 oder 3 Teilschritte für jeden Bodenball: Schuss mit 25 m/s 6 m kürzer, mit 32 m/s 2,4 % kürzer.
- Rollschwelle 14 m/s statt 10 m/s: bis 0,38 m Abweichung.
- 2 statt 4 Solver-Iterationen: Pfostenabpraller 0,93 m anders.
- Untätige Kopf- und Brustkörper nicht mehr setzen: kein messbarer Effekt.

**Browser, volle Partie 2 × 45 min** (Intel Iris Xe; jede Entscheidung nach 2 s delegiert, damit sie reproduzierbar bleibt):

| Stand | Nutzerzeit | Rechenzeit Worker | ms/Tick im Browser | FPS live / verdichtet |
| --- | --- | --- | --- | --- |
| Phase B (PR #33, Dev-Server) | 24:25 | 22:47 | 4,2 | 60 / 55 |
| nach den Optimierungen (Dev-Server) | 15:33 | 13:18 | 2,46 | 60 / 60 |
| Produktions-Build | 14:46 | 12:30 | 2,31 | 56 / 60 |
| + Rendern im verdichteten Modus mit 30 FPS, Schatten seltener | 14:31 | 12:10 | 2,25 | 55 / 60 |
| **Endstand (Produktions-Build)** | **14:04** | 11:40 | 2,16 | 50 / 60 |

**Warum das Ziel nicht erreicht wird (gemessen):**
- Ohne Grafik kostet die Simulation im Browser-Worker 1,64 ms pro Tick, in Node 1,50 ms. Während einer 14-minütigen Partie mit 3D-Bild steigt das auf ≈ 2,25 ms: Worker und Grafik teilen sich das Wärme- und Leistungsbudget des Laptops.
- Die Nutzerzeit liegt nur ≈ 20 % über der Rechenzeit (Entscheidungen, der Aufbau vor jedem Moment in Echtzeit, Start). Die Rechenzeit selbst begrenzt also.
- Für 10 min müsste ein Tick im Browser unter Dauerlast ≈ 1,55 ms kosten (in Node ≈ 1,05 ms). Das ginge nur mit noch weniger Physik (die verbleibenden Teilschritte werden für Drall und harte Bälle gebraucht) oder deutlich seltener planenden Spielern; beides würde Ballphysik oder Reaktionen messbar verschlechtern. Deshalb nicht gemacht.
- **Was das Ziel einhält:** 2 × 15 min ≈ 4,9 min Nutzerzeit (hochgerechnet aus der gemessenen Rechenzeit pro Tick, nicht als eigene Partie gemessen). Die volle Länge liegt bei ≈ 14,5 min.
- **Verbleibende Möglichkeiten:**
  - (a) Wahrnehmung, Freilaufsuche und Abfangprüfung algorithmisch weiter verbilligen (jeweils 2–5 % eines Ticks),
  - (b) Rapier mit Mehrkernunterstützung (für den JS-Build derzeit nicht verfügbar),
  - (c) KI auf mehrere Worker verteilen: Das bräche den gemeinsamen, deterministischen Zustand pro Tick, also nur mit großem Umbau,
  - (d) auf stärkerer Hardware messen.

#### R2 (P1) Agenten nachkalibriert – implementiert, gemessen
- **Ursache:** Die Form wirkte als `(Selbstvertrauen − 0,5)`. Selbstvertrauen pendelt sich bei ≈ 76 % gelungenen Aktionen aber bei ≈ 0,66 ein. Damit bekamen alle Spieler einen dauerhaften Zuschlag für Dribbling und Schuss: mehr Ballverluste und Einwürfe.
- **Korrektur:** Die Form wird gegen die neutrale Lage gemessen, den Fixpunkt der eigenen Aktualisierungsregel (`neutralConfidence`). Sie wirkt damit nur bei echter Abweichung: Charakterunterschiede bleiben, die Verschiebung ist weg. Der Charaktertest (gleiche Lage, gute Form → Dribbling, schlechte Form → Pass) bleibt grün.

| pro 90 min | `main` (24 Seeds) | Phase B (48 Seeds) | nur Kalibrierung (24 Seeds) | **Endstand (48 Seeds)** | real |
| --- | --- | --- | --- | --- | --- |
| Tore (Eigentore) | 2,4 (0,4) | 2,9 (0,4) | 3,6 (0,6) | **3,6 (0,5)** | ≈ 2,7 |
| Torschüsse (nach Kombination) | 14,4 (2,3) | 20,4 (2,0) | 25,3 (1,9) | **20,0 (2,0)** | ≈ 25 |
| Pässe / Passquote | 1354 / 76 % | 1257 / 78,5 % | 1346 / 77 % | **1342 / 77 %** | ≈ 1000 / 75–85 % |
| Ballbesitzwechsel | 1213 | 1297 | 1216 | **1262** | – |
| Fouls / Elfmeter | 29,8 / 0,2 | 26,0 / 0,2 | 27,2 / 0,4 | **25,6 / 0,1** | ≈ 22 / 0,3 |
| Ecken / Einwürfe | 9,8 / 57 | 8,2 / 66,3 | 11,3 / 57,2 | **8,0 / 61,7** | ≈ 10 / 45 |
| vom Torwart gefangen | – | 5,4–6,4 | 6,2 | **3,3** | – |

**Bewertung:**
- Einwürfe (66 → 62) und Ballbesitzwechsel (1297 → 1262) sind gegenüber Phase B gesunken, die Passzahl liegt wieder auf `main`-Niveau, Fouls näher am Richtwert. Die Schüsse bleiben deutlich über `main`.
- „Nur Kalibrierung“ ist der Stand nach der Korrektur, aber vor den neuen Mechaniken. Die anschließenden Standardregeln (Aufstellzeit, Mauer, Ausführung nur durch Stoß) nehmen einen Teil der Schüsse und Ecken wieder weg.
- **Offen:** Tore 3,6/90 (Phase B 2,9; Unterschied ≈ 1 Standardabweichung bei 48 Seeds, nicht gesichert) und weniger Fänge des Torwarts. Das Schusslabor ist zwischen Phase B und Endstand **identisch** (gleiche Paradenquote und Fänge auf 8–25 m), die Torwartphysik ist also unverändert. Die Ursache liegt im Spielinhalt (Schussmix, Mauern) und ist der nächste Kalibrierkandidat.

#### R3 (P1) Fehlende Entscheidungsmechaniken – implementiert, getestet
- **Ersatzbank und Wechsel:**
  - Je Team 5 Ersatzspieler (TW, IV, ZM, RA, ST) aus eigenem Zufallsstrom; die Startelf ist unverändert, eine Partie ohne Wechsel bleibt bit-identisch zur Partie ohne Bank.
  - `MatchEngine.substitute()` nach Regel 3: höchstens 5 Wechsel, 3 Gelegenheiten plus Halbzeit, nur bei ruhendem Ball; Eintritt an der Mittellinie, Übernahme der Position, keine Rückkehr; die Bank ist komplett aus der Physik genommen.
  - Wechsel-Moment in der 2. Halbzeit (höchstens 2): Formschwächster (aus echten Aktionen), Gelbgefährdeter, offensiver oder defensiver Wechsel mit echten Fähigkeitswerten. Es gibt kein Ermüdungsmodell, deshalb wird auch keine Müdigkeit behauptet. Vorgabe: „Keinen Wechsel“.
- **Torwart beim gegnerischen Elfmeter:** Er steht vor dem Schuss auf der Torlinie (Regel 14). Wählbar: abwarten (bisherige Reaktion), früh links, früh rechts – der Sprung startet beim Schuss ohne Reaktionszeit, egal wohin der Ball geht.
- **Freistoßmauer:**
  - Bei direkten Freistößen bis 30 m stellen sich standardmäßig 3 Verteidiger in eine Mauer, 9,8 m vom Ball auf der Linie zur kurzen Torhälfte.
  - Wählbar: 2, 3, 4 oder keine Mauer (dann besetzen 3 Spieler die Fünfmeterlinie).
  - Die KI schießt jetzt direkte Freistöße mit realer Chance (xG ≥ 0,05); vorher wurden Freistöße immer gespielt, eine Mauer wäre bedeutungslos gewesen.
- **Defensive Ecken:** wie gewohnt, Manndeckung (jeder Angreifer im Strafraum bekommt einen Gegenspieler), Raumdeckung (beide Pfosten, Fünfmeterlinie, Elfmeterpunkt, Strafraumkante), Raum plus zwei Konterspieler an der Mittellinie.
- **Regelkorrekturen (IFAB), beim Testen gefunden:**
  - Ein Standard (außer Einwurf) ist erst ausgeführt, wenn der Ball gestoßen wird. Vorher reichte ein Körperkontakt oder ein ruhender Stiefel, auf den der Ball gelegt wurde.
  - Abstand bei Standards: Toleranz 0,1 statt 0,5 m (vorher ging ein Verteidiger auf 8,7 m).
  - Aufstellzeit vor Ecken (3,5 s) und torgefährlichen Freistößen (2,5 s); vorher war die Ecke ausgeführt, bevor jemand im Strafraum stand.
  - Ausgewechselte und vom Platz gestellte Spieler verschwinden aus der Wahrnehmung der anderen (vorher liefen sie als „Geister“ weiter).
- **Tests** (`orchestrator/mechanics.test.ts`, 9 Tests):
  - Wechsel: Ein- und Auswechslung, Position, keine Rückkehr; Grenzen; nicht im Spiel; Wechsel-Moment.
  - Elfmeter-Torwart: auf der Linie; früher Sprung in die gewählte Richtung; über 8 Seeds mit richtig geratener Ecke mehr Paraden als mit falsch geratener, ohne vorbestimmte Parade.
  - Mauer: 3 per Vorgabe, gewählte 4 bzw. keine, alle ≥ 9,15 m.
  - Ecke: Mann-, Raum- und Konterdeckung stellen dieselben Verteidiger an deutlich verschiedene Orte (> 2 m), alle legal entfernt.
  - Dazu angepasste Bestandstests: direkter Freistoß nur mit freier Schussbahn; Einwurf genau einmal ausgeführt; Schiedsrichtertests mit der Startelf.

#### R4 (P2) Agentensystem erweitert – implementiert, getestet
- **Beziehungen:** Ein angekommener Pass stärkt das Vertrauen des Passgebers in den Empfänger (+0,1) und umgekehrt (+0,05); ein verlorener Pass senkt es (−0,08). Das Vertrauen fließt mit höchstens 0,003 xT in die Passwahl ein. Test: Zwischen zwei fast gleichwertigen Pässen entscheidet das Vertrauen über den real gespielten Pass.
- **Gedächtnis über Partien** (`ai/agent-memory.ts`, Version 1, `localStorage`-Schlüssel `the12thman.agents.v1`, kein Cloud-Dienst):
  - Nach jeder Partie bewegt sich das Grund-Selbstvertrauen um ein Viertel der End-Form, höchstens ±0,15 um den Trait; das Vertrauen wird zu 80 % mitgenommen.
  - Andere Version oder anderer Kader: Neustart.
  - Start- und Ergebnisbildschirm zeigen das Gedächtnis und was die Spieler mitnehmen; „Zurücksetzen“ ist möglich.
  - `?memory=0` spielt ohne Gedächtnis (Browsercheck, reproduzierbar).
- **Beobachtbare Wirkung:** Ein höheres Grund-Selbstvertrauen lenkt leicht zu Einzelaktionen (≤ 0,001 xT); gespeichertes Vertrauen wählt in der nächsten Partie den Empfänger (Test).
- **Reproduzierbar:** gleiche Partie → gleiches Gedächtnis (Test). Agenten berühren weiterhin keine Ballzustände und keine Ergebnisse.

#### R5 (P2) Grafische Qualität – implementiert, im Browser geprüft
- **Figur:** Der Kopf ist ein eigenes Teil am Halsgelenk und folgt dem Ball (±63°); Muskelwölbung an Oberschenkel, Wade und Unterarm.
- **Animation:**
  - Laufschritt mit Kniehub, Fersenhub und leichtem Wippen; Arme schwingen gegen die Beine, stärker mit dem Tempo.
  - Neigung in Kurven aus Drehrate × Tempo.
  - Beim Schuss: Standbein beugt sich, Balance-Arme (der Arm gegenüber dem Schussbein nach vorn außen).
  - In der Grätsche stützen die Arme nach hinten.
  - Alles, was den Ball berührt, bleibt dort, wo die Physik es hat.
- **Vergleichbarkeit:**
  - `src/engine/record-scenes.test.ts` (nur mit `RECORD_SCENES=1`) zeichnet echte Spielzustände auf: Seed 7, Sprint, Drehung, Schuss mitten im Schwung, Kopfball, Grätsche.
  - `lab/` zeichnet sie mit fester Kamera.
  - `scripts/lab/compare.mjs` erzeugt die Bilder mit dem Renderer vor R5 (Commit `1b262f6`) und danach, `side-by-side.py` setzt sie nebeneinander: `docs/phase-b-rest/lab-0*.jpg`.
- **Darstellung:** Die schmale Ansicht ist geprüft. Desktop- und Schmal-Screenshots des Endstands liegen in `docs/phase-b-rest/`.

#### R6 Szenariomodus – **nicht umgesetzt, eigener Folgepunkt**
Bewusst nicht begonnen: P0–P2 haben die verfügbare Zeit gebraucht, und ein halb integrierter Modus würde die fortlaufende Partie gefährden. Der Weg ist vorbereitet: `stageScenario` (bisher nur in Tests), aufgezeichnete Zustände (`record-scenes`) und die Zustandstests der Standards. Ein Szenario müsste als eigener Startpunkt mit eigener Engine laufen und dürfte nie als Matchereignis erscheinen (§10.2).

#### R7 Abschluss – Prüfungen auf dem Endstand

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | `tsc` fehlerfrei, **26 Testdateien / 142 Tests bestanden** (3 Dateien übersprungen: Langsimulation, Schusslabor, Szenenaufzeichnung – nur über eigene Befehle), Build erfolgreich |
| Browser Desktop 1600 × 900, Seed 7, 2 × 15 min | `ok`, 0 Fehler, 0 Warnungen; **14 Momente in 10 Arten** (Strafraumgefahr, Durchsetzen, Konter, **Eckenverteidigung**, Ecke, Halbzeitansprache, Gegenpressing, Einwurf, **Wechsel**, Durchbruch), jedes Mal eingefroren und per Taste als `user` entschieden, kein Beteiligter verdeckt oder außerhalb des Bildes, keine Scrollleiste; FPS live 60 / verdichtet 60 |
| Browser schmal 800 × 900 | `ok`; nach der Framing-Korrektur 0 verdeckte und 0 abgeschnittene Beteiligte (vorher 1 verdeckter Spieler bei Strafraumgefahr); FPS live 45 / verdichtet 60 |
| Produktions-Build, volle Partie 2 × 45 min | Abpfiff, 13 Momente, 0 Fehler/Warnungen; **14:04 min Nutzerzeit**, 11:40 min Rechenzeit, 2,16 ms/Tick; FPS live 50 / verdichtet 60 |
| Schusslabor Phase B gegen Endstand | identisch (8/12/16/20/25 m: 92/92/92/85/92 % gehalten, gleiche Fänge) |
| Orchestrator-, Einwurf-, Eckball- und Kameratests | alle grün; angepasst wurden nur Erwartungen, die normales Spiel nach dem Standard ausschlossen (§ R3) |

Screenshots: `docs/phase-b-rest/` – Vergleichsbilder aus dem Labor (`lab-0*`), Desktop-Momente (Eckenverteidigung vor/Fokus/nach, Ecke, Halbzeit, Einwurf, Wechsel vor/nach, Durchbruch, Verdichtung), schmale Ansicht.

**Status je Punkt**

| Punkt | Implementiert | Getestet | Gemessen | Offen |
| --- | --- | --- | --- | --- |
| P0 Leistung | ja | Bit-Identität, Physik-Gleichwertigkeit, Statistik | Node −54 %, Browser 24:25 → 14:04 min | **10-min-Ziel für 2 × 45 nicht erreicht** (Engpass Rechenzeit, siehe R1) |
| P1 Agenten-Kalibrierung | ja | Charaktertest | 48 Seeds | Tore 3,6/90, Fänge des Torwarts |
| P1 Wechsel, Elfmeter-Torwart, Mauer, Eckenverteidigung | ja | 9 + angepasste Tests | im Browser (Wechsel, Eckenverteidigung) | gegnerische Wechsel (die KI wechselt nicht), Torwart-Wahl beim Elfmeter nur als Sprungrichtung |
| P2 Beziehungen, Gedächtnis | ja | 3 Tests | – | Beziehungen nur über Pässe; keine Rivalitäten |
| P2 Grafik | ja | Framing-Tests | Labor-Vergleichsbilder, FPS | keine Gesichter, kein Motion-Capture |
| Szenariomodus | nein | – | – | eigener Folgepunkt |

## 11. Phase C – Produktabnahme und letzte Qualitätskorrekturen (22.10.2026)

**Ausgangslage:** `main` = `090aeb3` (PR #33 und #34 gemergt). Phase C läuft auf dem neuen Branch `claude/phase-c-abnahme` mit eigenem PR. Vorhandene Funktionen werden nicht neu gebaut. Kein Merge ohne Freigabe.

### 11.1 Arbeitsplan (Opus, 22.10.2026)

Abhängigkeiten: C2 vor C1 und C4, weil Spielzeit- und Bildmessungen auf dem endgültigen Spielinhalt laufen müssen. C3 vor C1, weil gegnerische Wechsel auch in der gemessenen Sitzung vorkommen sollen. C5 zuletzt.

- **C2 Fußballrealismus** (zuerst, längste Messkette):
  1. Statistik um Torentstehung (offenes Spiel / nach Ecke, Freistoß, Einwurf, Elfmeter, Abstoß), Schussentfernung der Tore, Schüsse aufs Tor, Paraden und Fänge nach Art (nach Schuss / sonst) erweitern.
  2. Ursache eingrenzen: dieselbe Messung (24 Seeds × 2 × 10 min) auf den Commits der Restarbeiten (`6211c5b` bit-identisch zu Phase B, `329853b` Mechaniken und Kalibrierung, `700fbb6` Teilschritte und Neuplanung, Endstand), danach Ablation des verdächtigen Schritts.
  3. Nur nachgewiesene Fehler oder Überbewertungen korrigieren; Abnahme mit 48 Seeds, Physiktests und Schusslabor. Keine Ergebnissteuerung.
- **C3 Gegnerische Wechsel:** Die KI des Gegners wechselt mit denselben Regeln (`MatchEngine.substitute`, Regel 3) aus Informationen, die vorliegen: Form aus echten Aktionen, Gelbe Karten, Spielstand und Spielzeit, Fähigkeitswerte der Bank. Keine Ermüdung. Tests für Auslöser, Grenzen und Ausführung.
- **C1 Kurzpartie 2 × 15 min:** Produktions-Build im echten Browser, mehrere Seeds, Entscheidungszeit 5–10 s (zufällig je Moment, aus dem Seed des Skripts), gemessen werden Nutzerzeit, Rechenzeit, Wartezeiten (Bild steht ohne Entscheidung), FPS und Verständlichkeit (Texte der Leiste, Konsequenzkarten). Vergleich mit einer vollen Partie 2 × 45 min. Die kurze Partie muss im Bild als verkürzte Spielzeit erkennbar sein; die volle Länge bleibt wählbar.
- **C4 Grafische und interaktive Endabnahme:** eigene Sichtprüfung der Aufnahmen aus dem Produktions-Build gegen `docs/phase-b-rest/` (Animationen, Kamera, Ballkontakte, Markierungen, Entscheidungsleiste, Konsequenzen); konkrete Fehler beheben; neue Bilder unter `docs/phase-c/`.
- **C5 Abschlusstests:** `npm run check`; Langsimulation, Schusslabor und Szenenaufzeichnung; Browser Desktop und schmal; Produktions-Build; mehrere vollständige Sitzungen; Reproduzierbarkeit mit und ohne Agentengedächtnis.

### 11.2 C2 Fußballrealismus – Ursachen gemessen, vier Fehler behoben

**Werkzeuge** (`engine/match-stats.ts`, `scripts/probe.mjs`, `SIM_TRACE=1`):
- Torentstehung (offenes Spiel oder Standard ohne Ballbesitzwechsel, höchstens 20 s vorher) und Entfernung der letzten Berührung vor dem Tor.
- Ausgang jedes getroffenen Schusses: Tor, gefangen, abgewehrt, geblockt, Mitspieler, Aus.
- Ballverluste je Zone (eigener Strafraum, eigenes Drittel, weiter vorn) mit Gegentor binnen 12 s.
- Einwurf-Ursache (letzte Berührung, eigenes oder gegnerisches Team).
- Aufzeichnung der 6 s vor jedem Tor (`SIM_TRACE=1`).

**1. Eingrenzung über die Commits der Restarbeiten** (je 24 Seeds × 2 × 10 min, gleiche Statistik):

| pro 90 min | Phase B (`6211c5b`, bit-identisch) | `329853b` | `700fbb6` | Endstand #34 |
| --- | --- | --- | --- | --- |
| Tore | 3,0 | 3,8 | 2,3 | 3,9 |
| Eigentore | 0,2 | 0,2 | 0,4 | 0,8 |
| Fänge des Torwarts | 5,8 | 3,4 | 4,7 | 3,8 |

Die Streuung der Tore je Seed beträgt 3–4 pro 90 min, der Standardfehler bei 24 Seeds also ±0,7–0,8. Bei gleicher Mechanik springen die Werte zwischen 2,3 und 3,9. **Eine Erhöhung der Torquote durch die Restarbeiten ist nicht nachweisbar.** Über alle 96 Seeds liegt sie bei 3,25 ± 0,38 (Bundesliga 2023/24: ≈ 3,2 pro Spiel). Die Fänge sinken in allen drei Ständen nach Phase B; das Schusslabor ist identisch (92/92/92/85/92 % gehalten). Ursache ist also, welche Bälle zum Torwart kommen, nicht seine Physik.

**2. Wie die Tore entstehen** (Aufzeichnung, Seeds 1–12, dann 25–60):
- Die meisten Tore folgen einem Ballverlust nahe dem eigenen Tor. Ballverluste im eigenen Strafraum: 26,8 pro 90 min, 5,6 % davon enden binnen 12 s im Gegentor. Das Modell der Spieler rechnet dort mit ≈ 10 %; es unterschätzt die Gefahr also nicht. Deshalb nicht verändert.
- **Eigentore** (0,4–0,8 pro 90 min, real ≈ 0,1; 7 von 60 Seeds): alle um den eigenen Torwart.
  - Ein Innenverteidiger nahm seinem eigenen Torwart den Ball vom Fuß oder stand beim Abspiel auf dem Ball.
  - Ein langsamer Ball lag zwischen Torwart und Tor; der Torwart lief ihm hinterher, um ihn aufzunehmen, und schob ihn dabei mit dem Körper über die Linie (Seed 49: 3 s lang mit 1,5 m/s).
  - Ein am Boden gefangener Ball wurde nach einem Hechtsprung in den Rasen gedrückt; beim Ablegen schoss ihn der Rasen mit 16,6 m/s aus den Händen ins Tor (Seed 41).

**3. Behobene Fehler** (keine Kalibrierung, sondern falsches Verhalten bzw. falsche Physik):
- **Kein Mitspieler geht an einen Ball, den ein näherer Mitspieler am Fuß hat** (≤ 1 m, Ball < 4 m/s; `brain.ts`, `mateInControl`). Vorher hob der Vorrang „ich bin schon unterwegs“ (0,25 s) diese Lage auf; eine solche Prüfung gab es nur für Gegner.
- **Torwart nimmt einen langsamen Ball zwischen sich und dem eigenen Tor nicht auf, sondern spielt ihn mit dem Fuß** (`keeper.ts`). Test: 8 nachgestellte Lagen, ohne Korrektur 8 Eigentore, mit Korrektur 0.
- **Ein gehaltener Ball bleibt über dem Rasen** (`hands.ts`: die Hände bleiben so hoch, dass der Ball am Haltepunkt nicht in den Boden reicht). Test: ohne Korrektur liegt der Ball bei y = −0,105 m, mit Korrektur über dem Rasen.
- **Regel 12:** Ein absichtlich zugespielter Ball darf auch dann nicht aufgenommen werden, wenn der Torwart ihn vorher selbst mit dem Fuß gestoppt hat (`referee.ts`, `backPassAgainst`; vorher reichte die eigene Berührung zur Freigabe). Test im Schiedsrichtertest.

**4. Abnahme** (gleiche 60 Seeds × 2 × 10 min vorher und nachher, pro 90 min):

| | vorher (Endstand #34) | nur Mitspieler-Regel | **alle Korrekturen** | real |
| --- | --- | --- | --- | --- |
| Tore (± Standardfehler) | 3,8 (± 0,45) | 2,4 | **2,4 (± 0,42)** | ≈ 2,7 (Bundesliga ≈ 3,2) |
| Eigentore (Anzahl in 60 Seeds) | 7 | 4 | **3** (davon 2 Abfälschungen) | ≈ 0,1/Spiel |
| Torschüsse | 20,3 | 15,4 | **16,3** | ≈ 25 |
| Pässe / Passquote | 1340 / 77 % | 1399 / 76 % | **1405 / 76 %** | ≈ 1000 / 75–85 % |
| Ballbesitzwechsel | 1255 | 1250 | **1244** | – |
| Fouls | 25,7 | 26,8 | **26,2** | ≈ 22 |
| Einwürfe | 61,6 | 49,6 | **50,4** | ≈ 45 |
| Ecken | 8,4 | 6,1 | **6,0** | ≈ 10 |
| Fänge des Torwarts | 3,9 | 5,0 | **5,0** | – |

Schusslabor nach allen Korrekturen unverändert (8/12/16/20/25 m: 92/92/92/85/92 % gehalten, Fänge 46/40/25/25/29 von 55).

**Bewertung:** Tore, Eigentore, Einwürfe und Fänge liegen näher an der Realität, Ballbesitzwechsel und Fouls bleiben gleich. Torschüsse und Ecken entfernen sich weiter vom realen Wert, die Passzahl steigt. Wahrscheinliche Ursache (nicht einzeln gemessen): Ein Teil der Schüsse und Ecken entstand aus dem Gedränge zweier Mitspieler am selben Ball. Die Regel bleibt, weil sie falsches Verhalten beseitigt und keine Kennzahl steuert. Die Schusszahl ist der nächste Kalibrierkandidat (siehe Offen).

**Torarten:** 31 von 32 Toren nach allen Korrekturen fielen aus dem offenen Spiel, 1 nach einer Ecke (real ≈ 25–30 % aus Standards). Hauptursache sind die wenigen Standards selbst (6 Ecken, 0,15 Elfmeter pro 90 min, 2 Elfmeter in 60 Seeds; real ≈ 10 und 0,3). Nicht verändert: Eine Kalibrierung der Flanken und Kopfbälle wäre ein eigener Schritt.

**Flache Bälle auf den Torwart (Beobachtung, nicht verändert):** Ein flacher Schuss mit 18 m/s direkt auf ihn trifft meist den Körper statt der Hände (von 24 nachgestellten fing er 4), weil er nach dem Punkt greift, an dem der Ball seine eigene Position kreuzt. Die Abwehrquote ist davon nicht betroffen (Schusslabor 85–92 %, eher über dem realen Wert); eine Änderung wäre Kalibrierung ohne nachgewiesenen Fehler.

### 11.3 C3 Gegnerische Wechsel – implementiert, getestet

- `ai/bench-manager.ts`: Der Trainer des Teams, das der Mensch nicht steuert, prüft jede Spielunterbrechung einmal (`RestartState.benchSeen`), sobald der Ball liegt. Er wechselt über dieselbe Regel-3-Funktion wie der Mensch (`MatchEngine.substitute`; höchstens 5 Wechsel, 3 Gelegenheiten plus Halbzeit, nur bei ruhendem Ball). Höchstens zwei Wechsel je Unterbrechung.
- Gründe, nur aus Informationen der Partie (es gibt kein Ermüdungsmodell, also auch keine behauptete Müdigkeit):
  - **Torwart vom Platz:** Der Ersatztorwart geht für den vordersten Feldspieler ins Tor, auch in der ersten Halbzeit (`substitute(off, on, 'GK')`).
  - **Form:** ab der Halbzeitpause oder ab der Mitte der zweiten Halbzeit, wenn das Selbstvertrauen mindestens 0,15 unter dem neutralen Wert liegt und mindestens 3 der letzten 6 bewerteten Aktionen misslangen.
  - **Gelbbelasteter Verteidiger:** zur gleichen Zeit, durch einen Spieler derselben Linie.
  - **Rückstand** ab 55 % der zweiten Halbzeit: der formschwächste Mittelfeldspieler für den abschlussstärksten Stürmer der Bank.
  - **Führung** ab 70 %: der formschwächste Stürmer für den zweikampfstärksten Nicht-Stürmer der Bank.
- Deterministisch: keine Zufallszahl, gleiche Partie → gleiche Wechsel. Der Kommentar nennt den Grund („… kommt für … – mehr Offensive im Rückstand“).
- In der App wechselt der Gegner des Nutzerteams so (`runner.ts`, `benchCoach: [1]`); das Nutzerteam wechselt nur durch die Entscheidung des Menschen.
- Tests (`ai/bench-manager.test.ts`, 4): Rückstand → Stürmer für Mittelfeldspieler, spielt danach; Führung → defensiver Wechsel, Unentschieden → keiner von beiden; Rote Karte für den Torwart → Ersatztorwart läuft ins Tor; ganze Partie → nur bei ruhendem Ball, nur das eigene Team, höchstens 5, keine Rückkehr, bei Wiederholung identisch.
- **Nachtrag aus den Browsersitzungen (§11.4):** Der Gegner wechselte dort dreimal binnen zwei Spielminuten wegen Form. Seitdem höchstens ein Formwechsel je Unterbrechung und mindestens 10 % einer Halbzeit zwischen zwei Wechselgelegenheiten (außer Ersatztorwart); im Test geprüft. Die vier Sitzungen in §11.4 liefen vor dieser Korrektur; danach zeigten Desktop-, Schmal- und Gedächtnislauf 2, 1 und 3 gegnerische Wechsel (2 × 5: Formwechsel in der 7. und 8. Minute, Offensivwechsel bei Rückstand in der 8.).
- Für die Dateigrenze ausgelagert, Partie bit-identisch (Seeds 1–2 gleiche Ereignisse): `engine/substitutions.ts`, `engine/snapshot.ts` aus `match-engine.ts` zusammen mit dem Verlassen und Betreten des Platzes und `clampSpot` (624 → 517 Zeilen), `ai/ball-reach.ts` aus `brain.ts` (540 → 492).

### 11.4 C1 Spielzeit und Benutzererfahrung – gemessen, Ziel erreicht

**Kennzeichnung der Länge** (`ui/match-length.ts`):
- Startbildschirm: „Kurzpartie · 2 × 15 min statt 2 × 45“ mit gemessener Dauer.
- Anzeigetafel: gelbes Feld „2×15“, bei voller Spielzeit grau „2×45“.
- Ergebnis: „Abpfiff · Kurzpartie · 2 × 15 min statt 2 × 45“.

Die Uhr zeigt die echte simulierte Zeit (0–30 min). Die volle Spielzeit bleibt wählbar.

**Messverfahren** (`CHECK_SESSION=1 npm run test:browser`, Produktions-Build über `vite preview`, Chrome headless, Intel Iris Xe, 1600 × 900):
- Das Skript spielt wie ein Mensch. Jede Entscheidung fällt nach einer Bedenkzeit von 5–10 s, je Moment aus dem Seed des Skripts gezogen.
- In 80 % der Fälle wählt es eine Option per Taste, in 20 % überlässt es die Wahl den Spielern.
- Gemessen werden:
  - Nutzerzeit (Wanduhr), Rechenzeit des Workers und simulierte Zeit,
  - die Zeit in Live-Bild, Verdichtung und Entscheidung,
  - Stillstand (das Bild steht ohne offene Entscheidung),
  - FPS-Stichproben,
  - alle Texte von Leiste und Konsequenzkarte.
- Die Einstellungen sind die der App für die jeweilige Länge, keine Testparameter.

| Sitzung | Nutzerzeit | Rechenzeit | Momente (Arten) | Bedenkzeit gesamt | live / verdichtet / Entscheidung | Stillstand | FPS live / verdichtet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 × 15, Seed 7 | **6:30** | 2:11 | 13 (7) | 104 s | 117 / 70 / 107 s | 0 s | 60 / 60 |
| 2 × 15, Seed 11 | **7:10** | 3:45 | 12 (8, u. a. Elfmeter, Eckenverteidigung) | 84 s | 117 / 129 / 87 s | 0 s | 58 / 60 |
| 2 × 15, Seed 23 | **7:22** | 3:56 | 12 (8) | 93 s | 104 / 126 / 97 s | 0 s | 56 / 60 |
| 2 × 5, Seed 11, mit Gedächtnis | **4:15** | 1:27 | 9 | 69 s | 83 / 30 / 69 s | 0 s | 61 / 60 |
| **2 × 45, Seed 7** | **15:34** | 12:05 | 13 (8) | 98 s | 173 / 456 / 102 s | 0 s | 59 / 60 |

Alle Sitzungen erreichten den Abpfiff ohne Konsolenfehler oder Warnungen. Jede Wahl wurde als `user` bzw. `delegated` protokolliert. Während der 2 × 45-Messung lief etwa eine Minute lang ein Unit-Test parallel; der Wert ist dadurch höchstens leicht erhöht.

**Bewertung:**
- **Der interaktive 5–10-Minuten-Modus ist 2 × 15 min:**
  - 6:30–7:22 Nutzerzeit bei 12–13 Entscheidungen, also etwa alle 35 s eine Entscheidung.
  - Etwa ein Viertel der Zeit ist eigene Bedenkzeit, der Rest Spiel.
  - Die Partie ist kein 90-Minuten-Spiel und wird auch nicht so dargestellt.
- **Volle Partie zum Vergleich:** 15:34 min, ebenfalls 13 Momente (die Abklingzeit skaliert für 2 × 45), also deutlich weniger Entscheidungen je Minute. Begrenzend bleibt die Rechenzeit (§10.10 R1).
- **Wartezeiten:** In keiner Sitzung stand das Bild ohne Entscheidung still (0 s). Die Verdichtung (×4–×24) überbrückt ruhige Phasen, die letzten 5 s vor jedem Moment laufen in Echtzeit.
- **FPS:** 56–61 live und 60 verdichtet in den Stichproben während der Sitzung. Die erste Messung direkt nach dem Anpfiff lag in einer Sitzung bei 40–43 FPS (Aufwärmen von Shadern und Worker), danach nicht mehr.
- **Verständlichkeit** (eigene Durchsicht aller 10–13 Leisten- und Konsequenztexte je Sitzung und der Aufnahmen):
  - Jede Leiste nennt die Lage, den Akteur mit Form und Charakter, die Optionen mit erwarteter Folge und die Tendenz der Spieler.
  - Jede Konsequenzkarte nennt nur beobachtete Ereignisse in Reihenfolge, z. B. „Doyle (7) wirft ein. Adeyemi (10) (Gegner) ist am Ball. Ball bei Hale (8). Danach ging es ohne klares Ergebnis weiter.“
  - Gefunden und behoben: Der Tastenhinweis lautete immer „1–4 wählen“, auch bei zwei oder drei Optionen.

### 11.5 C4 Grafische und interaktive Endabnahme – geprüft, drei Fehler behoben

Geprüft habe ich selbst die Aufnahmen aller Sitzungen (je Moment vor der Entscheidung und nach der Konsequenz, dazu das Ergebnis) und die Prüfläufe Desktop und schmal, verglichen mit `docs/phase-b-rest/`. Spieleranimationen, Ballkontakte, Konsequenzkarten und Ergebnisseite entsprechen dem Stand der Restarbeiten.

Behoben:
1. **Optionsnummern verdeckten Spieler:**
   - Bei naher Entscheidungskamera (Einwurf) füllte die Nummer „1“ ein Fünftel des Bildes und hing vor dem Kopf des Empfängers (`docs/phase-c/04-…`).
   - Jetzt hält sie eine feste Bildgröße (`tactical-overlay.ts`, unter 30 m Abstand verkleinert) und schwebt über dem Kopf.
2. **Schmale Ansicht – Beteiligte unter der Leiste:**
   - Im Prüflauf 800 × 900 verdeckte die Leiste bei der Freistoßmauer zwei Spieler und die Option „4“, bei der Halbzeitansprache einen Spieler.
   - Ursache in `framing.ts`: Die Kamera richtete die Mitte der Szene auf die Bildmitte. Der freie Bereich liegt aber oben (am Desktop links).
   - Jetzt zielt sie so, dass die Szene in der Mitte des freien Bereichs liegt, mit demselben `lookAt` wie die App.
   - Danach: 0 verdeckte Beteiligte auf beiden Formaten. Die Tests in `framing.test.ts` sind unverändert grün.
3. **Tastenhinweis** (siehe C1).

**Abschlussläufe** (Produktions-Build, Seed 7):

| Lauf | Ergebnis |
| --- | --- |
| Desktop 1600 × 900, 2 × 15 | `ok`, 0 Fehler/Warnungen; 10 Momente in 7 Arten (Strafraumgefahr, Gegenpressing, Durchbruch, Ecke, Halbzeitansprache, Wechsel, Durchsetzen), jedes Mal eingefroren und als `user` entschieden; **0 verdeckte, 0 abgeschnittene Beteiligte**; FPS 53 live / 60 verdichtet |
| Schmal 800 × 900, 2 × 5 | `ok`; 6 Momente in 6 Arten (u. a. Freistoßmauer, Halbzeitansprache, Wechsel); **0 verdeckte, 0 abgeschnittene Beteiligte** (vor der Korrektur 2 Momente mit verdeckten Spielern); FPS 43 live / 60 verdichtet |

Vergleichsbilder aus dem Produktions-Build liegen in `docs/phase-c/`:
- Startbildschirm mit Längenangabe und Anzeigetafel „2×15“,
- Elfmeter,
- Einwurf vor der Korrektur der Nummern, Ecke nach der Korrektur,
- schmale Ansicht Mauer und Halbzeit nach der Korrektur,
- Figuren nah,
- Ergebnis 2 × 15 und 2 × 45.

### 11.6 C5 Abschlusstests

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | `tsc` fehlerfrei, **27 Testdateien / 151 Tests bestanden** (3 Dateien nur über eigene Befehle, unten), Build erfolgreich |
| `npm run sim` (2 × 45 min, Seed 2026) | Abpfiff regulär, 0:2, 23 Torschüsse, 0 Eigentore, Passquote 76 %, 1,99 ms/Tick (Node) |
| `npm run lab` (Schusslabor) | 8/12/16/20/25 m: 92/92/92/85/92 % gehalten, Fänge 46/40/25/25/29 von 55 – identisch mit Phase B und den Restarbeiten |
| `RECORD_SCENES=1` (Szenenaufzeichnung) | bestanden; `lab/scenes.json` bewusst nicht ersetzt, damit die Vergleichsbilder der Restarbeiten reproduzierbar bleiben |
| Mehr-Seed-Probe | 60 Seeds vorher und nachher (§11.2) |
| Browser Desktop, schmal, Produktions-Build | §11.5 |
| Vollständige Sitzungen | 4 Kurzpartien und 1 volle Partie bis zum Abpfiff (§11.4) |
| Reproduzierbarkeit ohne und mit Gedächtnis | Test `agent-memory.test.ts`: dieselbe Partie ohne Gedächtnis zweimal identisch; mit gespeichertem (als JSON geschriebenem und gelesenem) Gedächtnis zweimal identisch; das Gedächtnis verändert den Verlauf. Im Browser lief eine Sitzung mit eingeschaltetem Gedächtnis fehlerfrei (§11.4). |

### 11.7 Status je Punkt

| Punkt | Implementiert | Getestet | Gemessen | Offen |
| --- | --- | --- | --- | --- |
| C1 Spielzeit und Benutzererfahrung | Längenkennzeichnung, Sitzungsmodus im Prüfskript | Browser (5 Sitzungen) | 2 × 15: 6:30–7:22 min, 2 × 45: 15:34 min, 0 s Stillstand, FPS | 2 × 45 bleibt bei ≈ 15 min (Rechenzeit) |
| C2 Fußballrealismus | 4 Fehlerkorrekturen (Mitspieler, Torwart ×2, Regel 12), erweiterte Statistik | 3 neue Tests, jeweils geprüft, dass sie ohne die Korrektur fehlschlagen | 4 Commits × 24 Seeds, 60 Seeds vorher/nachher, Schusslabor | Torschüsse 16/90 (real ≈ 25), Ecken 6/90, kaum Standardtore, Passzahl ≈ 1400/90 |
| C3 Gegnerische Wechsel | ja | 4 Tests | in jeder Browserpartie 1–4 Wechsel des Gegners (siehe §11.3, Nachtrag) | keine Wechsel wegen Verletzung (es gibt keine Verletzungen), keine taktische Systemänderung |
| C4 Grafische Endabnahme | 3 Korrekturen | Framing-Tests, Browser Desktop und schmal | 0 verdeckte Beteiligte, FPS | keine Gesichter, kein Motion-Capture (wie §10.10) |
| C5 Abschlusstests | – | alle oben | – | – |
| Szenariomodus | nein | – | – | weiterhin eigener Folgepunkt (§10.10 R6) |

**Nicht als Erfolg gewertet:** Grüne Unit-Tests allein. Alle Aussagen zu Spielzeit, Verständlichkeit und Darstellung stammen aus den Browsersitzungen und den Aufnahmen, die Statistik aus Mehr-Seed-Läufen.
