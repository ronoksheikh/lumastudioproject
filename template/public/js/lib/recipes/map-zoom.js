// World map with a tweened SVG viewBox "camera" and DOM pins/labels that follow map coordinates.
// Data comes from assets/world-map.json (build it with `npm run map`).
import { icons } from '../core.js';

/** Fetches (and caches) the pre-rendered map JSON: { width, height, rest, neighbours, bd, bdBox, dhaka }. */
export async function loadMap(ctx, url = 'assets/world-map.json') {
  ctx.memo.map ??= await (await fetch(url)).json();
  return ctx.memo.map;
}

/** <svg> markup: .rest (world), .nb (neighbours), .hl (highlighted country). */
export function mapMarkup(map, { cls = 'rc-map' } = {}) {
  return `<svg class="${cls}" viewBox="0 0 ${map.width} ${map.height}" preserveAspectRatio="xMidYMid slice"><path class="rest" d="${map.rest}"/><path class="nb" d="${map.neighbours}"/><path class="hl" d="${map.highlight ?? map.bd}"/></svg>`;
}

export const pinMarkup = (cls = 'rc-pin') => `<div class="${cls}">${icons.pin}</div>`;

/**
 * Camera for a map <svg>. Tween `cam.vb` with GSAP (use cam.view(width, x, y) for targets).
 * Elements in `overlays` ([{ nodes, at: [mapX, mapY] }]) are positioned over their map point every frame.
 * Active only between `from` and `to` (seconds) so it costs nothing elsewhere.
 */
export function mapCamera(ctx, svg, map, { from = 0, to = ctx.END, overlays = [] } = {}) {
  const { W, H } = ctx;
  const ratio = H / W;
  const vb = { x: 0, y: 0, w: map.width, h: map.height };
  /** viewBox of width `wv` centred on map point (x, y) */
  const view = (wv, x, y) => ({ x: x - wv / 2, y: y - (wv * ratio) / 2, w: wv, h: wv * ratio });
  /** map point -> stage pixels, honouring preserveAspectRatio="slice" (pitfall #13) */
  const toPx = (px, py) => {
    const k = Math.max(W / vb.w, H / vb.h);
    return [(px - vb.x) * k + (W - vb.w * k) / 2, (py - vb.y) * k + (H - vb.h * k) / 2];
  };
  ctx.onFrame((t) => {
    if (t < from || t > to) return;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    for (const o of overlays) {
      const [x, y] = toPx(...o.at);
      for (const n of o.nodes) Object.assign(n.style, { left: x + 'px', top: y + 'px' });
    }
  });
  /** the whole world, slightly cropped top and bottom */
  const world = () => ({ x: 0, y: 120, w: map.width, h: map.width * ratio });
  /** Tween the camera to `target` ({x,y,w,h}) — e.g. cam.flyTo(t, cam.view(70, ...dhaka), 0.8). */
  const flyTo = (t, target, dur = 0.8, ease = 'power3.inOut') => ctx.tl.to(vb, { ...target, duration: dur, ease }, t);
  return { vb, view, toPx, world, flyTo };
}

/** { box: [x, y, w, h] of the highlighted country, city: [x, y] } — works with old and new map files. */
export function mapPoints(map) {
  return { box: map.highlightBox ?? map.bdBox, city: map.city ?? map.dhaka };
}
