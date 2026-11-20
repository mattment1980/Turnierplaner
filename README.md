# Turnierplaner

Web-Tool für Jugend-Fußballturniere – Liga, WM-Format oder „Andi Spezial“ (entstanden aus einer Excel-Vorlage für ein U9-Hallenturnier).

## Turniermodi

**Andi Spezial** (16 Teams, 4 Felder)
1. Gruppenphase 1 – 4 Gruppen à 4, jeder gegen jeden.
2. Gruppenphase 2 – neu gemischt: jede Gruppe bekommt einen Ersten, Zweiten, Dritten und Vierten aus verschiedenen alten Gruppen. Punkte und Tore beginnen wieder bei null.
3. Finalrunde – Erste/Zweite über Kreuz ins Viertelfinale, alle Plätze 1–16 werden ausgespielt.

**Liga** (2–32 Teams)
- Eine Tabelle, jeder gegen jeden – optional mit Hin- und Rückrunde.
- Optional K.-o.-Runde der besten 2, 4, 8 oder 16.

**WM-Format** (2–32 Teams)
- Gruppen mit 3–10 Teams (auch unterschiedlich groß), von Hand eingeteilt oder ausgelost.
- Pro Gruppe kommen X Teams weiter. Ist das keine 2er-Potenz, rücken die besten Gruppen-Nächsten nach (wie die besten Gruppendritten bei der EM), bewertet nach Punkten, Tordifferenz und Toren pro Spiel.
- Setzliste nach Gruppenplatz und Leistung, Teams aus derselben Gruppe treffen in Runde 1 möglichst nicht aufeinander.

**K.-o.-Runde** (Liga & WM): wählbar „nur Finale“, „Finale + Spiel um Platz 3“ oder „alle Plätze ausspielen“. Unentschieden → Neunmeterschießen.

Platzierung in Tabellen: Punkte – Tordifferenz – mehr erzielte Tore – direkter Vergleich – Los.

Der Spielplan wird automatisch auf die Spielfelder verteilt – mit möglichst wenigen Runden und, wo möglich, ohne zwei Spiele eines Teams direkt hintereinander.

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
js/logic.js   Andi Spezial (Spielplan, Tabellen, Mischung, Finalrunde) – ohne DOM
js/engine.js  Liga & WM-Format (Rundenturnier, Zeitplan, K.-o.-Baum, Endstand)
js/app.js     Oberfläche
js/sync.js    Speichern auf GitHub (Contents-API, Branch "data")
css/style.css Styles
tests/        Tests der Turnierlogik
```

Tests: `node --test tests/logic.test.js tests/engine.test.js`
