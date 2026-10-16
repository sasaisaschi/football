# THE 12TH MAN — Datenkatalog für Menschen und KI-Modelle

**Stand:** 2026-10-16. **Zweck:** Ein anderes Modell soll zuerst den Bestand verstehen und erst dann Änderungen vorschlagen. Dieses Verzeichnis enthält **Fakten aus dem Quellcode**, **übernommene Produktentscheidungen**, **Forschungsnotizen** und **offene Anforderungen**. Nicht alles ist implementiert.

## Empfohlene Lesereihenfolge

1. [HANDOFF.md](./HANDOFF.md) — kurzer Übergabevertrag, Grenzen und Arbeitsauftrag
2. [project-inventory.json](./project-inventory.json) und [application.json](./application.json) — tatsächlicher Anwendungsstand
3. [visual-production.json](./visual-production.json), [art-asset-specification.json](./art-asset-specification.json), [assets.json](./assets.json) — Bild-/Stadionstrategie
4. [physics.json](./physics.json), [real-football-geometry.json](./real-football-geometry.json), [physics-validation.json](./physics-validation.json) — Simulation und Validierung
5. [football.json](./football.json), [agents.json](./agents.json), [agent-intents.json](./agent-intents.json), [game-state-contract.json](./game-state-contract.json) — Fußball, Agenten und Matchzustand
6. [crowd-director.json](./crowd-director.json), [matchday-experience.json](./matchday-experience.json) — Erlebnis und Atmosphäre
7. [smartphone.json](./smartphone.json), [mobile-production.json](./mobile-production.json) — Smartphone-Fähigkeiten und Einsatz
8. [research-sources.json](./research-sources.json), [competition.json](./competition.json), [technical-risks.json](./technical-risks.json), [implementation-priorities.json](./implementation-priorities.json) — Quellen, Wettbewerb, Risiken und Reihenfolge

## Maßgebliche Dateien außerhalb von public

- `/VISION.md`: kreative Produktvision, nicht durch vereinfachte Prototypziele ersetzen.
- `/ARCHITECTURE.md`: Architektur- und Forschungsstand; ausdrücklich teilweise **Entwurf**.
- `/README.md`: Start und aktueller Prototyp.
- `/src/main.ts`: ausführbarer Spiel- und Physikkern.
- `/src/stadium.ts`: aktuelle Stadiongeometrie und Bildpanel.
- `/src/player-visuals.ts`: GLB-Modelllade- und Animationslogik.
- `/src/style.css`: Oberfläche.
- `/package.json`: tatsächliche Laufzeit- und Build-Abhängigkeiten.

Die Sicherungskopien unter `/public/archive/` sind **keine** autoritativen Quelldateien und können später veralten. Ein anderer KI-Agent soll für Codeänderungen immer die Originaldateien im Repository lesen.

## Bedeutung der Angaben

- **implemented / current / observed:** aus aktuell eingesehenem Quellcode abgeleitet; kein Beleg für einen bestandenen Laufzeittest.
- **agreed vision / requirement:** beabsichtigtes Produktverhalten; nicht automatisch implementiert.
- **proposed / candidate / research:** Vorschlag, Hypothese oder ungeprüfte Quelle.
- **not implemented / missing / unverified:** ausdrücklich nicht als vorhanden behaupten.
- **source / references:** Herkunft; bei Widerspruch aktuelle Quelldateien und Nutzerentscheidungen prüfen.

## Was diese Sammlung nicht ist

Kein vollständiges Repository-Backup, keine Garantie über alle früheren Chatprotokolle, kein fertiger Assetkatalog mit allen Binärdateien und kein Nachweis, dass generierte Bilder tatsächlich in GitHub liegen. `public/` wird von Vite statisch ausgeliefert; niemals Geheimnisse dort ablegen.
