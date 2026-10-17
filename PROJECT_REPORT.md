# THE 12TH MAN – Technical Report & Development Guide

**Stand:** 17.10.2026 · Branch `claude/12th-man-rebuild` (vom bereinigten `main` nach PR #3, ohne übernommenen Altcode).
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

**Testinhalte:** Feldmaße/Regel 9/10, Zufall reproduzierbar; Ballaufprall, Rollweg, keine Kraftakkumulation, Magnus-Richtung, Netz/Pfosten/Latte; Beschleunigungsgrenzen, 22 Körper stabil, bitgleiche Wiederholung; Fußkontakt (Nähe kickt nie, Richtung/Tempo, Spannstoß mit Lift, Richtungsabhängigkeit, Fehltreffer mit Drall, Luftloch, Reichweite, Ballannahme); Schiedsrichter (Abseits, Einwurf-Ausnahme, Seitenwechsel, Ecke/Abstoß/Einwurf/Tor/Eigentor, Foul von hinten, Zweikampf ≠ Foul, Notbremse = Rot + Elfmeter, taktisches Foul = Gelb, Gelb-Rot, Mitspieler-Kontakt, Handspiel außerhalb, Rückpass); vollständige Partie ohne ungültige Zustandsübergänge, gleicher Seed = gleiche Partie, kein kollektives Ballverfolgen, Torwart-Ergebnisse variieren, Ballfreigabe innerhalb von 6 s; Director (Moment friert ein, jede angebotene Option wird als echter Schwung ausgeführt, gleiche Lage + andere Entscheidung → anderer Verlauf, gleiche Entscheidung → unterschiedlicher Erfolg, Momente selten und mit Abstand); Quelltext „kein Magnetismus“.

## 6. Messwerte

**Fußkontakt:** Rapier-CCD überstreicht kinematische Körper nicht; ohne Teilschritte springt ein 18-m/s-Schuh in den Ball. Daher Teilschritte während Ausholen/Schlag (≤ 6 cm pro Teilschritt). Kinematischer Schuh ⇒ Ball ≈ 1,45 × Schuhgeschwindigkeit (real eher 1,2–1,35).

**Kalibrierung Spielgeschehen** (Mittel aus 3 Seeds, je 2 × 5 min, hochgerechnet auf 90 min):

| | vor Korrekturen | nach Korrekturen | realer Richtwert |
| --- | --- | --- | --- |
| Fouls | ≈ 100 | ≈ 42 | ~22 |
| Ausbälle (Einwurf/Ecke/Abstoß) | ≈ 250 | ≈ 230 | ~75 |
| Torschüsse | – | ≈ 90 | ~25 |
| Tore | ≈ 15 (inkl. Eigentore durch Fehler) | ≈ 9 | ~2,7 |

Behobene Ursachen: Torwart nahm Rückpässe nicht mit dem Fuß an (Eigentore), Torwart konnte einen gefangenen Ball nie loslassen (Armreichweite) und wurde dann minutenlang „angeschossen“, Spieler sprinteten ungebremst in Gegner, Torwartwahrnehmung wurde nicht aktualisiert, Hechtsprung wurde sofort abgebremst, Schuhe fuhren beim Start über den Anstoßpunkt.

**Volle Partie (`npm run sim`, 2 × 45 min, Seed 2026, 17.10.2026, nach allen Korrekturen):** Partie läuft fehlerfrei bis Abpfiff; 632 s Rechenzeit (1,95 ms pro Physikschritt im Node-Test, parallel zu anderen Läufen).

| Messwert | Ergebnis | realer Richtwert |
| --- | --- | --- |
| Ergebnis | 1 : 8 | ~1,5 : 1,2 |
| Torschüsse | 59 / 26 | ~13 / 12 |
| Pässe / Passquote (nächster Kontakt durch Mitspieler) | 915 / 47 % | ~900 / ~80 % |
| Ballbesitz | 48 % / 52 % | – |
| Ball im Spiel | 79 % | ~60 % |
| Fouls / Gelb / Rot / Elfmeter | 26 / 2 / 0 / 1 | ~22 / ~4 / ~0,1 / ~0,3 |
| Abseits / Ecken / Einwürfe / Abstöße | 6 / 38 / 159 / 75 | ~4 / ~10 / ~45 / ~18 |
| Gefangene Bälle Torwart | 2 | mehrere |

Bewertung: Foulrate realistisch; Torschüsse, Tore, Ausbälle und Passquote sind deutlich unrealistisch. Die frühere 2 × 10-Minuten-Messung zeigte 75 % Passquote, die volle Partie 47 % – die Kennzahl schwankt stark zwischen Seeds und Spielständen und braucht eine Messreihe über mehrere Seeds.

## 7. Bekannte Grenzen / offene Punkte

- **Spielqualität noch nicht realistisch:** zu viele Schüsse, Tore und Ausbälle, Fouls ≈ doppelt so häufig wie real (siehe §6). Ursachen liegen v. a. in Passgenauigkeit bei hohem Tempo, Ballannahme unter Druck und Schussauswahl.
- Kinematischer Schuh mit unbegrenzter Masse; Volleys über Hüfthöhe und Kopfbälle nicht modelliert.
- Einwurf wird mit dem Fuß ausgeführt; Abseits nutzt Körpermittelpunkte und nur „spielt den Ball“ als Beteiligung; absichtliches Spiel und Abpraller werden nicht unterschieden.
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

## 9. Nächste Schritte

1. Spielqualität: Passgenauigkeit/Annahme unter Druck, Schussauswahl und Torwart-Positionierung verbessern, bis Schüsse/Tore/Ausbälle im realen Bereich liegen (Messung über `npm run sim` mit mehreren Seeds).
2. Echte Einwürfe (Hände) und Grätschen als physische Schuh-Bein-Kontakte inkl. Foulbewertung.
3. Director: weitere Momente (Freistoß-/Elfmeterentscheidung, Wechsel/Taktik zur Halbzeit), Wiederholung (Replay) eines Moments aus den Ereignisdaten.
4. Präsentation: Fangesänge/Kommentar mit lizenzfreien Quellen, Replay-Kamera, hochwertigere Spielermodelle.
5. Optionale KI-Rollen (Match Analyst, Pub Host) über Adapter; Physik und Spiel bleiben offline lauffähig.
