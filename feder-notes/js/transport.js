// HTTP-Zugriff, der in den installierten Apps nicht an Browser-Sperren (CORS) scheitert.
//  - Windows-App (Electron): Anfrage läuft über den Hauptprozess
//  - Android-App (Capacitor): Anfrage läuft über den nativen HTTP-Client
//  - Browser: normales fetch (Nextcloud erlaubt das meist NICHT → App benutzen)

export const platform = (() => {
  if (window.federNative && window.federNative.platform === 'electron') return 'windows';
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'android';
  return 'web';
})();

/** @returns {Promise<{status:number, headers:Object<string,string>, text:string}>} */
export async function http(method, url, { headers = {}, body } = {}) {
  if (platform === 'windows') {
    return window.federNative.http({ method, url, headers, body });
  }
  if (platform === 'android') {
    const cap = window.Capacitor;
    const opts = { url, method, headers, responseType: 'text' };
    if (body != null) opts.data = asciiSafe(body);
    const call = cap.Plugins && cap.Plugins.CapacitorHttp && cap.Plugins.CapacitorHttp.request
      ? o => cap.Plugins.CapacitorHttp.request(o)
      : o => cap.nativePromise('CapacitorHttp', 'request', o);
    const res = await call(opts);
    const h = {};
    for (const [k, v] of Object.entries(res.headers || {})) h[k.toLowerCase()] = String(v);
    const text = res.data == null ? '' : typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return { status: res.status, headers: h, text };
  }
  const res = await fetch(url, { method, headers, body });
  const h = {};
  res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
  return { status: res.status, headers: h, text: await res.text() };
}

// Der Android-HTTP-Client schreibt Text-Bodies byteweise; Umlaute daher als \uXXXX
// kodieren. Für JSON und Base64 ist das verlustfrei.
function asciiSafe(s) {
  return String(s).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
