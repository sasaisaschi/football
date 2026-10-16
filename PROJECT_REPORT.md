# THE 12TH MAN – Technical Report & Development Guide

**Stand:** 16.10.2026  
**Repository:** `sasaisaschi/football` · Branch `main`  
**Rolle:** **Zentrale Source of Truth** für tatsächlichen Entwicklungsstand, bestätigte Entscheidungen, Regeln, offene Fragen und die Übergabe an nachfolgende Entwickler/KI-Modelle.  
**Statuskennzeichnung:** **Implementiert** = in eingesehenen Quelldateien vorhanden; **Teilweise** = funktionaler Ansatz mit Einschränkungen; **Geplant** = Ziel oder Entwurf; **Nicht geprüft** = ohne aktuelle Datei-/Laufzeitprüfung. Ein Codebefund ist kein bestandener Laufzeittest.

## 1. Project Overview

**Produkt:** THE 12TH MAN – eine emotional glaubwürdige, generationenübergreifende Fußball-Matchday-Erfahrung mit englischer Fußballkultur, authentischer Stadionatmosphäre, eigenständig handelnden Mannschaften, physikalisch entstehenden Spielergebnissen und Trainer-/Fanbeteiligung.

**Unverhandelbare Vision:** Ein Spielzug soll aus eigenständigen Entscheidungen, tatsächlichen Körper- und Ballkontakten und dem regelkonformen Spielzustand entstehen. Kamera, Publikum, Kommentar und Analyse reagieren auf reale Ereignisse. Keine geskripteten Tore oder nachträglich erfundenen Aktionen. Die ersten 30 Sekunden sollen sich wie ein großer Fußballabend anfühlen, nicht wie ein Physikdebugger.

**Ist-Zustand:** Browser-Prototyp mit vereinfachtem 3-gegen-3 auf 42 × 28 m, Ball- und Spielerkörpern in Rapier, einfacher Agentenlogik, Impuls-Kicks, Tore/Score, Kamera, Intro und HUD. **Nicht** gleichzusetzen mit dem Ziel eines überzeugenden 11-gegen-11-Spiels. Grundlage: `README.md`, `src/main.ts`, `src/stadium.ts`, `src/player-visuals.ts` (früher eingesehen; kein aktueller Laufzeittest).

**Dokumentenhierarchie:**
1. `PROJECT_REPORT.md`: verbindlicher Entwicklungsstand, Arbeitsregeln, Entscheidungen und Roadmap.
2. `VISION.md`: maßgeblicher emotionaler/gestalterischer Nordstern; darf nicht stillschweigend durch einen leichteren Prototyp ersetzt werden.
3. `ARCHITECTURE.md`: umfangreiche technische Recherche und Vorschläge; **Draft**, nicht pauschal freigegeben.
4. `public/data/TARGET_ARCHITECTURE.md`: formulierte Zielarchitektur zur Lösungsfindung, keine Implementierungsfreigabe.
5. `public/data/INDEX.md` und `HANDOFF.md`: Navigation und KI-Übergabe; die JSON-Dateien unterscheiden Anforderungen von Codebefunden.
6. **Originalcode und tatsächliche Tests** bestimmen, was implementiert und verifiziert ist. Bei Widersprüchen den Unterschied ausdrücklich protokollieren, nicht heimlich angleichen.

## 2. Tech Stack

| Bereich | Tatsächlicher Stand / Regel |
| --- | --- |
| Runtime | Browser, TypeScript, Vite; `src/main.ts` als aktueller Einstieg |
| Rendering | Three.js |
| Physik | `@dimforge/rapier3d-compat`; aktuell autoritative Ball-/Körperphysik |
| UI | Bestehende HTML/CSS-Oberfläche; Standardvorgabe für neue geeignete Komponenten React 19/TSX, Vite 8, klassisches CSS, Lucide – **kein** eigenmächtiger Stack-Umbau |
| Assets | Statische Dateien unter `public/`; einfacher `crowd-stand.svg`; optionale GLB-Modellpfade sind im Code, tatsächliche Binärdateien noch nicht vollständig geprüft |
| KI | Gegenwärtig einfache lokale Spielerheuristiken; Cloud-/Foundry-Agenten sind **geplant**, nicht als funktionierend bestätigt |
| Qualität | `npm run check` laut README/Projektdefinition vorgesehen; **in dieser Dokumentationsrunde nicht ausgeführt** |

**Koordinaten im aktuellen Code:** X = Spielfeldlänge, Y = Höhe, Z = Spielfeldbreite. `ARCHITECTURE.md` enthält eine abweichende **vorgeschlagene** Konvention. Bestehenden Code nicht ohne expliziten Migrationsplan umdeuten.

## 3. Architecture & Folder Structure

```text
football/
  PROJECT_REPORT.md       # zentrale Source of Truth
  VISION.md               # verbindliche Erlebnisvision
  ARCHITECTURE.md         # Forschungs-/Architekturentwurf
  README.md               # Start und tatsächlich vorhandene Funktionen
  package.json
  src/
    main.ts               # aktuelle Spielschleife, Physik, Agenten, UI-Anbindung
    stadium.ts            # Stadionaufbau, Publikum, Texturpanels
    player-visuals.ts     # optionale GLB-Animationen und Fallback
    style.css             # aktuelle UI-Styles
  public/
    assets/stadium/       # vorhandene statische Stadionassets
    data/                 # recherchierte, kategorisierte Projektinformationen
    archive/              # nicht autoritative Kopien einiger Quelldateien
```

**Zielarchitektur (nicht bereits implementiert):**
- Trainer/Manager übersetzt Anweisungen in nachvollziehbare Teamtaktik.
- Mannschafts- und individuelle Spieleragenten nehmen eine begrenzte Umwelt wahr, entscheiden, kommunizieren und erzeugen **Versuche** physikalischer Aktionen.
- Motorikadapter steuert begrenzte Beschleunigung, Körperbewegung und tatsächliche Fuß-/Kopfkontakte.
- Eine autoritative Physik simuliert Ball, Körper, Kontakte, Kräfte und Flugbahnen mit festem Zeitschritt.
- Eine eigene Regel-/Schiedsrichterschicht bestimmt den legalen Spielzustand; keine manipulierten Flugbahnen.
- Ereignisprotokoll und Snapshots tragen Replay, Analyse, Kommentar und Crowd-Regie.
- Rendering (3D/2,5D/Bildebenen), Audio und UI **lesen** den Spielzustand; keine zweite Ergebnisautorität.
- Pub Host, Football Manager, Match Director, Crowd Director und Match Analyst sind **Produktrollen**, nicht automatisch fünf dauerhaft laufende LLMs.
- Microsoft Foundry/Azure und lokale Modelle sind optionale, austauschbare Adapter; Cloud-Ausfall darf das laufende Match nicht stoppen.

**Architekturregel:** Erst vorhandene Module, Schnittstellen und reale Dateien prüfen. Keine unnötigen Parallelservices, keine separate Ersatzdemo und keine stillschweigende Verlagerung des Projekts.

## 4. Features & Functionality

| Funktion | Status | Grundlage / Einschränkung |
| --- | --- | --- |
| Browser-Spielfeld, Score, Zeit, HUD | Implementiert | `src/main.ts`, `README.md` |
| 3v3, einfache Laufwege, Schuss-/Passversuche | Teilweise | heuristische Agenten, keine ausgearbeitete Mannschaftsintelligenz |
| Rapier-Ball und dynamische Spielerkörper | Teilweise | echter Physikkern, aber Fußkontakt derzeit distanzbasierter Impuls |
| Intro, Kameramodi, einfacher Stadionton | Teilweise | visuell/akustisch noch weit vom Ziel |
| Stadiongeometrie und Crowd-Textur | Teilweise | einfache SVG-/Geometrie-Darstellung, keine abgenommene hochwertige Arena |
| GLB-Spieler und Animation | Teilweise | Lade-/Fallback-Code vorhanden; reale GLB-Dateien nicht bestätigt |
| 11v11, Torhüter, vollständige IFAB-Regeln | Geplant | noch nicht als funktionsfähig belegt |
| Ballspin, Magnus, realistische Kontakte, validierte Biomechanik | Geplant | keine Kalibrierung oder Messreihe bestätigt |
| Replay, Eventlog, Entscheidungsinspektion | Geplant | Zielarchitektur, nicht bestehender Produktionsnachweis |
| Fünf Erlebnisrollen, Cloud/Foundry-Integration | Geplant | nicht als funktionierend getestet |
| Smartphone-Companion, Fanaufnahmen, AR | Geplant / offen | Einwilligung, Rechte, technische Machbarkeit prüfen |

## 5. UI/UX Description

- Hochwertige Fußballübertragung und lebendiger englischer Spieltag statt technischer Sandbox.
- Bildbasierte Stadionflächen, Tiefenebenen, selektive 3D-Elemente und Crowd-Animation nach **Wirkung und Performance** kombinieren; keine pauschale Festlegung auf nur eine Rendertechnik.
- **Vier perspektivisch korrekte Stadionansichten:** derselbe Ursprung am Mittelpunkt, Augenhöhe etwa 1,75 m, jeweils 90° Drehung; zwei gegenüberliegende Tore und zwei Längstribünen. Die Mittellinie darf beim Torblick nicht fälschlich längs zum Tor verlaufen. **Noch kein akzeptierter Vierer-Satz im Repository bestätigt.**
- Spieler müssen durch Silhouette, Laufstil, Beschleunigung, Ballkontakt und Reaktionen glaubwürdig sein. Platzhalter nicht als Endqualität ausgeben.
- Kamera erhält Ball und Spielgeschehen lesbar; Regie und Ton dürfen Spannung verstärken, aber nichts erfinden.
- Bedienung generationenübergreifend, zugänglich und zunächst aus Trainerperspektive; Komplexität schrittweise offenlegen.
- Bestehende UI-Referenzen, Farben, Komponenten und Interaktionen vor Änderung prüfen; keine Gestaltung nach Gefühl.

## 6. Security & Dependencies

- Niemals Secrets, Tokens, Credentials oder private Daten in Git, `PROJECT_REPORT.md` oder `public/` schreiben. `public/` wird von Vite ausgeliefert.
- Cloud-Zugangsdaten serverseitig; Providerzugriffe über überprüfbare Adapter mit Timeouts, Fehlermeldungen und Eingabevalidierung.
- Lizenzen und Urheberrechte für Bilder, Modelle, Musik, Fangesänge und Trackingdaten **vor Nutzung** klären; Herkunft dokumentieren.
- Aufnahmen und Smartphone-Sensoren nur nach Berechtigung und Einwilligung; Rechte Dritter berücksichtigen.
- Versionen anhand tatsächlicher `package.json`/Lockdatei prüfen; neue Abhängigkeiten nur mit begründetem Bedarf.
- Vorhandene Bibliotheken und Services wiederverwenden, keine ungetesteten parallelen Systeme einführen.

## 7. Testing Status

**In dieser Arbeitsrunde wurde kein Build, Browserlauf oder Physikbenchmark durchgeführt.** GitHub-Dateien wurden gelesen und Dokumentationsänderungen geschrieben. Ein Commit beweist keine funktionierende Laufzeit.

**Lokal auszuführen:** `npm install`, `npm run check`, `npm run dev`; danach Sichtprüfung und echte Interaktion im Browser. Prüfergebnis mit Datum, Umgebung und Fehlerausgabe hier ergänzen.

**Fehlende wesentliche Prüfungen:** Ballfall und Rollreibung, Schuss-/Spinflug, CCD am Pfosten, echte Fußkontakte, Sprint-/Bremskurven, unabhängige Interzeption, Matchereignis-Replay, FPS/RAM auf Zielhardware, Asset-Vollständigkeit und Bildgeometrie. Kein Test darf ohne tatsächlichen Lauf als bestanden markiert werden.

---

## Development Roadmap

### Phase 1 – Critical Fixes & Stabilization
> Muss vor umfangreicher Erweiterung geklärt werden.
- [ ] Repository-Dateibaum und sämtliche Binärassets vollständig inventarisieren; keine nicht vorhandenen Bilder/GLBs behaupten.
- [ ] `npm run check` und Browserlauf tatsächlich ausführen, Fehler und Ergebnisse dokumentieren.
- [ ] Bestehende 3v3-Spielschleife auf physikalische Fehler und widersprüchliche Koordinatenannahmen prüfen.
- [ ] Bild-/Stadionansichten geometrisch korrekt spezifizieren und nur tatsächlich akzeptierte Assets integrieren.
- [ ] Relevante Hackathon-Regeln, Termin/Zeitzone und Lizenzbedingungen offiziell prüfen.

### Phase 2 – Core Improvements
> Zusammenhängende Physik, Agenten und glaubwürdige Darstellung.
- [ ] Echte Fuß-/Ballkontaktlösung prototypisch **in der bestehenden Anwendung** messen und vergleichen.
- [ ] Agentenwahrnehmung, Taktik, Motorik und Simulationszustand mit klaren Zuständigkeiten entflechten.
- [ ] Physik-, Ereignis- und Snapshot-Schnittstellen implementieren und testen.
- [ ] Bild-/2,5D-/3D-Stadionpipeline auf echter Zielhardware prüfen.
- [ ] Publikum, Ton und TV-Kamera an tatsächliche Spielereignisse koppeln.

### Phase 3 – Feature Extensions
> Spieltiefe und Interaktion.
- [ ] Von 3v3 zu taktisch glaubwürdigem 11v11 mit Torhütern skalieren.
- [ ] Vollständige relevante Spielregeln und Schiedsrichterentscheidungen schrittweise validieren.
- [ ] Trainer-/Managerinteraktion, Match Analyst und Ereignis-kompatiblen Kommentar ergänzen.
- [ ] Replays, Diagnostik und erklärbare Spielerentscheidungen bereitstellen.

### Phase 4 – Future Features & Vision
> Die volle Matchday-Welt.
- [ ] Pub Host, Vorstadion-Szenen, Einlauf, Fanrituale und emotionales Matchday-Erlebnis ausbauen.
- [ ] Smartphone-/Community-Teilnahme mit Einwilligung und Rechtemanagement erproben.
- [ ] Hochwertige Spieler- und Stadionproduktion samt Animation, Audio und Kamera für unterschiedliche Geräte.
- [ ] Optionale Azure/Foundry-Dienste und mögliche weitere Agentenmodelle anhand konkreter Kosten/Qualität validieren.

---

## Notes & Open Questions

- Die aktuelle Anwendung und die Zielvision haben **absichtlich unterschiedliche Reifegrade**; Ziel nicht stillschweigend auf Prototypniveau reduzieren.
- `ARCHITECTURE.md` bezeichnet sich als Draft und enthält Vorschläge, darunter abweichende Achsen und Stack-Optionen. Bei Widerspruch mit bestehendem Code zuerst den Ist-Zustand klären.
- Der vollständige Medienbestand, die GLB-Dateien und die vier finalen Stadionbilder sind **nicht abschließend verifiziert**.
- `public/archive/` ist kein vollständiges Backup und kann veralten; Git mit Historie bleibt die zuverlässigere Sicherung.
- Der Hackathon-Termin 29.10.2026 wurde in der Projektkommunikation genannt, ist hier nicht erneut offiziell geprüft.
- **Nächster Arbeitsauftrag:** Erst realen Git-Bestand und funktionierenden Lauf prüfen, dann das größte technische Hindernis mit einem überprüfbaren integrierten Test bearbeiten.
- **Selbstkontrolle vor jeder Änderung:** Ist das, was ich gerade tun will, wirklich die wichtigste Arbeit für unser aktuelles Ziel? Verbessert es das echte THE-12TH-MAN-Erlebnis? Habe ich den aktuellen Code und die bestehenden Entscheidungen geprüft? Kann ich die Änderung tatsächlich testen? Falls nein: nicht reflexhaft weitere Dateien oder Abstraktionen erzeugen.

---

## Rules

### A. Verbindliche Projektregeln
1. `PROJECT_REPORT.md` im Repository-Hauptverzeichnis ist die **eine operative Source of Truth**. Nach relevanten Arbeitsblöcken mit überprüften Ergebnissen aktualisieren.
2. `VISION.md` ist für das angestrebte Erlebnis verbindlich. Keine unautorisierte Vereinfachung, Architekturänderung oder Ersatzdemo.
3. **Inspect first → change second → verify third → document last.** Vor jedem Eingriff reale Dateien, APIs, Assets, Tests und bisherige Entscheidungen lesen.
4. **Ist / beschlossen / geplant / Hypothese / nicht geprüft** ausdrücklich trennen. Keine erfundenen Dateien, Testergebnisse, Modellfunktionen oder Assetnachweise.
5. Ein Git-Commit, grüner Typecheck oder schönes Screenshot ersetzt keinen realen Funktionstest.
6. Ein physikalischer Autoritätskern; keine erzwungenen Tore, Teleportation, garantierten Pässe oder erfundene Matchereignisse.
7. Bestehenden Code, Services und Architektur respektieren. Keine parallele Lösung bauen, wenn bereits ein brauchbarer Pfad existiert.
8. **Ordnernamen klein**, flache nachvollziehbare Struktur, keine unnötigen neuen Ordner oder doppelten Abstraktionen.
9. React-/TSX-Komponenten und zugehöriges CSS gehören gemeinsam in die bestehende `src/`-Struktur; fachliche Workspace-/Assetordner sind keine Ablage für produktive UI-Komponenten.
10. **Kein Tailwind.** Bestehende UI respektieren; Lucide-Icons einheitlich, keine Emojis als funktionale Icons. Scrollen möglichst nur in vorgesehenen Innencontainern.
11. Änderungen in kleinen, überprüfbaren Schritten; **eine Checklistenposition = eine überprüfbare Aktion**.
12. Bestehende, verifizierte Lösungen nicht ohne Regression, neue Anforderung oder neue Messdaten erneut aufreißen.
13. Keine unaufgeforderten GitHub-Actions-Workflows. CI nur nach ausdrücklicher Freigabe bzw. gezielter Release-Entscheidung.
14. Keine geheimen Daten in Quellcode, Dokumentation oder öffentlichen Assets; Rechte und Lizenzen von Medien prüfen.
15. Berichte und Übergaben auf **Deutsch**; technische Bezeichner, Code und Dateinamen unverändert.
16. Nach jeder relevanten Änderung `PROJECT_REPORT.md` aktualisieren; `README.md` bei veränderten Installations-/Nutzungsanweisungen ebenfalls.
17. Produktive Quelldateien möglichst unter **ca. 500 Zeilen** halten; nur nach fachlicher Verantwortung modularisieren. Markdown-Dokumente haben keine solche Grenze.
18. Kein blindes Kopieren von Archivdateien über aktuellen Code. Maßgeblich sind die tatsächlichen Originaldateien und ihr Git-Verlauf.
19. KI-Provider lokal/offline bevorzugen, wo sinnvoll; Cloud über Adapter, asynchron und mit klarer Fehlerbehandlung. Kein Cloud-Aufruf im physikalischen Tick.
20. Bei Unsicherheit gezielt prüfen oder als offen markieren, nicht als Tatsache ausgeben.

### B. Bestehende allgemeine Regeln (unverändert als Referenz erhalten)
Die nachfolgende Sektion übernimmt die zuvor im Repository vorhandene globale Regelvorlage, einschließlich Design-Tokens, Dateigrößen, Frontend-Stack, TSX/CSS, Qualität, Provider, Validierung und Dokumentationsmethodik. Bei Konflikten mit dem tatsächlichen Projektstand zuerst den Konflikt dokumentieren; diese Standardregeln sind **keine Erlaubnis**, die Anwendung automatisch auf einen anderen Stack umzubauen.

<details>
<summary>Originale globale Regelvorlage aus PROJECT_REPORT.md (Stand vor dieser Befüllung)</summary>

# Project

You are an expert software architect and senior developer.

## Task

Analyze the entire project in the current working directory and create or update `PROJECT_REPORT.md`.

The report is simultaneously:
- the technical project overview,
- the single source of truth for the current state,
- the development roadmap,
- the handover document for the next developer/AI session.

Do not redesign the project from assumptions. First inspect the real codebase, configuration, tests and existing documentation.

## Analysis Scope

### Project & Architecture
- Name, purpose, current status and intended end state
- Tech stack, architecture pattern, entry points and data flow
- Important folders, services, adapters, stores and external integrations
- Compare documentation against the actual code; explicitly flag contradictions
- Keep architecture flat and understandable; avoid unnecessary nesting and duplicate abstractions

### Features & UI/UX
- Implemented, partial and planned features
- User workflows and interfaces/APIs
- Layout, components, interactions and design language
- Clearly distinguish working functionality from placeholders, mocks or plans
- Check existing UI/design references before implementing visual changes
- Do not invent layout values by eye when a reference or existing design system exists

### Code Quality
- Naming, separation of concerns, DRY/SOLID where useful
- Error handling, logging, dead code, unused imports and duplicated logic
- Reuse existing loaders, stores, providers, adapters, hooks and utilities before creating new ones
- Do not reopen already validated solutions without concrete evidence of a regression
- Avoid unnecessary refactors and renaming when existing code is already correct
- Keep business/backend logic out of presentation components where practical

### Security & Dependencies
- No secrets, private keys, tokens or credentials in source code or documentation
- Validate external/user input and inspect auth, permissions and trust boundaries
- Prefer environment variables / secret stores for credentials
- Record important dependencies and flag obsolete, unused or risky packages
- Use the newest technically sensible dependency versions by default
- Pin or downgrade only when a real compatibility requirement exists and document the reason

### Testing & Build
- State the actually verified test/build status; never assume “green”
- Record relevant commands and their last known result
- Check unit/integration/e2e coverage where applicable
- Identify missing critical tests
- Prefer one project-wide quality command such as `npm run check` when the project provides it
- Test locally during normal development
- Do not run or add GitHub Actions/CI unnecessarily during ordinary development; use CI deliberately for integration/release validation

## Global Development Rules

These rules apply across projects unless an existing project contains an explicit, documented exception.

### File Size & Modularization
- Productive source-code files should stay below approximately 500 lines
- When a source file approaches or exceeds ~500 lines, split it into meaningful modules/components/hooks/services
- Do not split files mechanically; keep responsibilities coherent
- Markdown files have no line limit and may be as long as needed for complete documentation
- Generated files, lockfiles and vendor code are not subject to the 500-line rule

### TSX & CSS Structure
- A TSX component and its component-specific CSS belong in the same folder
- Use the same base filename, e.g. `Panel.tsx` + `Panel.css`
- Do not create separate style subfolders for individual components
- Keep the component structure as flat as practical
- `global.css` is the allowed central exception for resets/imports/minimal global rules
- Avoid inline styles unless a runtime-calculated value genuinely requires them

### Standard Frontend Stack
- React 19
- TypeScript / TSX
- Vite 8
- Plain/classic CSS or CSS Modules
- No Tailwind
- `lucide-react` for UI icons
- Do not use emojis as functional UI icons
- Existing project requirements may justify a different stack only when explicitly documented

### Design System
- `styles/design_variables.css` / `src/styles/design_variables.css` is the central design-token source of truth when present
- Do not change the design-variable file without an explicit project decision
- Reuse existing typography, spacing, radii, surfaces, shadows and icon sizing instead of inventing parallel tokens
- Existing visual references take priority over improvised design
- Preserve provided backgrounds, logos and visual layers unless change is explicitly required
- Keep the outer application frame stable where the design requires it; scroll intended inner content areas instead of the whole application
- Avoid unnecessary main-window scrolling
- Do not create visual values “by feel” when measurable references exist

### Icons & Interaction
- Use Lucide icons consistently
- Match icon size, stroke and alignment across the interface
- Functional controls must remain understandable without decorative emoji
- Preserve existing interaction behavior unless a change is part of the task

## AI & Provider Rules

- Prefer local/offline-capable AI providers where practical
- Keep cloud providers behind adapters/interfaces rather than making them hard dependencies
- AI/provider integrations need clear interfaces, timeouts, useful error messages and deterministic validation
- Reuse existing provider loaders, registries and adapters before introducing new provider infrastructure
- For LM Studio use the current project-approved SDK/API integration
- If structured output from a model/provider is unreliable, prefer prompt-JSON plus schema validation instead of accepting malformed output
- Do not claim AI functionality works until the real provider path has been tested

## Development Method

- `PROJECT_REPORT.md` in the project root is the single source of truth for status, decisions, architecture, data flow, open work and phase progress
- Inspect first, change second, verify third, document last
- Work in small, reviewable steps
- One checklist item = one clear action
- Mark items complete only after verification
- Record blockers and uncertain decisions under `Notes & Open Questions`
- Do not silently change architecture, public APIs, database schemas, licensing, security boundaries or release behavior
- After every relevant work block, update `PROJECT_REPORT.md`
- Update `README.md` when setup, features, usage, architecture or user-facing behavior changed
- Never describe planned functionality as implemented
- Prefer exact evidence: real filenames, functions, commands, tests and line references where useful
- Do not repeat completed analysis just to fill the report
- Preserve exact product/brand spelling and casing, e.g. `TobisStudio`
- UI language follows the project decision
- Reports and explanations are written in German; code, identifiers, filenames and technical terms stay unchanged

## Validation & Change Discipline

- Already validated, completed or intentionally frozen areas remain closed unless there is:
  - a concrete regression,
  - a new requirement,
  - or new technical evidence
- Do not rework functioning architecture simply because another implementation is possible
- Do not invent duplicate infrastructure when a working project service already exists
- Validate real code against documentation before changing either
- If code and documentation contradict each other, document the contradiction and establish the real current state
- Never fabricate files, functions, APIs, tests, versions or implementation status
- A successful-looking UI is not proof that backend/provider/build/release functionality works
- Test the real execution path that the user will use

## Output Structure

The report must follow this structure:

---

# [Project Name] – Technical Report & Development Guide

## 1. Project Overview
## 2. Tech Stack
## 3. Architecture & Folder Structure
## 4. Features & Functionality
## 5. UI/UX Description
## 6. Security & Dependencies
## 7. Testing Status

---

## Development Roadmap

### Phase 1 – Critical Fixes & Stabilization
> Must be done before any further development
- [ ] ...

### Phase 2 – Core Improvements
> Architecture, performance, code quality
- [ ] ...

### Phase 3 – Feature Extensions
> Planned enhancements and new features
- [ ] ...

### Phase 4 – Future Features & Vision
> Long-term ideas and optional upgrades
- [ ] ...

---

## Notes & Open Questions
- Only unresolved issues, blockers, decisions or assumptions that still matter.

---

## Rules

- Keep the report concise but complete; no filler and no novel-length documentation
- The report itself is not restricted by the 500-line source-code rule
- Reference real files/functions/commands; use line numbers when they materially help
- Preserve existing validated decisions unless new evidence requires a change
- Never fabricate test results, implementation status, files, APIs or dependencies
- Clearly label: implemented / partial / planned / blocked
- Checklists must be actionable and current
- Do not place secrets or sensitive credentials in the report
- Keep global rules separate from project-specific implementation details
- Project-specific requirements override defaults only when explicitly documented
- Output file: `PROJECT_REPORT.md`
- Write the report in German except for code, filenames, identifiers and technical terms
- After creating/updating the report, continue speaking German with the user


</details>
