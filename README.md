# Turnierplaner

Web-Tool für Jugend-Fußballturniere mit **16 Teams auf 4 Spielfeldern** – entstanden aus einer Excel-Vorlage (U9-Hallenturnier).

## Ablauf

1. **Gruppenphase 1** – 4 Gruppen à 4 Teams, jeder gegen jeden (24 Spiele).
2. **Gruppenphase 2** – neu gemischte Gruppen: Jede Gruppe bekommt einen Ersten, Zweiten, Dritten und Vierten aus Phase 1, jeweils aus einer anderen alten Gruppe (keine Wiederholungsspiele).
   **Punkte und Tore beginnen wieder bei null** – gewertet wird nur innerhalb der Phase.
3. **Finalrunde** – Gruppenerste und -zweite spielen über Kreuz Viertelfinale, danach Halbfinale / kleines Halbfinale und alle Spiele um Platz 1–8. Dritte und Vierte spielen Platz 9–16 aus. Unentschieden → Sieger im Neunmeterschießen auswählen.
4. **Endstand** 1–16.

Platzierung in den Gruppen: Punkte – Tordifferenz – mehr erzielte Tore – direkter Vergleich – Los.

## Funktionen

- Beliebig viele Turniere anlegen, als Vorlage kopieren, löschen
- Teamnamen, Gruppen (auch zufällig auslosen), Spielfelder, Spielzeit, Takt und Startzeiten einstellbar
- Ergebniseingabe mit Live-Tabellen (Enter springt ins nächste Feld)
- Zeitplan wird automatisch aus Startzeiten und Takt berechnet
- Spielregeln editierbar
- Export / Import als JSON-Datei (Backup oder Übergabe an ein anderes Gerät)
- Druckansicht
- Vereinsbanner und Sponsorenleiste (Bilder in `img/`)
- Logos für jedes Turnier und jede Mannschaft (werden beim Hochladen automatisch verkleinert)
- Automatisches Speichern auf GitHub (optional, siehe unten)

## Speicherung

Alle Daten liegen zunächst **im Browser des Geräts** (localStorage).

**Optional: GitHub-Speicher.** In der App unter „GitHub-Speicher einrichten“ einen
Fine-grained Personal Access Token hinterlegen (nur dieses Repo, Berechtigung
*Contents: Read and write*). Dann speichert die App jedes Turnier automatisch ca. 8 Sekunden
nach der letzten Änderung als `data/<id>.json` im Branch **`data`** (der Branch wird automatisch
angelegt, GitHub Pages wird dadurch nicht neu gebaut). Andere Geräte mit Token laden die Turniere
beim Öffnen. Tragen zwei Geräte gleichzeitig ein, werden die Ergebnisse zusammengeführt.

- Der Token bleibt im Browser des jeweiligen Geräts und landet nie im Repo oder im Export.
- Das Repo ist öffentlich – Teamnamen, Ergebnisse und Logos sind lesbar. Keine Spielernamen eintragen.
- Offline? Änderungen bleiben lokal und werden nachgeholt, sobald wieder Netz da ist.

Zusätzlich gibt es Export/Import als JSON-Datei.

## Starten

- **Online:** In GitHub unter *Settings → Pages* als Quelle `main` / `/ (root)` wählen. Die App läuft dann unter `https://<user>.github.io/<repo>/`.
- **Lokal:** `index.html` im Browser öffnen – kein Build nötig.

## Entwicklung

```
js/logic.js   Turnierlogik (Spielplan, Tabellen, Mischung, Finalrunde) – ohne DOM
js/app.js     Oberfläche
js/sync.js    Speichern auf GitHub (Contents-API, Branch "data")
css/style.css Styles
tests/        Tests der Turnierlogik
```

Tests: `node --test tests/logic.test.js`
