# Feder Notes

Eine Notiz-App für dein Samsung-Tablet (Android-App) und deinen Windows-PC, gebaut als Alternative zu Samsung Notes. Die Notizen werden in deiner Nextcloud gespeichert, und die App funktioniert auch offline. Der Fokus liegt darauf, dass Stift **und** Tastatur ohne Umschalten zusammenarbeiten.

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
| **Echte Apps** | Android-App (`.apk`) für das Samsung-Tablet und ein Windows-Installer (`.exe`). |
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

## Installieren

Die Apps werden bei jedem Push automatisch von GitHub gebaut (siehe `.github/workflows/feder-apps.yml`).
Die aktuelle Version liegt immer unter **Releases → „Feder Notes (aktuelle Version)“** im Repository:
`https://github.com/Lexi589/blazehoney/releases/tag/feder-notes-latest`

### Samsung-Tablet / Android
1. Öffne die Release-Seite auf dem Tablet und lade **`FederNotes.apk`** herunter.
2. Öffne die Datei. Beim ersten Mal fragt Android, ob der Browser Apps installieren darf: **Einstellungen → Zulassen**.
3. Tippe auf **Installieren**. Für Updates installierst du einfach die neue APK darüber; deine Notizen bleiben erhalten.

### Windows
1. Lade **`FederNotes-Setup.exe`** herunter und starte die Datei.
2. Falls Windows SmartScreen warnt: **Weitere Informationen → Trotzdem ausführen**. Die Warnung kommt, weil die App kein gekauftes Zertifikat hat.
3. Danach findest du Feder Notes im Startmenü und auf dem Desktop.

## Speichern auf deiner Nextcloud

1. Erstelle in Nextcloud ein **App-Passwort**: Profilbild → *Persönliche Einstellungen* → *Sicherheit* → unten bei „App-Name“ `Feder Notes` eintragen → **Neues App-Passwort erstellen**.
2. Öffne in Feder Notes **⚙** und wähle **Nextcloud**. Trage Folgendes ein:
   - **Adresse:** z. B. `https://cloud.meinserver.de`. Du kannst auch einfach die Adresse aus dem Browser einfügen; Teile wie `/index.php/apps/files` werden automatisch entfernt.
   - **Benutzername** und das **App-Passwort**
   - **Ordner:** Standard ist `FederNotes`
3. Wähle **Verbindung testen** und dann **Speichern**. Mach das auf jedem Gerät, danach sind alle synchron.

In deiner Nextcloud entsteht der Ordner `FederNotes` mit diesen Dateien:

| Datei | Inhalt |
|---|---|
| `index.json` | Inhaltsverzeichnis |
| `note-….json` | je eine Notiz |
| `asset-….b64` | Bilder und PDF-Seiten |

Damit liegt auch das Backup automatisch auf deinem Server.

- Synchronisiert wird jede Minute, beim Schließen der App und mit <kbd>Strg</kbd>+<kbd>S</kbd> bzw. ⟳. Offline geschriebene Notizen werden nachgeladen, sobald wieder Netz da ist.
- Wird dieselbe Notiz auf zwei Geräten gleichzeitig geändert, bleiben beide Versionen erhalten (eine davon als „(Konflikt)“).
- Richte die Nextcloud am besten **zuerst in der Windows-App** ein: Sie legt den Ordner automatisch an. Die Android-App kann das technisch nicht. Alternativ legst du den Ordner `FederNotes` einfach selbst in Nextcloud an.
- Im normalen Browser blockiert Nextcloud den Zugriff (CORS). Benutze für Nextcloud deshalb die Apps.

## Für Entwickler

```bash
cd feder-notes
npm install
npm start               # Windows-/Desktop-App im Entwicklungsmodus
npm run build:win       # Windows-Installer nach dist/
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
  desktop/                  Windows-App (Electron)
  capacitor.config.json     Android-App (Capacitor)
  scripts/                  Build-Hilfen (Web-Kopie, Android-Anpassungen)
  js/db.js                  lokale Speicherung (IndexedDB)
  sw.js                     Offline-Cache
  vendor/                   pdf.js 3.11.174 (Apache-2.0), JSZip 3.10.1 (MIT/GPLv3)
  server/server.js          Sync-Server + Auslieferung der App (keine Abhängigkeiten)
```
