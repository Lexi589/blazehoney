// Formerkennung: Strich zeichnen und am Ende den Stift kurz halten →
// gerade Linie, Pfeil, Kreis/Ellipse, Rechteck oder Dreieck.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pathLen(p) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]);
  return L;
}

/** Gleichmäßig verteilte Punkte entlang des Pfads. */
function resample(p, n) {
  const L = pathLen(p);
  if (!L) return p.map(q => q.slice());
  const step = L / (n - 1);
  const out = [p[0].slice()];
  let acc = 0, prev = p[0];
  for (let i = 1; i < p.length && out.length < n; i++) {
    let cur = p[i], d = dist(prev, cur);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(q);
      prev = q; d = dist(prev, cur); acc = 0;
    }
    acc += d; prev = cur;
  }
  while (out.length < n) out.push(p[p.length - 1].slice());
  return out;
}

function perpDist(p, a, b) {
  const L = dist(a, b);
  if (!L) return dist(p, a);
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
}

/** Ramer-Douglas-Peucker: Eckpunkte finden. */
function rdp(p, eps) {
  if (p.length < 3) return p;
  let idx = 0, max = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = perpDist(p[i], p[0], p[p.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) {
    const a = rdp(p.slice(0, idx + 1), eps);
    const b = rdp(p.slice(idx), eps);
    return a.slice(0, -1).concat(b);
  }
  return [p[0], p[p.length - 1]];
}

/** Linienende auf 0°/45°/90°… einrasten, wenn es fast so gezeichnet wurde. */
function snapEnd(a, b) {
  const len = dist(a, b);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(snapped - ang) < (7 * Math.PI) / 180) return [a[0] + Math.cos(snapped) * len, a[1] + Math.sin(snapped) * len];
  return b;
}

/** Zwischenpunkte einfügen, damit die Glättung beim Zeichnen die Ecken nicht abrundet. */
function densify(poly, step = 3) {
  const out = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  out.push(poly[poly.length - 1].slice());
  return out;
}

function ellipsePoints(cx, cy, rx, ry, n = 96) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return out;
}

/**
 * @param {number[][]} raw Punkte [x, y, druck]
 * @param {{lineOnly?: boolean}} opts
 * @returns {{type: string, label: string, pts: number[][]} | null}
 */
export function recognize(raw, opts = {}) {
  const pts = raw.map(p => [p[0], p[1]]);
  if (pts.length < 4) return null;
  const L = pathLen(pts);
  if (L < 30) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of pts) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
  const w = maxx - minx, h = maxy - miny, size = Math.max(w, h);
  const first = pts[0], last = pts[pts.length - 1];

  // --- gerade Linie ---
  const chord = dist(first, last);
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, perpDist(p, first, last));
  if (chord > 25 && maxDev < Math.max(8, chord * 0.08) && L < chord * 1.3) {
    return { type: 'line', label: 'Linie', pts: densify([first, snapEnd(first, last)], 6) };
  }
  if (opts.lineOnly) return null;

  const closed = chord < Math.max(20, size * 0.25);
  if (!closed) {
    // --- Pfeil: gerader Schaft bis zur Spitze, danach kurzer Haken ---
    let k = 0, far = 0;
    pts.forEach((p, i) => { const d = dist(first, p); if (d > far) { far = d; k = i; } });
    const tip = pts[k];
    const shaftLen = dist(first, tip);
    let dev = 0;
    for (let i = 0; i <= k; i++) dev = Math.max(dev, perpDist(pts[i], first, tip));
    const head = pts.slice(k);
    const headLen = pathLen(head);
    if (shaftLen > 40 && dev < Math.max(10, shaftLen * 0.1) && head.length >= 3 && headLen > shaftLen * 0.08 && headLen < shaftLen * 0.9) {
      const end = snapEnd(first, tip);
      const ang = Math.atan2(end[1] - first[1], end[0] - first[0]);
      const hl = Math.max(14, Math.min(42, shaftLen * 0.18));
      const left = [end[0] - Math.cos(ang - 0.5) * hl, end[1] - Math.sin(ang - 0.5) * hl];
      const right = [end[0] - Math.cos(ang + 0.5) * hl, end[1] - Math.sin(ang + 0.5) * hl];
      return { type: 'arrow', label: 'Pfeil', pts: densify([first, end, left, end, right], 4) };
    }
    return null;
  }

  // --- geschlossene Formen ---
  const r = resample(pts, 64);
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  let fi = 0, fd = 0;
  r.forEach((p, i) => { const d = dist(p, [cx, cy]); if (d > fd) { fd = d; fi = i; } });
  const ring = r.slice(fi).concat(r.slice(0, fi));
  ring.push(ring[0].slice());
  const per = pathLen(ring);
  const simp = rdp(ring, per * 0.045);
  const n = simp.length - 1;

  const rx = w / 2, ry = h / 2;
  let err = 0;
  if (rx > 4 && ry > 4) {
    for (const p of r) err += Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1);
    err /= r.length;
  } else err = 1;

  const round = () => {
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) {
      const rr = (rx + ry) / 2;
      return { type: 'circle', label: 'Kreis', pts: ellipsePoints(cx, cy, rr, rr) };
    }
    return { type: 'ellipse', label: 'Ellipse', pts: ellipsePoints(cx, cy, rx, ry) };
  };
  if (err < 0.1) return round();          // eindeutig rund (Ecken würden stark abweichen)
  if (n === 3) return { type: 'triangle', label: 'Dreieck', pts: densify([...simp.slice(0, 3), simp[0]]) };
  if (n === 4) {
    const axis = simp.slice(0, 4).every((p, i) => {
      const q = simp[(i + 1) % 4];
      const a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) % (Math.PI / 2);
      return Math.min(a, Math.PI / 2 - a) < (14 * Math.PI) / 180;
    });
    const poly = axis
      ? [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy], [minx, miny]]
      : [...simp.slice(0, 4), simp[0]];
    return { type: 'rect', label: axis ? 'Rechteck' : 'Viereck', pts: densify(poly) };
  }
  if (err < 0.14 || (n >= 5 && err < 0.2)) return round();
  return null;
}
