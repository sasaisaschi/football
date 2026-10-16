# THE 12TH MAN – Technical Report & Development Guide

**Status:** Neuaufbau seit 16.10.2026 auf Branch `claude/12th-man-rebuild` (abgezweigt vom bereinigten `main` nach PR #3).
**Rolle dieses Dokuments:** verbindliche Source of Truth für Architektur, tatsächlichen Stand, Versionen, Tests und nächste Schritte.
**Kennzeichnung:** **Implementiert** = Code vorhanden · **Getestet** = durch tatsächlich ausgeführte Tests belegt · **Geplant** = noch nicht vorhanden · **Nicht geprüft** = vorhanden, aber ohne Nachweis.

## 1. Produktauftrag (aus README.md)

Elf gegen elf spielen eigenständig Fußball. Ein **Decisive Moment Director** erkennt seltene Situationen, in denen eine Entscheidung des Benutzers den Verlauf spürbar verbessern oder verschlechtern kann, und bietet nur tatsächlich ausführbare Optionen an. Die Entscheidung ändert Handlungsmöglichkeiten, nicht das Ergebnis: Spielerkörper, Fußkontakt, Ballphysik, Gegner und Schiedsrichter bestimmen, was passiert. Keine geskripteten Szenen, keine Teleports, keine garantierten Erfolge. Zwischen den Momenten bleibt der Spielzustand zusammenhängend; Leerlauf darf verdichtet (schneller abgespielt), aber nicht erfunden werden.

Die frühere Implementierung (PR #1/#2) ist nur Git-Historie und **keine Vorlage**; es wurde kein Code übernommen.

## 2. Tech Stack (tatsächlich installiert, 16.10.2026)

Geprüft per `npm view <paket> version engines peerDependencies` gegen Node 24.20.0 / npm 11.19.0 (Systeminstallation unverändert, nur lokale Abhängigkeiten).

| Paket | Version | Zweck | Kompatibilität |
| --- | --- | --- | --- |
| `three` | 0.186.1 | Rendering | keine Engine-Vorgabe |
| `@dimforge/rapier3d-simd-compat` | 0.21.0 | Physik (WASM mit SIMD, inline) | WASM-SIMD: Chrome/Edge ≥ 91, Firefox ≥ 89, Safari ≥ 16.4 – alle aktuellen Zielbrowser |
| `typescript` | 7.0.2 | Typprüfung (`tsc --noEmit`) | node ≥ 16.20 |
| `vite` | 8.3.4 | Dev-Server, Build (Rolldown) | node ^20.19 ∥ ≥ 22.12 |
| `vitest` | 5.0.5 | Tests | node ^22.12 ∥ ^24; peer vite ^6–^8 ✔ |
| `@types/three` | 0.186.0 | Typen | passend zu three 0.186 |
| `@types/node` | 24.19.2 | Typen für Tests/Skripte | Node-24-Linie (26.x bewusst nicht gewählt) |

Kein React/Framework: Die Oberfläche besteht aus wenigen DOM-Panels über einem WebGL-Canvas; ein Framework bringt dafür keinen technischen Nutzen.

## 3. Architektur

```text
src/
  engine/     A  Authoritative Match Engine – Zustand, Ablauf, Ereignisse, Snapshots (headless)
  physics/    B  Physical World – Rapier-Welt, Feld, Ball, Körper, Schuhe, Torwarthände, Kontakte
  ai/         C  Autonomous Football Intelligence – Wahrnehmung, Mannschaftsform, Entscheidungen
  rules/      D  Rules & Referee – Tor, Aus, Abseits, Fouls, Karten, Spielfortsetzungen
  director/   E  Decisive Moment Director – Erkennung, Bewertung, ausführbare Optionen
  ui/         F  User Decision Interface + Broadcast-UI (DOM, CSS neben der TS-Datei)
  render/     G  Broadcast Experience – Stadion, Spieler, Kamera (Three.js)
  audio/      G  Stadionton aus echten Ereignissen (Web Audio)
  styles/     design_variables.css – Design-Tokens
```

**Verbindliche Regeln der Architektur**
1. **Single writer:** Nur `engine` + `physics` ändern Körper- und Ballzustand. Alle anderen Schichten lesen `MatchSnapshot` oder liefern Absichten (`PlayerIntent`, `TeamInstruction`).
2. **Ball ohne Abkürzung:** Im laufenden Spiel bewegt sich der Ball nur durch Rapier-Kontakte, Schwerkraft, Luftwiderstand, Magnus-Kraft und Rollwiderstand. Der Schiedsrichter darf einen **toten** Ball zur Spielfortsetzung platzieren.
3. **Absicht ≠ Ergebnis:** KI und Benutzer erzeugen dieselben `PlayerIntent`-Objekte; die Ausführung läuft über Körperbewegung und Schuhkontakt.
4. **Fester Zeitschritt:** Physik 1/60 s; bei schnellen Schwüngen Teilschritte (Begründung folgt in Phase 2). Darstellung interpoliert und ist bildratenunabhängig.
5. **Reproduzierbar:** Jede Zufallsentscheidung nutzt den seedbaren Generator `engine/rng.ts`.
6. **Keine erfundenen Ereignisse:** Kamera, Ton, Kommentar reagieren nur auf `MatchEvent`s.

**Schnittstellen:** `src/engine/types.ts` definiert `PlayerProfile`, `PlayerIntent`/`BallAction`/`MovementAction`, `TeamInstruction`, `MatchEvent`, `DecisionMoment`/`DecisionOption` und `MatchSnapshot`.

## 4. Features & Status

| Bereich | Status |
| --- | --- |
| Projektfundament, Verträge, IFAB-Geometrie, Seed-Zufall | Implementiert, getestet (Phase 1) |
| Physikwelt, 22 Körper, Fußkontakte | Implementiert, getestet (Phase 2) |
| Autonomer Fußball, Regeln, Torhüter | Geplant (Phase 3) |
| Decisive Moment Director, Entscheidungen | Geplant (Phase 4) |
| Stadion, Kamera, UI, Ton | Geplant (Phase 5) |

## 5. Testing Status

| Datum | Befehl | Ergebnis |
| --- | --- | --- |
| 16.10.2026 | `npm install` (exakte Zielversionen) | 0 Vulnerabilities, `npm ls` bestätigt Versionen |
| 16.10.2026 | `npm run check` | siehe Phasenprotokoll unten |

## 6. Phasenprotokoll

### Phase 1 – Fundament (16.10.2026)
- Neues `package.json` (Skripte `dev`, `typecheck`, `test`, `build`, `check`, `test:browser`), `package-lock.json`, `tsconfig.json` (strict, `verbatimModuleSyntax`), `vite.config.ts` mit Vitest-Konfiguration, `index.html`, `.gitignore`.
- Verträge in `src/engine/types.ts`, IFAB-Geometrie in `src/physics/pitch-geometry.ts`, Seed-Zufall in `src/engine/rng.ts`, Design-Tokens in `src/styles/design_variables.css` (neu angelegt; Änderungen daran künftig nur nach Abstimmung).
- Tests: Feldmaße, Tor-/Aus-Regeln, Seitenwechsel, Strafraum, Reproduzierbarkeit des Zufalls.

### Phase 2 – Physikalische Fußballwelt (16.10.2026)
- `physics/world.ts`: eine Rapier-Welt je Partie, fester Schritt 1/60 s. **Teilschritte nur während schneller Schwünge** (Schuh ≤ 6 cm pro Teilschritt, max. 8), weil Rapiers CCD kinematische Körper nicht überstreicht – ohne Teilschritte landet ein 18-m/s-Schuh innerhalb eines Schritts im Ball (Befund aus der früheren Messung, hier neu umgesetzt und durch Tests abgesichert). Kontakte werden klassifiziert (Ball–Schuh/Körper/Hände, Körper–Körper mit Annäherungsgeschwindigkeit *vor* dem Aufprall für die Foulbewertung).
- `physics/ball.ts`: Ball nach Regel 2; Luftwiderstand mit Drag-Crisis (Cd 0,45 → 0,25 zwischen 9 und 14 m/s), Magnus-Kraft (C_L = 1/(2 + 1/S)), Rollwiderstand μ_r = 0,065; Kräfte werden jeden Tick zurückgesetzt (Rapier hält `addForce` sonst dauerhaft).
- `physics/pitch-colliders.ts`: Rasen, Pfosten und Latte auf der Torlinie, weiche Netze, Werbebanden am Rand des Auslaufs.
- `physics/body.ts`: Torso als aufrechte Kapsel mit expliziter Blickrichtung; Beschleunigung fällt zur Höchstgeschwindigkeit hin ab, begrenztes Bremsen, begrenzte Querbeschleunigung, geschwindigkeitsabhängige Drehrate; Grenzen aus Fähigkeiten (8,0–9,9 m/s Spitze).
- `physics/legs.ts`: zwei kinematische Schuhe; Schwung (Ausholen, Schlag mit konstanter Geschwindigkeit durch den Ball, Durchschwung, Rückführung) gegen die vorhergesagte Ballposition; nur bei erreichbarem Treffpunkt (Beinlänge 0,53 × Körpergröße) und passender Ausrichtung. Abflugwinkel nur über Treffpunkt unterhalb der Ballmitte (≤ 0,45 rad). Ausführungsfehler verschieben die Schuhbahn.
- `engine/rosters.ts`: zwei fiktive Vereine, 4-3-3, seedbare Fähigkeiten.
- **Tests (22, alle bestanden):** Aufprall 2 m → 0,5–0,9 m, Rollweg aus 8 m/s 15–25 m (Rollwiderstand + Luftwiderstand nachgerechnet), keine Kraftakkumulation, Magnus-Kurve in Richtung ω × v, Netz fängt, Pfosten/Latte prallen ab, Beschleunigungs-/Bremsgrenzen, 22 kollidierende Körper 30 s stabil, bitgleiche Wiederholung, Fußkontakt: Nähe kickt nie, Pass ±10 % Richtung/Tempo, Spannstoß > 22 m/s mit Lift, Richtungsabhängigkeit, Fehltreffer mit Ablenkung und Drall, Luftloch, unerreichbarer Ball, Ballannahme.

## 7. Bekannte Grenzen / offene Punkte
- Noch keine spielbare Anwendung (bis Phase 3).
- Kinematischer Schuh mit unbegrenzter Masse: Ball ≈ 1,45 × Schuhgeschwindigkeit (real eher 1,2–1,35); Schwunggeschwindigkeiten sind darauf abgestimmt.
- Volleys über Hüfthöhe und Kopfbälle sind noch nicht modelliert (Planung lehnt sie ab).
- Ballkoeffizienten sind Literaturwerte, keine eigene Messreihe.

## 8. Nächste Schritte
Phase 3: Match Engine (Ablauf, Halbzeiten, Spielfortsetzungen), Torwarthände, Wahrnehmung und Entscheidungen der 22 Spieler, Schiedsrichter mit Abseits und Fouls.
