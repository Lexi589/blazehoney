// Erlaubt nur harmlose Formatierungen in Textfeldern (Schutz vor eingeschleustem HTML aus Sync/Import).
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'MARK', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'SUB', 'SUP']);
// Nur diese Formatierungen dürfen als style-Attribut bleiben (Word-ähnliche Textformatierung)
const STYLE_PROPS = new Set(['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align']);
const SAFE_VALUE = /^[#\w\s(),.%-]{1,60}$/;

function cleanStyle(style) {
  const out = [];
  for (const decl of String(style).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (STYLE_PROPS.has(prop) && SAFE_VALUE.test(val) && !/url|expression|var/i.test(val)) out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
    if (!ALLOWED.has(child.tagName)) {
      // unbekannte Elemente durch ihren Inhalt ersetzen, Skripte/Styles komplett entfernen
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(child.tagName)) child.remove();
      else { clean(child); child.replaceWith(...child.childNodes); }
      continue;
    }
    const cls = child.getAttribute('class') || '';
    const keepClass = child.tagName === 'SPAN' && /^(cb|cb on)$/.test(cls);
    const style = cleanStyle(child.getAttribute('style') || '');
    for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    if (keepClass) { child.className = cls; child.setAttribute('contenteditable', 'false'); }
    if (style) child.setAttribute('style', style);
    clean(child);
  }
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function textToHTML(text) {
  return String(text).split(/\r?\n/).map(l => `<div>${l ? escapeHTML(l) : '<br>'}</div>`).join('');
}
