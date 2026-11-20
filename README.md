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

## Speicherung

Alle Daten liegen **im Browser des Geräts** (localStorage). Es gibt keinen Server.
Andere Geräte sehen die Daten nicht automatisch – dafür Export/Import nutzen.
Browserdaten löschen = Turniere weg, also wichtige Turniere exportieren.

## Starten

- **Online:** In GitHub unter *Settings → Pages* als Quelle `main` / `/ (root)` wählen. Die App läuft dann unter `https://<user>.github.io/<repo>/`.
- **Lokal:** `index.html` im Browser öffnen – kein Build nötig.

## Entwicklung

```
js/logic.js   Turnierlogik (Spielplan, Tabellen, Mischung, Finalrunde) – ohne DOM
js/app.js     Oberfläche
css/style.css Styles
tests/        Tests der Turnierlogik
```

Tests: `node --test tests/logic.test.js`
