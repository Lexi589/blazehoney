// Kopiert die Web-App nach www/ (wird von der Android-App eingebettet).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const f of ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons']) {
  cpSync(join(root, f), join(out, f), { recursive: true });
}
console.log('Web-App nach www/ kopiert');
