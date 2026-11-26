# Feder Notes

Eine Notiz-App für dein Samsung-Tablet und Android-Handy, gebaut als Alternative zu Samsung Notes. Die Notizen werden in deiner Nextcloud gespeichert, und die App funktioniert auch offline. Der Fokus liegt darauf, dass Stift **und** Tastatur ohne Umschalten zusammenarbeiten.

## Was besser ist als in Samsung Notes

| | |
|---|---|
| **Stift + Tastatur gleichzeitig** | Der S Pen schreibt immer. Fängst du auf der Tastatur an zu tippen, entsteht automatisch ein Textfeld: an der zuletzt angetippten Stelle oder unter dem letzten Inhalt. Du musst keinen Modus wechseln. |
| **Text liegt auf den Linien** | Die Zeilenhöhe des Texts entspricht genau dem Linienabstand. Handschrift und getippter Text passen sauber zusammen. |
| **Handballen-Erkennung** | Solange der Stift in der Nähe ist, werden Berührungen mit der Hand ignoriert. Mit einem Finger scrollst du, mit zwei zoomst du. |
| **S-Pen-Taste = Radierer** | Halte die Seitentaste gedrückt, um zu radieren (auch das Radierende von Stiften wird erkannt). |
| **Lasso** | Striche auswählen, verschieben, umfärben (einfach eine Farbe antippen) und mit <kbd>Entf</kbd> löschen. |
| **Schreib-Kurzbefehle** | `- ` erzeugt eine Liste, `1. ` eine Nummerierung, `# ` eine Überschrift und `[] ` eine Checkbox. Außerdem <kbd>Strg</kbd>+<kbd>B/I/U</kbd> und <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>H</kbd> zum Markieren. |
| **Volltextsuche** | Durchsucht Titel, getippten Text **und den Text importierter PDFs** (z. B. Arbeitsblätter). |
| **Speicherung in deiner Nextcloud** | Deine Notizen liegen als Dateien auf deinem eigenen Server und sind auf Tablet und PC synchron. Werden Änderungen auf zwei Geräten gleichzeitig gemacht, bleiben beide Versionen erhalten (als „Konflikt“-Kopie). |
| **Android-App** | Installierbar als `.apk`, mit einem Layout für Tablet und Handy. (Die Windows-App ist im Code noch vorhanden, wird aber gerade nicht automatisch gebaut.) |
| **Offline** | Alles wird lokal gespeichert. Die Synchronisation läuft, sobald wieder Netz da ist. |

Alle Tastenkürzel zeigt die App mit <kbd>?</kbd> an.

## Deine Samsung-Notes-Dateien aus der Schule übernehmen

**Empfohlener Weg: Export als PDF.** Dabei bleibt deine Handschrift exakt erhalten, und du kannst direkt darauf weiterschreiben.

1. In Samsung Notes eine Notiz lange gedrückt halten und weitere Notizen dazu auswählen.
2. Auf **Als Datei speichern** (bzw. **Teilen → Datei**) tippen und **PDF** wählen.
3. In Feder Notes auf **Importieren** gehen, alle PDFs auswählen und einen Ordner bzw. ein Fach angeben (z. B. „Mathe“).

Jede PDF wird zu einer eigenen Notiz. Jede PDF-Seite wird zu einer Seite, auf der du mit dem Stift und der Tastatur weiterarbeiten kannst. Am PC kannst du Dateien auch einfach ins Fenster ziehen.

**`.sdocx`-Dateien** (das eigene Format von Samsung Notes) werden ebenfalls gelesen. Weil das Format nicht offen dokumentiert ist, lassen sich daraus nur eingebettete Bilder und Text übernehmen. Reine Handschrift-Striche gehen dabei verloren. Für Notizen mit Handschrift solltest du daher den PDF-Weg nehmen.

Außerdem kannst du Bilder (Fotos von der Tafel), `.txt`/`.md`-Dateien und Feder-Backups (`.json`) importieren.
Über **⋯ → PDF / Bild in diese Notiz einfügen** fügst du z. B. ein Arbeitsblatt in eine bestehende Notiz ein.

## Installieren (Samsung-Tablet / Android-Handy)

Die App wird bei jedem Push automatisch von GitHub gebaut. Die aktuelle Version liegt immer hier:
**https://github.com/Lexi589/blazehoney/releases/download/feder-notes-latest/FederNotes.apk**

1. Den Link auf dem Gerät öffnen und die APK herunterladen.
2. Die Datei öffnen. Beim ersten Mal fragt Android, ob der Browser Apps installieren darf: **Zulassen**.
3. **Installieren** antippen. Updates installierst du einfach darüber, die Notizen bleiben erhalten.

## Mit Nextcloud verbinden (einmal pro Gerät, ca. 20 Sekunden)

1. In der Übersicht auf **„Mit Nextcloud verbinden“** tippen (oder auf ⚙ oben rechts).
2. Die **Adresse** deiner Nextcloud eingeben, z. B. `cloud.meinserver.de`, und **Anmelden** antippen.
3. Der Browser öffnet sich: dort anmelden (falls nötig) und **Zugriff gewähren** tippen.
4. Zurück in die App wechseln. Sie ist jetzt verbunden und synchronisiert automatisch.

Du musst kein App-Passwort abtippen; die App bekommt automatisch ein eigenes. Unter Nextcloud → Einstellungen → Sicherheit siehst du es als „Feder Notes (Android)“ und kannst es dort jederzeit widerrufen.

In deiner Nextcloud entsteht der Ordner `FederNotes` mit diesen Dateien:

| Datei | Inhalt |
|---|---|
| `index.json` | Inhaltsverzeichnis |
| `note-….json` | je eine Notiz |
| `asset-….b64` | Bilder und PDF-Seiten |

Wird dieselbe Notiz auf zwei Geräten gleichzeitig geändert, bleiben beide Versionen erhalten.

## Stift wie bei Samsung Notes

- **Stiftarten:** Tippe auf den aktiven Stift, um zwischen **Füller**, **Kuli**, **Bleistift** (mit Körnung) und **Kalligrafie** (schräge Feder) zu wählen. Jede Stiftart merkt sich ihre eigene Farbe und Stärke. Eine Vorschau zeigt, wie der Strich aussieht.
- **Farben:** Tippe auf eine Farbe, um sie zu verwenden. Tippst du auf die **aktive** Farbe noch einmal, kannst du dieses Farbfeld ändern; die neue Farbe bleibt dauerhaft gespeichert.
- **Radierer:** Tippe auf den aktiven Radierer und wähle **Ganzer Strich** oder **Nur Stelle**. Dort findest du auch Größe und „Seite leeren“. Mit gedrückter **S-Pen-Taste** radierst du jederzeit.
- **Finger:** Ein Finger scrollt, zwei Finger zoomen. Ist unter ⋯ „Mit dem Finger zeichnen“ an, zeichnet ein Finger, und mit zwei Fingern scrollst und zoomst du.
- Die **Zurück-Taste** von Android führt vom Editor zur Übersicht.

## Wie bei Samsung Notes

**Formen:** Zeichne einen Strich und **halte den Stift am Ende kurz still**. Der Strich wird dann zu einer exakten Form:
- gerade Linie (rastet bei 0°/45°/90° ein)
- Pfeil
- Kreis oder Ellipse
- Rechteck
- Dreieck

Ausschalten kannst du das unter ⚙ → „Formen erkennen“.

**Lasso:** Umkreise Striche, Bilder oder Sprachaufnahmen. Danach kannst du:
- am Rahmen verschieben
- an den Ecken skalieren
- am runden Griff oben drehen (rastet bei 90° ein)

Die Leiste darüber bietet:

| Knopf | Wirkung |
|---|---|
| Stil | Stärke und Farbe ändern |
| Kopieren, Ausschneiden, Duplizieren | auch über <kbd>Strg</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>D</kbd>, Einfügen mit <kbd>Strg</kbd>+<kbd>V</kbd> |
| Nach vorne / Nach hinten | Ebene ändern |
| Löschen | Auswahl entfernen |

**Drei Strichstärken** direkt in der Werkzeugleiste (dünn, mittel, dick), wie bei Samsung.

**Einfügen (+):**

| Eintrag | Was passiert |
|---|---|
| PDF / Bild als Seite | wird als neue Seite eingefügt |
| Sprachaufnahme | erscheint als ▶-Knopf auf der Seite |
| Bild, Kamera | frei verschieb- und skalierbar |
| Haftnotiz | gelbe Notiz |
| Tabelle | <kbd>Tab</kbd> springt zur nächsten Zelle; in der letzten Zelle entsteht eine neue Zeile, wie in Word. „+ Zeile/Spalte“ in der Formatleiste. |
| Neue Seite | leere Seite anhängen |

**Notizstil (⋯):**
- Papier: liniert, kariert, Punkte, blanko
- Papierfarbe: Weiß, Creme, Grau, Dunkel. Auf dunklem Papier wird schwarze Tinte automatisch weiß angezeigt.

**Favoriten:** Über ⋯ → „Zu Favoriten“ markierst du eine Notiz. Alle Favoriten findest du in der Ordnerleiste.

Noch nicht enthalten sind:
- Handschrift → Text bzw. Formel umwandeln (braucht eine Schrifterkennung)
- Handschrift ausrichten
- Zusammenarbeiten, Tags, Sperren
- Dokumentenscan, Doppelseiten-Ansicht

## Text schreiben – wie in Word, aber auf den Linien

**Tastatur-Modus (⌨):**
- Wenn du ⌨ antippst oder einfach mit einer Tastatur lostippst, beginnt der Cursor am Anfang der nächsten freien Zeile. Das ist am linken Rand, unter deinem bisherigen Text und deiner Handschrift.
- Tippst du eine leere Linie an, schreibst du am Anfang genau dieser Linie weiter.
- Ist eine Seite voll, läuft der Text auf die nächste Seite weiter.

**Freies Textfeld (⬚T):** Antippen, wo es hin soll. Unter „Feld“ in der Formatleiste stellst du Rahmen und Hintergrund ein oder löschst das Feld. Die Breite ziehst du am Rand, verschoben wird am Griff ⠿.

**Formatleiste (wie in Word):**
- Formatvorlage (Standard, Überschrift 1/2), Schriftart, Größe
- **F**ett, *K*ursiv, U̲nterstrichen, Durchgestrichen, Textfarbe, Markieren
- linksbündig, zentriert, rechtsbündig
- Aufzählung, Nummerierung, Checkbox, Einzug verkleinern/vergrößern
- **Absatz:** Zeilenabstand (1/2/3 Linien), Abstand nach Absatz, Einzug bei Aufzählungen

Alles bleibt dabei auf den Papierlinien.

**Tastatur wie in Word:**

| Taste | Wirkung |
|---|---|
| <kbd>Tab</kbd> / <kbd>Umschalt</kbd>+<kbd>Tab</kbd> | Aufzählung eine Ebene tiefer/höher, sonst Tabstopp |
| <kbd>Strg</kbd>+<kbd>B</kbd>/<kbd>I</kbd>/<kbd>U</kbd> | Fett/Kursiv/Unterstrichen |
| <kbd>Strg</kbd>+<kbd>L</kbd>/<kbd>E</kbd>/<kbd>R</kbd> | Ausrichtung |
| <kbd>Strg</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> | Zeilenabstand |
| <kbd>Strg</kbd>+<kbd>Alt</kbd>+<kbd>1</kbd>/<kbd>2</kbd> | Überschriften |
| <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>N</kbd> | Standard |
| <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>L</kbd> | Aufzählung |
| <kbd>Strg</kbd>+<kbd>Umschalt</kbd>+<kbd>&lt;</kbd>/<kbd>&gt;</kbd> | Schriftgröße |

**Einstellungen:**
- **Notiz-Einstellungen** (⋯): Papier, Schrift, Größe, Farbe, Zeilenabstand, Absatzabstand und Einzug für die Notiz. Mit „Als Standard für neue Notizen“ gelten sie auch für alle neuen Notizen.
- **Allgemeine Einstellungen** (⚙):
  - Nextcloud
  - Standards für neue Notizen
  - Finger-Zeichnen
  - Lostippen an/aus
  - Sync
  - Hell/Dunkel

## Für Entwickler

```bash
cd feder-notes
npm install
npm start               # Windows-/Desktop-App im Entwicklungsmodus
npm run build:win       # Windows-Installer nach dist/ (wird derzeit nicht automatisch gebaut)
npm run android:prepare # Android-Projekt erzeugen (danach: cd android && ./gradlew assembleDebug)
```

Für den Android-Build brauchst du das Android SDK und Java 17. Die Datei `android-debug.keystore` ist ein bewusst eingecheckter Signaturschlüssel, damit Updates über die alte Version installiert werden können. Er schützt nichts Geheimes; wer die App öffentlich verteilen will, sollte einen eigenen, geheimen Schlüssel verwenden.

### Alternative: eigener Sync-Server statt Nextcloud

Statt der Nextcloud kannst du auch den mitgelieferten kleinen Sync-Server verwenden: `node server/server.js` starten und in ⚙ **Eigener Sync-Server** wählen. Adresse und Token zeigt der Server beim Start an. Dieser Weg funktioniert auch im normalen Browser.

## Aufbau

```
feder-notes/
  index.html, css/app.css   Oberfläche
  js/editor.js              Seiten, Handschrift (Druck, Glättung), Radierer, Lasso, Textfelder, Gesten
  js/app.js                 Notizliste, Ordner, Suche, Tastenkürzel, Import-Dialog
  js/import.js              PDF (pdf.js), .sdocx (JSZip), Bilder, Text, Backup
  js/sync.js                Synchronisation mit Konfliktbehandlung
  js/nextcloud.js           Speicherung in Nextcloud (WebDAV, App-Passwort, ETags)
  js/transport.js           HTTP über Electron/Android nativ (umgeht Browser-Sperren)
  desktop/                  Windows-App (Electron, derzeit pausiert)
  native/android/           natives Android-Modul (OkHttp für WebDAV, Zurück-Taste)
  capacitor.config.json     Android-App (Capacitor)
  scripts/                  Build-Hilfen (Web-Kopie, Android-Anpassungen)
  js/db.js                  lokale Speicherung (IndexedDB)
  sw.js                     Offline-Cache
  vendor/                   pdf.js 3.11.174 (Apache-2.0), JSZip 3.10.1 (MIT/GPLv3)
  server/server.js          Sync-Server + Auslieferung der App (keine Abhängigkeiten)
```
