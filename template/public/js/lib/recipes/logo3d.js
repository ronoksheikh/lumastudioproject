// The extruded 3D brand logo (needs project.json features.logo3d !== false).

/** Spin the logo in at `t`: scale 0 → `size` with a back-ease while rotating a full turn. */
export function logoIn(ctx, t, { x = 0, y = 2.3, size = 0.62, dur = 0.7, spinDur = 1.4, turns = -1 } = {}) {
  const { tl, st } = ctx;
  tl.set(st, { logoY: y, logoX: x }, t);
  tl.fromTo(st, { logo: 0 }, { logo: size, duration: dur, ease: 'back.out(1.5)' }, t);
  tl.fromTo(st, { logoSpin: Math.PI * 2 * turns }, { logoSpin: 0, duration: spinDur, ease: 'expo.out' }, t);
}

/** Shrink the logo away at `t`. */
export function logoOut(ctx, t, dur = 0.4) {
  ctx.tl.to(ctx.st, { logo: 0, duration: dur, ease: 'power3.in' }, t);
}
