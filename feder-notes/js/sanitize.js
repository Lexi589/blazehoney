// Erlaubt nur harmlose Formatierungen in Textfeldern (Schutz vor eingeschleustem HTML aus Sync/Import).
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'MARK', 'BR', 'DIV', 'P', 'SPAN', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'SUB', 'SUP']);

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
    for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    if (keepClass) { child.className = cls; child.setAttribute('contenteditable', 'false'); }
    clean(child);
  }
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function textToHTML(text) {
  return String(text).split(/\r?\n/).map(l => `<div>${l ? escapeHTML(l) : '<br>'}</div>`).join('');
}
