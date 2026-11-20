# Turnierplaner

Web-Tool für Jugend-Fußballturniere – Liga, WM-Format, Mehrstufig oder „Andi Spezial“ (entstanden aus einer Excel-Vorlage für ein U9-Hallenturnier).

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

**Mehrstufig** (16, 32 oder 64 Teams, auch über 2 Tage und mehrere Orte)
- Runde 1: 4er-Gruppen (Hand oder Auslosung).
- 16 Teams: Runde 2 Gold (1.+2.) und Silber (3.+4.), je 2 Gruppen à 4, danach Playoffs → Gold Plätze 1–8, Silber 9–16.
- 32/64 Teams: Runde 2 Gold (alle 1.), Silber (2.+3.), Bronze (alle 4.). Runde 3:
  Champions League (Gold 1–3 + Silber 1, Gruppen à 5), Europa League (Silber 2+3, Bronze 1, Gold 4, Gruppen à 6),
  Conference League (Silber 4 + Bronze 2–4, Gruppen à 5), danach Playoffs – jedes Team hat mindestens 2 Playoff-Spiele.
  Endstand: CL vor EL vor Conference.
- Gruppen der Runden 2/3: Setzung nach Leistung im Schlangenverfahren, Wiederholungsspiele aus der Vorrunde werden soweit möglich vermieden.
- Beliebig viele Orte mit eigener Feldzahl; jede Leistungsgruppe einem Ort zuordnen, Runde 1 auf alle Orte verteilbar; Datum und Beginn je Runde.

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
- Online-Speicher mit Login und Live-Ansicht für Zuschauer (Firebase, optional)

## Speicherung & Live-Ansicht (Firebase)

Ohne Konfiguration speichert die App nur im Browser des Geräts (plus Export/Import als JSON).

Mit Firebase (kostenloser Spark-Tarif):
- **Turnierleitung** meldet sich unter „Anmelden“ mit E-Mail/Passwort an. Alle Turniere werden ca. 1,5 s nach jeder Eingabe online gespeichert und auf allen angemeldeten Geräten in Echtzeit abgeglichen. Tragen zwei Geräte gleichzeitig ein, werden die Ergebnisse zusammengeführt. Offline-Eingaben werden nachgeholt.
- **Eltern & Zuschauer** bekommen über „Live-Link & QR-Code“ einen Link (`…/#/live/<id>`). Die Live-Ansicht braucht keine Anmeldung, hat keine Eingabefelder und aktualisiert sich selbst.
- Gespeichert wird je Turnier ein Dokument `tournaments/<id>` in Firestore. Geschützt wird über `firestore.rules`: lesen darf jeder mit Link, schreiben nur die dort eingetragenen E-Mail-Adressen.

### Einrichtung
1. Firebase-Konsole → Projekt → Web-App hinzufügen (`</>`), Konfiguration in `js/firebase-config.js` eintragen.
2. Authentication → Anmeldemethode „E-Mail/Passwort“ aktivieren, unter „Users“ die Turnierleitung anlegen.
3. Firestore Database anlegen (Produktionsmodus, Standort z. B. `europe-west3` Frankfurt).
4. Firestore → Regeln: Inhalt von `firestore.rules` einfügen, eigene E-Mail-Adresse(n) eintragen, veröffentlichen.

## Starten

- **Online:** In GitHub unter *Settings → Pages* als Quelle `main` / `/ (root)` wählen. Die App läuft dann unter `https://<user>.github.io/<repo>/`.
- **Lokal:** `index.html` im Browser öffnen – kein Build nötig.

## Entwicklung

```
js/logic.js   Andi Spezial (Spielplan, Tabellen, Mischung, Finalrunde) – ohne DOM
js/engine.js  Liga & WM-Format (Rundenturnier, Zeitplan, K.-o.-Baum, Endstand)
js/multi.js   Mehrstufig (Runden, Leistungsgruppen, Playoffs, Orte & Termine)
js/app.js     Oberfläche
js/cloud.js   Online-Speicher, Login und Live-Ansicht (Firebase)
js/firebase-config.js  Firebase-Konfiguration des Projekts
js/vendor/qrcode.js    QR-Code-Erzeugung (qrcode-generator, MIT)
firestore.rules        Sicherheitsregeln für Firestore
css/style.css Styles
tests/        Tests der Turnierlogik
```

Tests: `node --test tests/logic.test.js tests/engine.test.js tests/multi.test.js`
