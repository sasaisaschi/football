# THE 12TH MAN — versionierter Datenbestand

Dieser Ordner enthält **laufzeitfähige JSON-Daten** und deren dokumentierte Herkunft. Die Anwendung liest derzeit nicht automatisch alle JSON-Dateien. Das ist eine gesicherte Materialsammlung, kein Beleg für implementierte Features.

- `project-inventory.json`: überprüfter Code-/Assetbestand und bekannte Lücken.
- `physics.json`: aktuelle Parameter aus `src/main.ts` und klar getrennte Forschungsziele.
- `football.json`: Spielregeln, Spielfunktionen und Agenten-/Erlebnisanforderungen.
- `smartphone.json`: Geräteschnittstellen, Einsatzideen, Berechtigungen und Plattformgrenzen.
- `assets.json`: vorhandene Assets, fehlende Quelldateien und Perspektivvorgaben.

**Erhaltungsregel:** `public/` ist Vites statischer Auslieferungsordner, kein vollständiges Repository-Backup. Quellcode bleibt in `src/`, Abhängigkeiten in `package.json`, Konzeptdokumente im Repo-Stamm. Keine Binärdatei als vorhanden markieren, wenn sie nicht in Git liegt. Keine bestehenden Dateien verschieben oder löschen, bis Referenzen und Lizenz geprüft sind.

**Stand:** 2026-10-16. Codeparameter aus dem GitHub-Stand an diesem Datum; Produktkonzept aus VISION.md/ARCHITECTURE.md und den bisherigen Nutzerentscheidungen. Offene Punkte bleiben als solche gekennzeichnet.
