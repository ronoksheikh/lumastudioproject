// Particle morph helpers. Targets: 'scatter' | 'sphere' | 'logo' | 'ring' | 'text'.
// Scenes are built in time order, so ctx.memo.particleTarget always holds the target active at build time.

const WEIGHT = { scatter: 'wScatter', sphere: 'wSphere', logo: 'wLogo', ring: 'wRing', text: 'wText' };

/**
 * Morph the particle cloud into `target` starting at `t`.
 * opts: dur, ease, opacity (fade to), jitter (set), spin ({ to, dur, ease } for the sphere/ring), size.
 */
export function morph(ctx, t, target, { dur = 0.5, ease = 'power3.inOut', opacity, opacityDur = 0.35, jitter, spin } = {}) {
  const { tl, P } = ctx;
  const prev = ctx.memo.particleTarget;
  if (prev !== target) {
    tl.to(P[WEIGHT[prev]], { value: 0, duration: dur, ease }, t);
    tl.to(P[WEIGHT[target]], { value: 1, duration: dur, ease }, t);
    ctx.memo.particleTarget = target;
  }
  if (opacity != null) tl.to(P.uOpacity, { value: opacity, duration: opacityDur }, t);
  if (jitter != null) tl.set(P.uJitter, { value: jitter }, t);
  if (spin) tl.fromTo(P.uSpin, { value: 0 }, { value: spin.to, duration: spin.dur ?? 1.2, ease: spin.ease ?? 'power2.out' }, t);
}

/** Particle cloud brightness: fade to `value` at `t`. */
export function particlesTo(ctx, t, value, dur = 0.4) {
  ctx.tl.to(ctx.P.uOpacity, { value, duration: dur }, t);
}
