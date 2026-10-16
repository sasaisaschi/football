# THE 12TH MAN — Zielarchitektur ohne Qualitätskompromiss
**Datum:** 2026-10-16
**Status:** Technische Zielvorstellung zur gemeinsamen Lösungsfindung; **keine** bereits genehmigte Implementierungsänderung.
**Quellen:** /VISION.md (Erlebnisbibel), /ARCHITECTURE.md (Entwurf und Forschungsfragen), /README.md (aktueller Prototyp). Bei Widersprüchen gilt die explizit bestätigte Produktvision; Codeänderungen bedürfen gesonderter Prüfung.

## 1. Was wir erreichen wollen
THE 12TH MAN ist eine glaubwürdige, emotionale und interaktive Fußballwelt: englischer Spieltag von der Straße vor dem Stadion über Pub und Tribüne bis zu einem **nicht geskripteten** 11-gegen-11-Spiel und der nachvollziehbaren Nachbereitung. Das Publikum erlebt einen Fußballabend, nicht eine Sandbox. Hochwertige Wirkung wie bei Premium-Fußballübertragungen ist Qualitätsmaßstab, nicht die Behauptung einer bereits vorhandenen FIFA/EA-FC-Engine.

## 2. Nicht verhandelbare Eigenschaften
1. **Eine physikalische Wahrheit:** Ball, Körper, Kontakte und Spielausgang entstehen in einer autoritativen Simulation. Kein KI-Modell, Renderer oder Regisseur setzt Tore oder Flugbahnen willkürlich.
2. **22 autonome Spieler:** Position, Fähigkeiten, Wahrnehmungsgrenzen, Absicht, Zusammenarbeit und individuelle Fehler. Der Trainer beeinflusst Taktik, nicht einzelne Schussergebnisse.
3. **Ein durchgängiges Spiel:** dieselbe Physik für Pass, Schuss, Dribbling, Zweikampf, Kopfball, Abwehr, Torwart und Standardsituation.
4. **Regelgerechter Fußball:** eigenständige, nachvollziehbare Schiedsrichter-/Regellogik für Spielphasen, Abseits, Fouls, Spielfortsetzungen und Tore.
5. **Emotionale Bild- und Tonwelt:** hochwertiges Stadion, realistische räumliche Wirkung, glaubwürdige Sportler, bewegtes Publikum, Licht, Gesänge, Kommentar und TV-Regie.
6. **Ereigniswahrheit:** Replays, Jubel, Kommentar und Analyse müssen aus tatsächlich geschehenen Aktionen ableitbar sein.
7. **Menschliche Beteiligung:** Trainer- und Managersteuerung; Pub Host, Crowd Director, Match Director und Match Analyst; Smartphone-Teilnahme als optionaler, zustimmungsbasierter Zugang.
8. **Reale Hardwaregrenzen lösen, nicht Produktziel reduzieren:** Bild- und Tiefenebenen, 2,5D, Instancing, selektive 3D-Details und Audio-Mischung dort einsetzen, wo sie mehr Wirkung pro Rechenaufwand liefern.

## 3. Logische Architektur
```text
NUTZER / TRAINER / FANS / SMARTPHONE
                |
ERLEBNIS-UI (Stadion, TV-Regie, Pub, Trainer, Matchday)
                |
ROLLE / ORCHESTRIERUNG
Football Manager | Pub Host | Match Director | Crowd Director | Match Analyst
                |
TAKTIK / TEAM-KOORDINATION / PERZEPTION
                |
22 INDIVIDUELLE SPIELERAGENTEN
Intention -> Motorik -> Kontaktversuch
                |
AUTORITATIVE SPIELSIMULATION (feste Tickrate)
Rapier | Ball | Körper | Kräfte | Kontakte | Torwart
                |
REGELWERK / SCHIEDSRICHTER
                |
UNVERÄNDERLICHE EREIGNISSE + ZUSTANDSSNAPSHOTS
          /             |             \
  TV/3D/2.5D      Crowd/Audio      Replay/Analyst
          \             |             /
              ERLEBNIS-UI
```
**Single-writer:** Nur der Simulationskern verändert autoritative Körperzustände. Regeln verändern legale Spielzustände, nicht rückwirkend die Physik. Rendering liest/interpoliert. Cloud-KI gibt Vorschläge, Interpretationen oder Sprache aus, niemals physikalisch bindende Ergebnisse.

## 4. Verantwortlichkeiten und Schnittstellen
- **Simulationskern:** SI-Einheiten, fester Tick, Kollisions- und Kontaktzustand, Ballrotation, externe Kräfte. Rapier ist derzeitige Implementierung und bevorzugte Ausgangsbasis, aber seine Eignung für komplexe Körperkontakte muss gemessen werden.
- **Motorik:** bounded acceleration, Bremsen, Drehen, Laufen, Sprung, Fuß-/Kopfkontakt, Balance. Ein Animationsclip ist nicht automatisch ein physikalischer Ballkontakt.
- **Agenten:** partielle Wahrnehmung, lokale Echtzeitentscheidungen, Rollen, Laufwege, Pässe, Pressing, Deckung, Kommunikation. Kein LLM-Aufruf pro Spieler und Physikframe.
- **Taktik/Manager:** verständliche Trainerbefehle werden in überprüfbare Teamprinzipien und Constraints übersetzt. Umsetzung und Erfolg bleiben ungewiss.
- **Regeln:** Tore, Aus, Anstoß, Abseits, Fouls, Karten, Standards und Schiedsrichterentscheidungen mit begründeten Ereignissen.
- **Ereignisse:** Zeitstempel/Tick, beteiligte Akteure, Ursache, Positions-/Geschwindigkeitsbezug und verifizierbare Referenzen. Snapshots ermöglichen Replay und Diagnose.
- **Visualisierung:** Spielfeld in korrekter Geometrie, passende Stadionansichten, Bild-/2,5D-/3D-Kombination, Kamera-Regie, LOD, glaubwürdige Animation und Licht. Physik bleibt unabhängig von Render-FPS.
- **Audio/Crowd:** lokaler, schneller Zustandsautomat für Reaktionen; hochwertige lizenzierte Klangschichten; optionale KI für Sprache, nicht für physikalische Fakten.
- **KI-/Cloud-Adapter:** optionaler Microsoft Foundry/Azure-Zugang für Taktikdialog, Analyse und Kommentar. Kein Cloud-Zwang für eine laufende Partie; Schlüssel niemals im Browser.
- **Smartphone:** freiwilliger Companion, Aufnahme von Fanmaterial und kollektive Interaktion; Berechtigungen, Rechte, Moderation und Latenz berücksichtigen.

## 5. Geometrie und Bildkohärenz
- Zielspielfeld als Referenz 105 × 68 m, Tore 7,32 × 2,44 m; gültige IFAB-Fassung vor finaler Festlegung prüfen.
- **Aktuelle Code-Achsen:** X = Spielfeldlänge, Y = Höhe, Z = Spielfeldbreite. Der Entwurf in ARCHITECTURE.md enthält eine abweichende Achsenkonvention (X/Y/Z) und darf nicht ungeprüft übernommen werden.
- Vier Stadionsichten müssen dieselbe Szene vom Mittelpunkt aus auf ca. 1,75 m Augenhöhe und in 90°-Schritten zeigen. Feldlinien müssen perspektivisch korrekt sein; akzeptierter Vierer-Satz fehlt.
- Ein einzelnes Panorama oder vier Fotos liefern keine beliebig freie 3D-Kamera. Kameraeinschränkungen, Tiefenebenen, selektive 3D-Geometrie oder zusätzliche Ansichten sind bewusst zu entscheiden.

## 6. Derzeitiger Ist-Zustand (keine Schönfärberei)
README.md beschreibt ein browserbasiertes 3-gegen-3 auf 42 × 28 m mit Three.js, Rapier, einfachen Agenten, Distanz-Impulse-Kicks, Torerkennung, Score und HUD. Die VISION.md beschreibt die wesentlich größere Zielwelt. Fehlend oder ungeprüft sind unter anderem 11v11, glaubwürdige Fußkontakte, vollständige Regeln, fertige fotorealistische Stadionassets, hochwertige Spieleranimationen, Event-Replay, umfassende KI-Agenten, Microsoft-Integration und Performance auf Zielhardware. Die bestehenden public/data-Dateien enthalten Bestandsnotizen und Anforderungen, keine automatische Funktionsgarantie.

## 7. Akzeptanz: Welche Szene muss möglich werden?
Ein ausverkauftes Stadion am Abend. Trainer fordert mutigeres Umschalten. Die Mannschaft reagiert taktisch; ein Außenverteidiger startet, ein Pass findet die Lücke, der Gegner versucht abzufangen, der Torwart kommt heraus, ein Schuss trifft den Pfosten, ein anderer Spieler reagiert, vielleicht fällt ein Tor. **Nichts davon ist als Ausgang vorgeschrieben.** Kamera, Publikum, Kommentar und spätere Analyse reagieren ausschließlich auf die wirklichen Kontakte und Ereignisse. Die gleiche Partie ist physikalisch inspizierbar und per Snapshot/Event-Log rekonstruierbar.

## 8. Technische Hindernisse, die wir lösen müssen
1. Glaubwürdiger physikalischer Fuß-Ball-Kontakt ohne eine komplette teure Biomechanik-Engine.
2. Stabile Ballphysik einschließlich Spin, Flug, Pfosten und Kollisionen bei brauchbarer Tickrate.
3. 22 gleichzeitig autonome, taktisch kooperative Spieler mit wahrnehmbaren individuellen Absichten.
4. Animation und Körperkontakt synchronisieren, ohne Bewegungen zu fälschen.
5. Hochwertiges Bild bei begrenztem GPU-/RAM-Budget: kohärente Stadionansichten, 2,5D/3D-Komposition, Kamera und Licht.
6. Publikum und Audio reaktiv, aber performant; Rechte an allen Assets klären.
7. Spielregeln, Replay und Ereignisprovenienz ohne auseinanderlaufende Zustände.
8. Sprach-/Cloud-Integration mit kontrollierter Latenz, Kosten und Offline-Betrieb.
9. Objektive Tests: Physikmessungen, Agentenverhalten, visuelle Abnahme und reale Laufzeit.

## 9. Umsetzung ohne Zielverlust
Die Zielarchitektur bleibt groß; ihre Verifikation erfolgt in integrierten, tatsächlich lauffähigen Schritten innerhalb **des bestehenden Repositorys**, nicht in einer Ersatzdemo. Erst die durchgehende Spielwelt und eine glaubwürdige Matchday-Szene; dann funktional verfeinern. Bei jeder Abkürzung offen benennen, welche Qualität noch fehlt. Keine Architekturänderung, neuen Workflow oder Assetbehauptung ohne Prüfung.

## 10. Übergabe an ein anderes Modell
Lies zuerst /VISION.md, danach diese Datei, /ARCHITECTURE.md, /README.md, /public/data/INDEX.md und die tatsächlich betroffenen src-Dateien. Beantworte vor jeder Implementierung: Welches Zielsystem wird verbessert? Was ist heute wirklich vorhanden? Was ist lediglich Konzept? Welche technischen Beweise/Tests fehlen? Welche Dateien werden verändert? Niemals Pläne als implementierte Funktionen oder unbestätigte Assets als vorhanden darstellen.
