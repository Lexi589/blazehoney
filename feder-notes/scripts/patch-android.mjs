// Passt das generierte Android-Projekt an:
//  - unverschlüsselte Verbindungen erlauben (Nextcloud im Heimnetz ohne HTTPS)
//  - Bildschirm bei eingeblendeter Tastatur verkleinern statt überdecken
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let xml = readFileSync(file, 'utf8');
if (!xml.includes('usesCleartextTraffic')) xml = xml.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
// Mikrofon (Sprachaufnahme) und Kamera (Foto einfügen)
for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.CAMERA']) {
  if (!xml.includes(perm)) xml = xml.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`);
}
if (!xml.includes('windowSoftInputMode')) xml = xml.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"');
writeFileSync(file, xml);
console.log('AndroidManifest angepasst');

// Versionsnummer pro Build hochzählen, damit Android Updates sauber erkennt
const code = process.env.VERSION_CODE;
if (code) {
  const gradle = join(dirname(file), '..', '..', 'build.gradle');
  writeFileSync(gradle, readFileSync(gradle, 'utf8')
    .replace(/versionCode \d+/, `versionCode ${+code}`)
    .replace(/versionName "[^"]*"/, `versionName "1.1.${+code}"`));
  console.log('versionCode =', code);
}

// Eigenes natives Modul (OkHttp für WebDAV) + Zurück-Taste einbauen
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const javaDir = join(root, 'android', 'app', 'src', 'main', 'java', 'de', 'feder', 'notes');
for (const f of ['FederHttpPlugin.java', 'MainActivity.java']) copyFileSync(join(root, 'native', 'android', f), join(javaDir, f));
const appGradle = join(root, 'android', 'app', 'build.gradle');
let g = readFileSync(appGradle, 'utf8');
if (!g.includes('okhttp3')) {
  g = g.replace(/dependencies \{/, "dependencies {\n    implementation 'com.squareup.okhttp3:okhttp:4.12.0'");
  writeFileSync(appGradle, g);
}
console.log('Natives Modul FederHttp eingebaut');
