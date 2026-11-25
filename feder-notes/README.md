# Feder Notes

Eine Notiz-App für Tablet und PC, gebaut als Alternative zu Samsung Notes. Sie läuft im Browser, lässt sich installieren und funktioniert auch offline. Der Fokus liegt darauf, dass Stift **und** Tastatur ohne Umschalten zusammenarbeiten.

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
| **Synchronisation** | Über einen eigenen kleinen Server: Deine Daten liegen bei dir und nicht in einer fremden Cloud. Werden Änderungen auf zwei Geräten gleichzeitig gemacht, bleiben beide Versionen erhalten (als „Konflikt“-Kopie). |
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

## Starten

Du brauchst [Node.js](https://nodejs.org) (Version 18 oder neuer). Weitere Installationen sind nicht nötig.

```bash
cd feder-notes
node server/server.js
```

Der Server zeigt beim Start Folgendes an:

```
  Lokal:     http://localhost:8787
  Netzwerk:  http://192.168.0.23:8787
  Token:     k3J9…
```

1. Öffne auf dem Tablet die **Netzwerk-Adresse** in Chrome oder Samsung Internet.
2. Unter **⚙ Einstellungen** trägst du die Adresse und das Token ein und wählst **Speichern**.
3. Wiederhole das auf jedem weiteren Gerät (PC, Handy). Danach sind alle Geräte synchron.

Optionale Einstellungen: `PORT=9000`, `NOTES_TOKEN=meinGeheimnis` (sonst wird ein Token erzeugt und in `server/data/token.txt` gespeichert) und `NOTES_DATA=/pfad/zu/daten`.

### Sync auch außerhalb des Heim-WLANs (Schule ↔ zu Hause)

Der Server muss dafür von beiden Orten aus erreichbar sein. Am einfachsten geht das so:

- **[Tailscale](https://tailscale.com)** (kostenlos) auf dem PC/Raspberry Pi mit dem Server und auf dem Tablet installieren. Danach erreichst du den Server überall über seine Tailscale-Adresse, ohne Portfreigabe im Router.
- Alternativ kannst du den Server auf einem kleinen VPS betreiben. Stelle dann einen Reverse-Proxy mit HTTPS davor (z. B. Caddy).

Ohne Server geht es auch: Unter **⚙ → Backup exportieren** bekommst du eine Datei, die du auf einem anderen Gerät importieren kannst.

### Als App installieren

Damit die App installierbar ist und offline startet, muss sie über **HTTPS** oder `localhost` geöffnet werden (z. B. über Tailscale mit `tailscale serve` oder über einen VPS mit HTTPS). Dann wählst du im Browsermenü **Zum Startbildschirm hinzufügen**. Über eine reine `http://192.168…`-Adresse funktioniert alles andere ebenfalls, nur ohne Installation.

## Aufbau

```
feder-notes/
  index.html, css/app.css   Oberfläche
  js/editor.js              Seiten, Handschrift (Druck, Glättung), Radierer, Lasso, Textfelder, Gesten
  js/app.js                 Notizliste, Ordner, Suche, Tastenkürzel, Import-Dialog
  js/import.js              PDF (pdf.js), .sdocx (JSZip), Bilder, Text, Backup
  js/sync.js                Synchronisation mit Konfliktbehandlung
  js/db.js                  lokale Speicherung (IndexedDB)
  sw.js                     Offline-Cache
  vendor/                   pdf.js 3.11.174 (Apache-2.0), JSZip 3.10.1 (MIT/GPLv3)
  server/server.js          Sync-Server + Auslieferung der App (keine Abhängigkeiten)
```
