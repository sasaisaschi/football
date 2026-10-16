# Übergabe an ein anderes KI-Modell — THE 12TH MAN

## 1. Projektziel
Wir bauen eine emotional glaubwürdige Fußball-Matchday-Erfahrung mit autonomen Spielern, echter physikalischer Simulation, Trainerinteraktion, Stadionpublikum und ereignisgesteuerter Inszenierung. **Kein reiner Chatbot und kein isolierter Technik-Prototyp.** Maßgeblich ist `VISION.md`.

## 2. Was wirklich läuft
Repository `sasaisaschi/football`, Browser/TypeScript/Vite, Three.js, Rapier 3D, derzeit 3 gegen 3 auf verkleinertem Feld. Einfache Schuss-/Pass-/Dribbling-Entscheidungen, Score, Intro, HUD, Kameramodi und Stadiongeometrie. **Keine** fertige fotorealistische Stadionkulisse, keine bestätigten finalen GLB-Spielerassets, keine vollständigen Fußballregeln. Siehe `project-inventory.json` und `application.json`.

## 3. Architekturgrenzen
- Rapier besitzt die physikalische Autorität über den Ball; keine geskripteten Tore.
- Three.js ist Darstellung, keine zweite Spielphysik.
- Bildbasierte Tribünen/Publikum und 2,5D sind ausdrücklich erwünscht, sofern Perspektive und Kameraführung stimmen.
- Code in bestehender Anwendung weiterentwickeln, keine eigenständige Ersatzdemo.
- Originalquellen vor Änderungen lesen. `public/data/` ist Dokumentation und `public/archive/` nur eine Kopie.
- Keine GitHub-Actions-Workflows ohne ausdrückliche Genehmigung.

## 4. Der offene Bildfehler
Die früheren KI-generierten Stadionansichten sind **nicht** als zusammenpassender Vierer-Satz abgenommen. Gewünscht sind vier getrennte Ansichten von **demselben Mittelpunkt** auf Augenhöhe ca. 1,75 m, jeweils um 90 Grad gedreht, mit geometrisch korrekten Feldlinien und zwei gegenüberliegenden Toren. Beim Blick in Tor-Richtung darf keine falsche weiße Längslinie zum Tor laufen; die Mittellinie verläuft quer zur Blickrichtung. Beim Blick auf die Längstribüne darf die Mittellinie hingegen vom Mittelpunkt bis zur Seitenlinie nach vorne verlaufen. Siehe `assets.json` und `visual-production.json`.

## 5. Wie die Daten zu lesen sind
Die JSON-Dateien dokumentieren **unterschiedliche Reifegrade**. Eine Featureliste in `football.json` oder `smartphone.json` bedeutet nicht, dass diese Features bereits programmiert wurden. `physics.json` enthält die aktuellen Codewerte; `real-football-geometry.json` dokumentiert ein davon getrenntes reales Referenzspielfeld. `research-sources.json` nennt frühere Recherchequellen, nicht frisch bestätigte Prüfergebnisse.

## 6. Vor jeder Weiterarbeit
1. `VISION.md`, `ARCHITECTURE.md`, `README.md` und betroffene Originalquellen lesen.
2. Ausdrücklich trennen: **vorhanden**, **beschlossen**, **geplant**, **nicht geprüft**.
3. Keine Daten oder Bilder als vorhanden behaupten, ohne Dateien und Referenzen zu prüfen.
4. Bei Codeänderungen: tatsächliche Diff-Dateien, Build und Laufzeittest separat berichten.
5. Nichts löschen, verschieben oder stillschweigend durch eine andere Architektur ersetzen.
6. Neue Forschung mit Datum, Quelle und Prüfergebnis dokumentieren; Entscheidungen nicht als Tatsachen tarnen.

## 7. Weitere Dateien
Vollständige thematische Navigation in `INDEX.md`. Die Originaldateien liegen im Repository-Stamm und unter `src/`.

**Hinweis:** Diese Übergabe ist eine Zusammenfassung des bis 2026-10-16 dokumentierten Standes, keine vollständige Rekonstruktion sämtlicher früheren Unterhaltungen.
