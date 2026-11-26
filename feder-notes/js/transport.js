// HTTP-Zugriff, der in den installierten Apps nicht an Browser-Sperren (CORS) scheitert.
//  - Android-App: eigenes natives Modul "FederHttp" (OkHttp, kann auch WebDAV-Befehle wie MKCOL)
//  - Windows-App (Electron): Anfrage läuft über den Hauptprozess
//  - Browser: normales fetch (Nextcloud erlaubt das meist NICHT → App benutzen)

const cap = window.Capacitor;
export const platform = (() => {
  if (window.federNative && window.federNative.platform === 'electron') return 'windows';
  if (cap && ((cap.isNativePlatform && cap.isNativePlatform()) || (cap.getPlatform && cap.getPlatform() === 'android'))) return 'android';
  return 'web';
})();

function native(plugin, method, options) {
  if (cap.Plugins && cap.Plugins[plugin] && cap.Plugins[plugin][method]) return cap.Plugins[plugin][method](options);
  return cap.nativePromise(plugin, method, options);
}

/** @returns {Promise<{status:number, headers:Object<string,string>, text:string}>} */
export async function http(method, url, { headers = {}, body } = {}) {
  if (platform === 'windows') {
    return window.federNative.http({ method, url, headers, body });
  }
  if (platform === 'android') {
    const res = await native('FederHttp', 'request', { url, method, headers, body: body == null ? null : String(body) });
    return { status: res.status, headers: lower(res.headers), text: res.text || '' };
  }
  const res = await fetch(url, { method, headers, body });
  const h = {};
  res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
  return { status: res.status, headers: h, text: await res.text() };
}

/** Öffnet eine Adresse im normalen Browser (z. B. für die Nextcloud-Anmeldung). */
export function openExternal(url) {
  if (platform === 'android') return native('FederHttp', 'openUrl', { url });
  window.open(url, '_blank', 'noopener');
}

function lower(obj) {
  const h = {};
  for (const [k, v] of Object.entries(obj || {})) h[k.toLowerCase()] = String(v);
  return h;
}
