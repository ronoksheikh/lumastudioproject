// Designed transitions. No plain cross-dissolves, no stripe wipes.
// All take ctx first and a start time; nodes are DOM elements (or arrays of them).

/** Rect of `node` in stage pixels (call at build time; the node may be visibility:hidden but must be laid out). */
export function stageRect(ctx, node) {
  const r = node.getBoundingClientRect();
  const s = document.getElementById('stage').getBoundingClientRect();
  const k = s.width / ctx.W; // current stage scale (1 at build time)
  return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, width: r.width / k, height: r.height / k };
}

/** Fly `node` (transform-origin 0 0) into `target` {x, y, width}. This is the "fly into the preview window" match cut. */
export function flyInto(ctx, node, target, { at, dur = 0.5, ease = 'expo.inOut', width = ctx.W } = {}) {
  return ctx.tl.to(node, { x: target.x, y: target.y, scale: target.width / width, duration: dur, ease }, at);
}

/** Zoom-in push: scale `node` up a little while fading it out (use at a scene's end). */
export function pushIn(ctx, node, { at, dur = 0.3, scale = 1.12, fade = true }) {
  return ctx.tl.to(node, { scale, opacity: fade ? 0 : 1, filter: 'blur(8px)', duration: dur, ease: 'power3.in' }, at);
}

/**
 * Snap several full-frame nodes into a grid of tiles (default 2×2). `tiles` = [[dx, dy], …] offsets of each
 * tile centre from the frame centre; computed from the stage size when omitted.
 */
export function gridSnap(ctx, nodes, { at, dur = 0.42, scale = 0.48, radius = 40, gap = 24, tiles } = {}) {
  const cols = 2;
  const offs = tiles ?? nodes.map((_, i) => [
    (i % cols ? 1 : -1) * (ctx.W * scale / 2 + gap / 2),
    (Math.floor(i / cols) ? 1 : -1) * (ctx.H * scale / 2 + gap / 2),
  ]);
  nodes.forEach((n, i) => {
    ctx.tl.set(n, { autoAlpha: 1 }, at);
    ctx.tl.to(n, { x: offs[i][0], y: offs[i][1], scale, borderRadius: radius, duration: dur, ease: 'expo.out' }, at);
  });
}

/**
 * Iris: a circular clip-path that opens (or closes) over `node`, centred on stage point (cx, cy).
 * dir 'open' reveals the node, 'close' hides it again.
 */
export function iris(ctx, node, { at, dur = 0.7, cx = ctx.W / 2, cy = ctx.H / 2, dir = 'open', ease = 'expo.inOut' }) {
  const big = Math.hypot(ctx.W, ctx.H);
  const c = (r) => `circle(${r}px at ${cx}px ${cy}px)`;
  const [from, to] = dir === 'open' ? [c(0), c(big)] : [c(big), c(0)];
  ctx.tl.set(node, { autoAlpha: 1 }, at);
  ctx.tl.fromTo(node, { clipPath: from }, { clipPath: to, duration: dur, ease }, at);
  if (dir === 'close') ctx.tl.set(node, { autoAlpha: 0 }, at + dur);
}

/** Match cut: `node` takes the exact on-screen rect of `from` and grows into the rect of `to`. */
export function matchCut(ctx, node, fromRect, toRect, { at, dur = 0.6, ease = 'expo.inOut' }) {
  ctx.tl.fromTo(node, {
    x: fromRect.x, y: fromRect.y, width: fromRect.width, height: fromRect.height,
  }, {
    x: toRect.x, y: toRect.y, width: toRect.width, height: toRect.height, duration: dur, ease,
  }, at);
}
