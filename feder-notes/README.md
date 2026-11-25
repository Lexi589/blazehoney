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

## Text schreiben (wie in Word, aber auf den Linien)

- **Textfeld anlegen:** Wähle das **T**-Werkzeug und tippe auf die Seite, oder fang mit einer Tastatur einfach an zu tippen. Das Feld rastet auf der Linie ein und reicht bis zum rechten Seitenrand.
- **Auf den Linien:** Jede Zeile sitzt auf einer Papierlinie, egal welche Schrift und Größe du nimmst. Bei „2 Zeilen“ Abstand schreibst du auf jeder zweiten Linie.
- **Formatleiste:** Sie erscheint, sobald du in einem Textfeld bist:
  - Schriftart (Standard, Serif, Schreibmaschine, Handschrift) und Größe
  - **F**ett, *K*ursiv, U̲nterstrichen, Durchgestrichen
  - Textfarbe und Markieren
  - linksbündig, zentriert, rechtsbündig
  - Aufzählung, Nummerierung, Checkbox
  - Zeilenabstand und „Formatierung entfernen“
- **Notiz-Einstellungen** (⋯ → Notiz-Einstellungen): Papier, Schriftart, Größe, Zeilenabstand und Textfarbe für die ganze Notiz, mit Vorschau. Mit „Als Standard für neue Notizen“ werden sie für alle neuen Notizen übernommen.
- **Allgemeine Einstellungen** (⚙ in der Übersicht oder ⋯ in der Notiz):
  - Nextcloud
  - Standard für neue Notizen
  - Mit dem Finger zeichnen
  - Einfach lostippen an/aus
  - Automatisch synchronisieren
  - Hell/Dunkel/System

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
